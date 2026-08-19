import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only rate limiting. Serverless instances don't share memory, so an
// in-memory counter would let a caller dodge the limit just by landing on a
// different instance. The database is already the source of truth for every
// other write in this app, so it's the source of truth here too: count recent
// rows against a table that a rate-limited action must already touch.
//
// Accepted tradeoff, decided by the owner rather than assumed here: the parse
// quota is per account, and an account is free (sign-up is one anonymous
// click), so a script that re-registers gets a fresh 15. Keying on anything
// sturdier means a new service, which this app does not have. The limit exists
// to stop a runaway loop and a casual abuser, not a determined one.

const HOUR_MS = 60 * 60 * 1000;

export const PARSE_LIMIT_PER_HOUR = 15;
export const CLAIM_JOIN_LIMIT_PER_HOUR = 20;

function hourAgo(now: Date): string {
  return new Date(now.getTime() - HOUR_MS).toISOString();
}

// Both limiters fail open: a limiter that cannot read its own table must not
// take the feature down with it. Failing open *silently* is the part that
// hurts — an unapplied migration or a revoked grant leaves the limiter inert
// and nothing anywhere says so — so every unusable result is logged with the
// limiter that produced it and why. Returns null when there is no usable count.
function usableCount(
  limiter: string,
  count: number | null,
  error: { message: string; code?: string } | null
): number | null {
  if (error) {
    console.error(
      `[rateLimit] ${limiter}: count query failed (${error.code ?? "no code"}: ${error.message}) — failing open, this limiter is inert`
    );
    return null;
  }
  if (count === null || count === undefined) {
    console.error(
      `[rateLimit] ${limiter}: count query returned no count — failing open, this limiter is inert`
    );
    return null;
  }
  return count;
}

// Counts receipts the caller created in the last hour. One parse costs one
// fresh receipt, so receipt creation is a usable proxy for parse attempts
// without a dedicated log table.
//
// That proxy holds only because the parse route consumes a receipt on its
// first parse ATTEMPT: it stamps receipts.parsed_at (0020) before calling the
// model and refuses every later request for the same receiptId. Before that
// stamp existed the route could only detect a parse that had produced data, so
// a parse that produced nothing left the row looking fresh and one upload
// replayed for free while this count sat at 1. Move the stamp to after the
// model call, or drop it, and this limiter stops bounding model spend.
//
// `excludeReceiptId` is the receipt this parse is for. CaptureStep inserts that
// row before calling the route, so counting it made the Nth parse of the hour
// see N rows: the documented ceiling of 15 behaved as 14. Excluding it makes
// the Nth allowed parse the Nth.
export async function isParseRateLimited(
  supabase: SupabaseClient,
  userId: string,
  {
    excludeReceiptId,
    now = new Date(),
  }: { excludeReceiptId?: string; now?: Date } = {}
): Promise<boolean> {
  let query = supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .gte("created_at", hourAgo(now));
  if (excludeReceiptId) query = query.neq("id", excludeReceiptId);

  const { count, error } = await query;
  const usable = usableCount("parse", count, error);
  return usable !== null && usable >= PARSE_LIMIT_PER_HOUR;
}

// Caps how many participants can join a single receipt's claim link in an
// hour, so a spammer with the (unguessable but leakable) share token can't
// flood a receipt with fake participants.
//
// Two filters, both load-bearing, for different reasons.
//
// joined_via_share keeps the cap on the traffic it governs. Only joinReceipt
// sets it, so share-link joins are the only rows counted; participants the
// owner types in are not the flood this guards against.
//
// joined_at, not created_at, is the clock. The owner's own save rewrites every
// receipt_participants row for the receipt — 0016's save_receipt_state deletes
// and re-inserts in one transaction, which is the atomicity that save exists to
// provide — so every row comes back with a fresh created_at. Counting by
// created_at meant one owner edit on a 20-person dinner hit the cap instantly
// and locked out genuinely new joiners for an hour, on exactly the receipts
// this app is for. 0021 carries joined_at across that swap untouched, so it
// still reads as when the person actually joined.
//
// The earlier fix for that lockout leaned on the flag instead: re-inserted rows
// came back with joined_via_share at its column default of false, so they
// stopped counting. That erasure was itself a bug — it also hid real claimers
// from ClaimOwnerView, which filters on the same flag — and 0021 ends it. The
// flag no longer excludes an owner's save, so this must not go back to counting
// created_at.
//
// Rows that predate 0021 have a null joined_at and never match, so they
// under-count rather than lock a link. If 0021 has not been applied at all the
// column does not exist, the count query errors, and usableCount fails this
// limiter open with a log line rather than blocking every join.
export async function isClaimJoinRateLimited(
  supabase: SupabaseClient,
  receiptId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { count, error } = await supabase
    .from("receipt_participants")
    .select("id", { count: "exact", head: true })
    .eq("receipt_id", receiptId)
    .eq("joined_via_share", true)
    .gte("joined_at", hourAgo(now));
  const usable = usableCount("claim-join", count, error);
  return usable !== null && usable >= CLAIM_JOIN_LIMIT_PER_HOUR;
}

import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only rate limiting. Serverless instances don't share memory, so an
// in-memory counter would let a caller dodge the limit just by landing on a
// different instance. The database is already the source of truth for every
// other write in this app, so it's the source of truth here too: count recent
// rows against a table that a rate-limited action must already touch.

const HOUR_MS = 60 * 60 * 1000;

export const PARSE_LIMIT_PER_HOUR = 15;
export const CLAIM_JOIN_LIMIT_PER_HOUR = 20;

function hourAgo(now: Date): string {
  return new Date(now.getTime() - HOUR_MS).toISOString();
}

// Every parse call requires a fresh receipt owned by the caller (CaptureStep
// creates one before uploading), so counting receipt creation is a reliable
// proxy for parse attempts without a dedicated log table.
export async function isParseRateLimited(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { count } = await supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .gte("created_at", hourAgo(now));
  return (count ?? 0) >= PARSE_LIMIT_PER_HOUR;
}

// Caps how many participants can join a single receipt's claim link in an
// hour, so a spammer with the (unguessable but leakable) share token can't
// flood a receipt with fake participants.
export async function isClaimJoinRateLimited(
  supabase: SupabaseClient,
  receiptId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { count } = await supabase
    .from("receipt_participants")
    .select("id", { count: "exact", head: true })
    .eq("receipt_id", receiptId)
    .gte("created_at", hourAgo(now));
  return (count ?? 0) >= CLAIM_JOIN_LIMIT_PER_HOUR;
}

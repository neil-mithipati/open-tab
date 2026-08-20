import { NextResponse } from "next/server";
import { getSupabaseServerClient, getSupabaseServiceClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/gemini/parseReceipt";
import { extractStoragePath } from "@/lib/storage";
import { isParseRateLimited, PARSE_LIMIT_PER_HOUR } from "@/lib/rateLimit";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

// A receipt gets at most this many model attempts, ever, across every request
// for it. 0024's parse_attempts is the tally and is never decremented, so a
// retry granted after a transient provider failure spends one of these rather
// than handing back an unbounded replay.
const MAX_PARSE_ATTEMPTS = 3;

type ServiceClient = Awaited<ReturnType<typeof getSupabaseServiceClient>>;

// The receipt columns this route writes from a Gemini response, plus what it
// needs to find the image.
interface StoredReceipt {
  id: string;
  image_url: string | null;
  parsed_at: string | null;
  // 0024. Null on a row created before that migration — see attemptsSpent.
  parse_attempts: number | null;
  // 0024. Written by the claim and never cleared, so it survives a release.
  last_parse_attempt_at: string | null;
  merchant_name: string | null;
  date_of_receipt: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
}

const RECEIPT_COLUMNS =
  "id, image_url, parsed_at, parse_attempts, last_parse_attempt_at, merchant_name, date_of_receipt, subtotal, tax, tip, total";

// How many model attempts this receipt has already spent. A row created before
// 0024 reads null, and null is read as zero here: nothing could have retried
// it, and the single parse it may have had is recorded by parsed_at, which
// still refuses it.
function attemptsSpent(receipt: StoredReceipt): number {
  return receipt.parse_attempts ?? 0;
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined;
}

// Bind the extracted storage path to the caller. Without this, a user could
// write another user's same-bucket path into their own receipt's image_url and
// the service client (which bypasses RLS) would revive expired signed URLs for
// the victim's object.
// Built from the stored row's id, not the request's receiptId: an alternate
// uuid text form (uppercase, braces) would still resolve the same row but would
// not match a pattern built from the raw request value.
function ownStoragePath(userId: string, receipt: StoredReceipt): string | null {
  const path = extractStoragePath(receipt.image_url);
  if (!path) return null;
  const ownPathPattern = new RegExp(`^${userId}/${receipt.id}\\.[A-Za-z0-9]+$`);
  return ownPathPattern.test(path) ? path : null;
}

// Has this receipt's one parse already been spent? Two kinds of evidence.
//
// parsed_at (0020) is the authoritative one: the route stamps it before the
// model call, so it covers the parses that produced nothing — an all-nulls
// result off a blank image, the EMPTY fallback when Gemini's reply fails
// JSON.parse, a thrown error returning 500 — which is exactly the set that
// left no other trace and so replayed forever off one upload.
//
// The parsed-data checks below stay because parsed_at backfills to null: rows
// parsed before 0020 shipped have data but no stamp, and this is what still
// refuses them.
async function alreadyParsed(
  service: ServiceClient,
  receipt: StoredReceipt
): Promise<boolean> {
  if (
    present(receipt.parsed_at) ||
    present(receipt.merchant_name) ||
    present(receipt.date_of_receipt) ||
    present(receipt.subtotal) ||
    present(receipt.tax) ||
    present(receipt.tip) ||
    present(receipt.total)
  ) {
    return true;
  }
  // A parse can return only line items and no totals, so the items are the
  // other half of the evidence.
  const { count } = await service
    .from("receipt_items")
    .select("id", { count: "exact", head: true })
    .eq("receipt_id", receipt.id);
  return (count ?? 0) > 0;
}

// "taken" is a lost race or a replay; "unavailable" is a write that failed.
// Both refuse, with different status codes, so a real outage is not reported
// back as a duplicate request. "claimed" carries the exact stamp this request
// wrote, which is what lets it — and only it — release the claim again.
type ParseClaim =
  | { status: "claimed"; stamp: string }
  | { status: "taken" }
  | { status: "unavailable" };

// Take the receipt's next parse attempt, atomically. Two compare-and-set
// filters in one statement, both load-bearing:
//
//   parsed_at is null      — 0020's claim. Postgres applies the whole update
//                            under a row lock, so of N concurrent requests for
//                            the same receiptId exactly one matches a row and
//                            the rest match none.
//   parse_attempts = <n>   — 0024's tally, compared against the value this
//                            request read. A request whose read is stale
//                            matches nothing rather than overwriting a count
//                            it never saw, so the attempts can never go
//                            backwards and the cap can never be exceeded by
//                            interleaving.
//
// It also stamps last_parse_attempt_at, which is the same instant as parsed_at
// but is never cleared. That is the clock attemptsThisHour bills against, and
// parsed_at cannot serve as one because a release sets it back to null.
//
// Called immediately before the model call, never after it. Marking success
// after the fact is what left the empty-parse hole open.
async function claimParse(
  service: ServiceClient,
  userId: string,
  receipt: StoredReceipt
): Promise<ParseClaim> {
  const stamp = new Date().toISOString();
  const spent = attemptsSpent(receipt);

  const update = service
    .from("receipts")
    .update({
      parsed_at: stamp,
      last_parse_attempt_at: stamp,
      parse_attempts: spent + 1,
    })
    .eq("id", receipt.id)
    .eq("created_by", userId)
    .is("parsed_at", null);

  // A pre-0024 row carries null rather than a number, and `= null` matches
  // nothing in SQL, so the compare-and-set on the tally has to ask the
  // question the row can actually answer.
  const filtered =
    receipt.parse_attempts === null || receipt.parse_attempts === undefined
      ? update.is("parse_attempts", null)
      : update.eq("parse_attempts", receipt.parse_attempts);

  const { data, error } = await filtered.select("id");

  if (error) {
    // Fails CLOSED, unlike the rate limiter, which fails open. The limiter
    // going inert costs a caller more scans than intended; this going inert
    // costs unbounded paid inference off a single upload, which is the defect
    // this gate exists to close. The usual cause is 0020 or 0024 not applied,
    // and a refusal that says so is fixable in minutes.
    console.error(
      `[parse] could not claim receipt ${receipt.id} (${error.code ?? "no code"}: ${error.message}) — refusing rather than calling the model unguarded; are migrations 0020 and 0024 applied?`
    );
    return { status: "unavailable" };
  }
  return (data?.length ?? 0) > 0 ? { status: "claimed", stamp } : { status: "taken" };
}

// Hand the claim back after a model failure that had nothing to do with the
// receipt, so the user can retry without re-uploading the photo.
//
// This is the one write that undoes a claim, and it is deliberately narrow.
// The filter carries the exact stamp this request wrote, so only the holder of
// the claim can release it and a request that has already lost the row to
// somebody else releases nothing. parse_attempts is NOT touched: the tally is
// what keeps the retry bounded, and a release that also decremented it would
// be the unbounded replay 0020 closed, wearing a counter.
//
// Returns whether the claim is actually back. A failed release is reported to
// the caller as a plain parse failure rather than a retryable one — the
// receipt stays consumed, which is the direction that cannot cost money.
async function releaseParse(
  service: ServiceClient,
  userId: string,
  receipt: StoredReceipt,
  stamp: string
): Promise<boolean> {
  const { data, error } = await service
    .from("receipts")
    .update({ parsed_at: null })
    .eq("id", receipt.id)
    .eq("created_by", userId)
    .eq("parsed_at", stamp)
    .select("id");

  if (error) {
    console.error(
      `[parse] could not release the claim on receipt ${receipt.id} (${error.code ?? "no code"}: ${error.message}) — it stays consumed`
    );
    return false;
  }
  return (data?.length ?? 0) > 0;
}

const HOUR_MS = 60 * 60 * 1000;

// How many model attempts this caller has spent in the last hour, counted in
// attempts rather than in rows.
//
// isParseRateLimited counts receipt rows created in the last hour as a proxy
// for attempts — one row, one attempt — and that proxy was exact while a
// receipt could only ever be attempted once. A retry is a second attempt on a
// row already counted, so the limiter cannot see it and the retry would ride
// for free. Every attempt is a real paid model call, so every attempt has to
// cost a slot; this is what charges it.
//
// Counted here rather than in src/lib/rateLimit.ts, which is outside this
// change's scope: that function is shared and its row count still does its own
// job (an abandoned upload costs a slot even though it never reached the
// model). The two run side by side and the stricter one wins, so a caller gets
// at most PARSE_LIMIT_PER_HOUR model calls an hour however they are spread
// over receipts. Folding them into one query belongs in rateLimit.ts.
//
// Fails OPEN, matching the limiter it sits beside: a count that cannot be read
// must not take scanning down. Nothing is lost by that here — if 0024 is
// unapplied, this read fails and so does the claim, which fails CLOSED and
// refuses before the model.
async function attemptsThisHour(
  service: ServiceClient,
  userId: string,
  now: Date = new Date()
): Promise<number | null> {
  const { data, error } = await service
    .from("receipts")
    .select("parse_attempts")
    .eq("created_by", userId)
    .gte("last_parse_attempt_at", new Date(now.getTime() - HOUR_MS).toISOString());

  if (error) {
    console.error(
      `[parse] could not count this hour's attempts (${error.code ?? "no code"}: ${error.message}) — failing open; is migration 0024 applied?`
    );
    return null;
  }
  return (data ?? []).reduce(
    (sum, row) => sum + ((row as { parse_attempts: number | null }).parse_attempts ?? 0),
    0
  );
}

// Node's fetch reports a connection-level fault as a TypeError whose cause
// carries one of these codes. Undici's own timeouts are in the same set.
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

// Did the model call fail for a reason that has nothing to do with this
// receipt? Only three answers count: the provider returned a 5xx, the network
// dropped, or the call timed out. @google/genai throws an ApiError carrying
// the HTTP status for the first.
//
// Everything else — a 4xx, a bad API key, a thrown string, anything
// unrecognised — is NOT transient. The default is the strict one on purpose: a
// misclassification here hands back a paid model call, so an error this
// function does not recognise consumes the parse exactly as it did before.
//
// Note what is not here. A parse that SUCCEEDED and returned nothing useful
// never reaches this function at all: it does not throw, so the route returns
// 200 with the empty result and the claim stands. That is the hole 0020 exists
// to cover and no retry is granted for it.
function isTransientModelFailure(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; message?: unknown; status?: unknown; code?: unknown; cause?: unknown };

  if (typeof e.status === "number" && e.status >= 500 && e.status < 600) return true;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;

  const cause = (typeof e.cause === "object" && e.cause !== null ? e.cause : {}) as { code?: unknown };
  const code = typeof e.code === "string" ? e.code : cause.code;
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;

  // undici raises this for every connection-level failure and for nothing else.
  return err instanceof TypeError && /fetch failed/i.test(String(e.message ?? ""));
}

// A receipt row and its uploaded image exist only to be parsed. When the parse
// is refused for the hour, leaving them behind means an empty tab on the user's
// dashboard and a stored object nothing will ever read. Safe to remove here:
// ownership was verified and the row provably carries no parsed data.
//
// Only ever called on the 429 path, which runs before the parse is claimed.
// The `parsed_at is null` filter enforces that rather than trusting it: if a
// concurrent request claimed the parse in between, this deletes nothing and
// leaves that request's receipt alone.
//
// The caller also only reaches here for a receipt that has never been
// attempted, and the tally filter enforces THAT rather than trusting it. Since
// 0024 a transient failure hands the claim back, so `parsed_at is null` no
// longer means "never attempted" — a receipt waiting on a retry looks exactly
// like a fresh one to that filter alone, and deleting it would throw away the
// photo the retry exists to save the user from re-uploading. Comparing the
// tally against the value the request read refuses that even if another
// request spends an attempt in between.
async function discardUnparsedReceipt(
  service: ServiceClient,
  userId: string,
  receipt: StoredReceipt
): Promise<void> {
  const del = service
    .from("receipts")
    .delete()
    .eq("id", receipt.id)
    .eq("created_by", userId)
    .is("parsed_at", null);

  const { data: deleted } = await (receipt.parse_attempts === null ||
  receipt.parse_attempts === undefined
    ? del.is("parse_attempts", null)
    : del.eq("parse_attempts", receipt.parse_attempts)
  ).select("id");

  // Only remove the stored object once the row is confirmed gone. If a
  // concurrent request claimed the parse in between the rate-limit check and
  // here, this filter matches nothing — removing the image anyway would leave
  // the winning request's receipt pointing at storage that no longer exists.
  if ((deleted?.length ?? 0) === 0) return;

  const path = ownStoragePath(userId, receipt);
  if (path) {
    await service.storage.from("receipt-images").remove([path]);
  }
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // An empty or malformed body is a client mistake, not a crash.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { receiptId, mimeType: rawMimeType } = (body ?? {}) as {
    receiptId?: unknown;
    mimeType?: unknown;
  };
  if (typeof receiptId !== "string" || receiptId.length === 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const mimeType = typeof rawMimeType === "string" ? rawMimeType : "";

  const service = await getSupabaseServiceClient();

  // verify the receipt belongs to this user before writing
  const { data } = await service
    .from("receipts")
    .select(RECEIPT_COLUMNS)
    .eq("id", receiptId)
    .eq("created_by", user.id)
    .single();
  const receipt = data as StoredReceipt | null;

  if (!receipt) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // The hourly limiter counts receipt rows, but this route bills per
  // invocation, and only this check ties the two together: without it the same
  // receiptId replayed in a loop bought unbounded Gemini calls off one upload
  // while the count sat at 1. A receipt is consumed by its first parse.
  //
  // This read is a cheap early refusal, not the guarantee. Racing requests all
  // pass it before any of them writes, and the cost of that window is not one
  // extra call — it is however many requests an attacker fires at once, times
  // roughly 15 fresh receipts an hour. claimParse below is what actually
  // bounds it: one atomic compare-and-set, one winner.
  if (await alreadyParsed(service, receipt)) {
    return NextResponse.json({ error: "already_parsed" }, { status: 409 });
  }

  // The cap, enforced here rather than by the client asking nicely. A receipt
  // only reaches this line unclaimed, which since 0024 also covers a receipt
  // whose claim was handed back after a transient provider failure — the tally
  // is the only thing that still remembers those, and it is what bounds them.
  //
  // Refused before the rate-limit check on purpose: an exhausted receipt must
  // not be discarded as an unparsed one, because the user's three attempts
  // bought them a row they can still fill in by hand.
  if (attemptsSpent(receipt) >= MAX_PARSE_ATTEMPTS) {
    return NextResponse.json(
      { error: "parse_exhausted", attempts: MAX_PARSE_ATTEMPTS },
      { status: 409 }
    );
  }

  // Checked before the upload is read and before Gemini is called, so a caller
  // over the hourly limit costs no model spend and no storage traffic. This
  // receipt is excluded from the row count: CaptureStep creates the row before
  // calling here, so counting it made the documented ceiling of 15 behave as
  // 14. The attempt count beside it is not excluded — this receipt's own
  // earlier attempts were paid model calls like any other.
  const spentThisHour = await attemptsThisHour(service, user.id);
  const overBudget = spentThisHour !== null && spentThisHour >= PARSE_LIMIT_PER_HOUR;
  if (
    overBudget ||
    (await isParseRateLimited(service, user.id, { excludeReceiptId: receipt.id }))
  ) {
    // Only a receipt that has never been attempted is discarded. One that is
    // waiting on a retry keeps its row and its image: the user is over quota
    // for the hour, not out of attempts, and taking the photo away would make
    // them upload it again to get the attempt they still have.
    if (attemptsSpent(receipt) === 0) {
      await discardUnparsedReceipt(service, user.id, receipt);
    }
    return NextResponse.json(
      { error: "rate_limited", limit: PARSE_LIMIT_PER_HOUR },
      { status: 429 }
    );
  }

  const storagePath = ownStoragePath(user.id, receipt);
  if (!storagePath) {
    return NextResponse.json({ error: "no_image" }, { status: 400 });
  }

  const { data: signed } = await service.storage
    .from("receipt-images")
    .createSignedUrl(storagePath, 3600);

  if (!signed) {
    return NextResponse.json({ error: "no_image" }, { status: 400 });
  }

  // fetch image and convert to base64
  const imageRes = await fetch(signed.signedUrl);
  if (!imageRes.ok) {
    return NextResponse.json({ error: "no_image" }, { status: 400 });
  }
  const buffer = await imageRes.arrayBuffer();

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "bad_image" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "bad_image" }, { status: 400 });
  }

  const base64 = Buffer.from(buffer).toString("base64");

  // Last thing before the model call, and after every validation that can
  // refuse for free — a bad mime type or an unreadable upload must not burn
  // the receipt's one parse. Everything past this line is billable, so
  // everything past this line is already marked, including the outcomes that
  // write nothing back.
  const claim = await claimParse(service, user.id, receipt);
  if (claim.status === "taken") {
    return NextResponse.json({ error: "already_parsed" }, { status: 409 });
  }
  if (claim.status === "unavailable") {
    return NextResponse.json({ error: "parse_unavailable" }, { status: 503 });
  }

  let parsed;
  try {
    parsed = await parseReceiptImage(base64, mimeType);
  } catch (err) {
    console.error("[parse] Gemini error:", err);

    // A failure that had nothing to do with this receipt, with attempts left,
    // hands the claim back so the user can retry without re-uploading the
    // photo. Both halves are required: the release is what makes it retryable
    // and the tally is what keeps it bounded, and the claim is released only
    // when a retry is actually still available, so parse_retryable always
    // means a retry the server will honour.
    if (
      isTransientModelFailure(err) &&
      attemptsSpent(receipt) + 1 < MAX_PARSE_ATTEMPTS &&
      (await releaseParse(service, user.id, receipt, claim.stamp))
    ) {
      return NextResponse.json({ error: "parse_retryable" }, { status: 503 });
    }

    // Everything else: the receipt row and its image stay, but the parse is
    // spent. The user still owns a tab they can fill in by hand — CaptureStep
    // sends any non-429 failure to the manual editor with the receiptId
    // intact, and taking the row away would take that away with it.
    return NextResponse.json({ error: "parse_failed" }, { status: 500 });
  }

  // write parsed data back to db. Logged, not surfaced to the caller: the
  // parsed data returned below is what CaptureStep actually reads to fill the
  // split step, so a write-back failure here does not stop the user from
  // seeing their parse — it only means the stored row is stale until someone
  // notices the log. Failing the response instead would burn the receipt's
  // one already-claimed parse on a persistence bug the user cannot retry
  // their way out of.
  const { error: writeBackError } = await service
    .from("receipts")
    .update({
      merchant_name: parsed.merchant_name,
      date_of_receipt: parsed.date_of_receipt,
      subtotal: parsed.subtotal,
      tax: parsed.tax,
      tip: parsed.tip,
      total: parsed.total,
      status: "open",
    })
    .eq("id", receipt.id);

  if (writeBackError) {
    console.error(
      `[parse] write-back failed for receipt ${receipt.id}: ${writeBackError.message}`
    );
  }

  if (parsed.items.length > 0) {
    await service.from("receipt_items").insert(
      parsed.items.map((item, i) => ({
        receipt_id: receipt.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        sort_order: i,
      }))
    );
  }

  return NextResponse.json({ success: true, data: parsed });
}

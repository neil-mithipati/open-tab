import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { extractStoragePath } from "@/lib/storage";
import { receiptImageRetentionDays, retentionCutoff } from "@/lib/retention";

// Deletes receipt photographs N days after their parse. N is
// RECEIPT_IMAGE_RETENTION_DAYS, default 7 (see lib/retention.ts).
//
// Scheduled by the host — Vercel Cron sends a GET with
// `Authorization: Bearer $CRON_SECRET`, which is the shape the auth check
// below expects. Nothing else in the app calls this. POST is accepted too so
// the job can be kicked by hand from a terminal without pretending to be a
// browser.
//
// Two env vars, both required in production:
//   CRON_SECRET                    — shared secret; without it the route
//                                    refuses to run at all
//   RECEIPT_IMAGE_RETENTION_DAYS   — optional, N, default 7

export const maxDuration = 60;

// One run's ceiling. The job is idempotent and runs daily, so a backlog drains
// over consecutive runs rather than in one request that risks the function
// timeout halfway through and leaves storage and the rows disagreeing.
const MAX_RECEIPTS_PER_RUN = 500;

// storage.remove takes an array; keeping the batches modest means one bad path
// fails a hundred deletions rather than five hundred.
const REMOVE_BATCH = 100;

type DueRow = { id: string; image_url: string | null };

// Constant-time compare that does not leak the secret's length through an
// early return. Both sides are hashed to a fixed width first because
// timingSafeEqual throws on a length mismatch, and that throw is itself the
// length oracle it is supposed to avoid.
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Compare b with itself so the work done is the same either way, then
    // return false regardless.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail CLOSED. An unset secret means the route is unprotected, and an
  // unprotected endpoint that deletes user data on request is worse than a
  // retention job that is not running — the second is a compliance gap someone
  // notices, the first is a delete button on the open internet.
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return secretMatches(header.slice(prefix.length), expected);
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error(
      "[purge-receipt-images] CRON_SECRET is not set — refusing to run"
    );
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const days = receiptImageRetentionDays();
  const cutoff = retentionCutoff(new Date(), days);

  const service = await getSupabaseServiceClient();

  // The selection lives in SQL (migration 0026). It has to: "N days after
  // parse" is the later of parsed_at and last_parse_attempt_at, because 0025
  // sets parsed_at back to null when it hands a claim back after a transient
  // provider failure, and a receipt must not escape retention by having failed
  // to parse. Expressing that as a PostgREST filter would take an `.or()` that
  // reads as if it means the opposite.
  const { data, error } = await service.rpc("receipt_images_due_for_purge", {
    p_before: cutoff.toISOString(),
  });

  if (error) {
    console.error("[purge-receipt-images] selection failed:", error);
    return NextResponse.json({ error: "select_failed" }, { status: 500 });
  }

  const all = (data ?? []) as DueRow[];
  const batch = all.slice(0, MAX_RECEIPTS_PER_RUN);

  // A stored image_url that yields no storage path names nothing this job can
  // delete, so its row is left alone and counted. Nulling the column would be
  // the reflex — it stops the row being reselected — but if the value ever does
  // name an object in a form this parser does not recognise, that would orphan
  // the object permanently with no pointer left to find it by. A row that keeps
  // reappearing in the count is a bug someone can still fix.
  const targets: { id: string; path: string }[] = [];
  let unparseable = 0;
  for (const row of batch) {
    const path = extractStoragePath(row.image_url);
    if (!path) {
      unparseable += 1;
      console.error(
        `[purge-receipt-images] receipt ${row.id} has an image_url with no recoverable storage path — skipping`
      );
      continue;
    }
    targets.push({ id: row.id, path });
  }

  // Object first, row second — the same order deleteAccount.ts argues for, for
  // the same reason. Null the column first and a failed removal leaves an image
  // in the bucket with nothing left pointing at it. This order's failure mode
  // is a pointer to an object that is already gone, which the next run selects
  // again and removes for a second time; storage.remove is happy to be told
  // about a key twice.
  let removed = 0;
  const clearable: string[] = [];
  for (let i = 0; i < targets.length; i += REMOVE_BATCH) {
    const slice = targets.slice(i, i + REMOVE_BATCH);
    const { error: removeError } = await service.storage
      .from("receipt-images")
      .remove(slice.map((t) => t.path));

    if (removeError) {
      console.error("[purge-receipt-images] storage remove failed:", removeError);
      continue;
    }
    removed += slice.length;
    clearable.push(...slice.map((t) => t.id));
  }

  let cleared = 0;
  if (clearable.length > 0) {
    const { data: updated, error: updateError } = await service
      .from("receipts")
      .update({ image_url: null })
      .in("id", clearable)
      .select("id");

    if (updateError) {
      // The images are already gone, so this is not a data-loss path — it just
      // means the next run reselects these rows and removes nothing.
      console.error("[purge-receipt-images] clearing image_url failed:", updateError);
    }
    cleared = updated?.length ?? 0;
  }

  const summary = {
    ok: true,
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    due: all.length,
    attempted: targets.length,
    removed,
    cleared,
    skipped: unparseable,
    remaining: Math.max(all.length - batch.length, 0),
  };
  console.log("[purge-receipt-images]", JSON.stringify(summary));
  return NextResponse.json(summary);
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

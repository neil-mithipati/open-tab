import { NextResponse } from "next/server";
import { getSupabaseServerClient, getSupabaseServiceClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/gemini/parseReceipt";
import { extractStoragePath } from "@/lib/storage";
import { isParseRateLimited, PARSE_LIMIT_PER_HOUR } from "@/lib/rateLimit";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

type ServiceClient = Awaited<ReturnType<typeof getSupabaseServiceClient>>;

// The receipt columns this route writes from a Gemini response, plus what it
// needs to find the image.
interface StoredReceipt {
  id: string;
  image_url: string | null;
  merchant_name: string | null;
  date_of_receipt: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
}

const RECEIPT_COLUMNS =
  "id, image_url, merchant_name, date_of_receipt, subtotal, tax, tip, total";

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

// Anything this route writes back from a parse. A receipt carrying any of it
// has already been through Gemini once.
async function alreadyParsed(
  service: ServiceClient,
  receipt: StoredReceipt
): Promise<boolean> {
  if (
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

// A receipt row and its uploaded image exist only to be parsed. When the parse
// is refused for the hour, leaving them behind means an empty tab on the user's
// dashboard and a stored object nothing will ever read. Safe to remove here:
// ownership was verified and the row provably carries no parsed data.
async function discardUnparsedReceipt(
  service: ServiceClient,
  userId: string,
  receipt: StoredReceipt
): Promise<void> {
  const path = ownStoragePath(userId, receipt);
  if (path) {
    await service.storage.from("receipt-images").remove([path]);
  }
  await service
    .from("receipts")
    .delete()
    .eq("id", receipt.id)
    .eq("created_by", userId);
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
  // (Two requests racing before either writes can still both parse — the same
  // bounded overshoot the claim-join cap accepts, and it costs one extra call,
  // not unbounded ones.)
  if (await alreadyParsed(service, receipt)) {
    return NextResponse.json({ error: "already_parsed" }, { status: 409 });
  }

  // Checked before the upload is read and before Gemini is called, so a caller
  // over the hourly limit costs no model spend and no storage traffic. This
  // receipt is excluded from the count: CaptureStep creates the row before
  // calling here, so counting it made the documented ceiling of 15 behave as
  // 14.
  if (await isParseRateLimited(service, user.id, { excludeReceiptId: receipt.id })) {
    await discardUnparsedReceipt(service, user.id, receipt);
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

  let parsed;
  try {
    parsed = await parseReceiptImage(base64, mimeType);
  } catch (err) {
    console.error("[parse] Gemini error:", err);
    return NextResponse.json({ error: "parse_failed" }, { status: 500 });
  }

  // write parsed data back to db
  await service
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

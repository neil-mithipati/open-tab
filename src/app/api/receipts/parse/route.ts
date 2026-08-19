import { NextResponse } from "next/server";
import { getSupabaseServerClient, getSupabaseServiceClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/gemini/parseReceipt";
import { extractStoragePath } from "@/lib/storage";
import { isParseRateLimited } from "@/lib/rateLimit";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = await getSupabaseServiceClient();

  // Checked before the upload is read and before Gemini is called, so a caller
  // over the hourly limit costs no model spend and no storage traffic.
  if (await isParseRateLimited(service, user.id)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { receiptId, mimeType } = await request.json();

  // verify the receipt belongs to this user before writing
  const { data: receipt } = await service
    .from("receipts")
    .select("id, image_url")
    .eq("id", receiptId)
    .eq("created_by", user.id)
    .single();

  if (!receipt) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const storagePath = extractStoragePath(receipt.image_url);
  if (!storagePath) {
    return NextResponse.json({ error: "no_image" }, { status: 400 });
  }

  // Bind the extracted storage path to the caller. Without this, a user
  // could write another user's same-bucket path into their own receipt's
  // image_url and the service client (which bypasses RLS) would revive
  // expired signed URLs for the victim's object.
  // Built from the stored row's id, not the request's receiptId: an alternate
  // uuid text form (uppercase, braces) would still resolve the same row but
  // would not match a pattern built from the raw request value.
  const ownPathPattern = new RegExp(`^${user.id}/${receipt.id}\\.[A-Za-z0-9]+$`);
  if (!ownPathPattern.test(storagePath)) {
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
    parsed = await parseReceiptImage(base64, mimeType ?? "image/jpeg");
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
    .eq("id", receiptId);

  if (parsed.items.length > 0) {
    await service.from("receipt_items").insert(
      parsed.items.map((item, i) => ({
        receipt_id: receiptId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        sort_order: i,
      }))
    );
  }

  return NextResponse.json({ success: true, data: parsed });
}

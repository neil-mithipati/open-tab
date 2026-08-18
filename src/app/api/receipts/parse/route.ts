import { NextResponse } from "next/server";
import { getSupabaseServerClient, getSupabaseServiceClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/gemini/parseReceipt";
import { extractStoragePath } from "@/lib/storage";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { receiptId, mimeType } = await request.json();

  // verify the receipt belongs to this user before writing
  const service = await getSupabaseServiceClient();
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

  const { data: signed } = await service.storage
    .from("receipt-images")
    .createSignedUrl(storagePath, 3600);

  if (!signed) {
    return NextResponse.json({ error: "no_image" }, { status: 400 });
  }

  // fetch image and convert to base64
  const imageRes = await fetch(signed.signedUrl);
  const buffer = await imageRes.arrayBuffer();
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

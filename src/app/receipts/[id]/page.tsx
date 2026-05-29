import { redirect, notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { EditableItem, FlowParticipant } from "@/types";
import { ReceiptEditPage } from "./ReceiptEditPage";

interface Props {
  params: Promise<{ id: string }>;
}

function extractStoragePath(url: string | null): string | null {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const marker = "/receipt-images/";
    const idx = pathname.indexOf(marker);
    return idx === -1 ? null : pathname.slice(idx + marker.length);
  } catch {
    return null;
  }
}

export default async function ReceiptDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { data: receipt } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", id)
    .single();

  if (!receipt) notFound();

  const [{ data: items }, { data: participants }] = await Promise.all([
    supabase.from("receipt_items").select("*").eq("receipt_id", id).order("sort_order"),
    supabase.from("receipt_participants").select("*").eq("receipt_id", id),
  ]);

  // Refresh the signed URL so the original image is viewable
  const storagePath = extractStoragePath(receipt.image_url);
  const { data: signedUrlData } = storagePath
    ? await supabase.storage.from("receipt-images").createSignedUrl(storagePath, 3600)
    : { data: null };

  const flowItems: EditableItem[] = (items ?? []).map((item) => ({
    clientId: `item-${item.id}`,
    dbId: item.id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
  }));

  const flowParticipants: FlowParticipant[] = (participants ?? []).map((p) => ({
    clientId: `p-${p.id}`,
    dbId: p.id,
    type: (p.user_id ? "friend" : "manual") as "friend" | "manual",
    userId: p.user_id ?? undefined,
    displayName: p.display_name,
    venmoUsername: p.venmo_username,
    isOwner: p.is_owner,
  }));

  return (
    <ReceiptEditPage
      seed={{
        receiptId: id,
        signedUrl: signedUrlData?.signedUrl ?? null,
        mimeType: null,
        merchantName: receipt.merchant_name ?? null,
        dateOfReceipt: receipt.date_of_receipt ?? null,
        subtotal: receipt.subtotal ?? null,
        tax: receipt.tax ?? null,
        tip: receipt.tip ?? null,
        total: receipt.total ?? null,
        items: flowItems,
        participants: flowParticipants,
        splitMode: (receipt.split_mode as "equal" | "by_item") ?? "equal",
        assignments: {},
      }}
    />
  );
}

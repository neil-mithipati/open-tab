import { Suspense } from "react";
import { connection } from "next/server";
import { redirect, notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getReceiptDetail, getReceiptImageUrl } from "@/lib/queries";
import { getSharedReceipt, getClaimCharges } from "@/app/actions/claim";
import { buildTabUrl } from "@/lib/qr/inviteUrl";
import { extractStoragePath } from "@/lib/storage";
import type { EditableItem, FlowParticipant } from "@/types";
import { ReceiptEditPage } from "./ReceiptEditPage";
import { ClaimOwnerView } from "@/components/receipt/ClaimOwnerView";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ReceiptDetailPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-dvh text-secondary text-sm">Loading…</div>}>
      <ReceiptDetailContent params={params} />
    </Suspense>
  );
}

async function ReceiptDetailContent({ params }: Props) {
  await connection();
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { receipt, items, participants } = await getReceiptDetail(id);

  if (!receipt) notFound();

  const isOwner = receipt.created_by === user.id;
  const isAuthorised =
    isOwner ||
    participants.some((p: { user_id: string | null }) => p.user_id === user.id);
  if (!isAuthorised) notFound();

  const imageStoragePath = extractStoragePath(receipt.image_url);

  // Owner view of a shared (crowd-claim) receipt: live claim progress while
  // sharing, then collection once closed. Editing stays in ReceiptEditPage,
  // which the owner returns to via "Reopen editing" (status → open).
  if (
    isOwner &&
    receipt.share_token &&
    (receipt.status === "shared" || receipt.status === "closed")
  ) {
    const [shared, chargesResult, sharedImageUrl] = await Promise.all([
      getSharedReceipt(receipt.share_token),
      getClaimCharges(id),
      imageStoragePath ? getReceiptImageUrl(imageStoragePath) : null,
    ]);
    if (shared) {
      return (
        <ClaimOwnerView
          shareUrl={buildTabUrl(receipt.share_token)}
          initial={shared}
          initialCharges={Array.isArray(chargesResult) ? chargesResult : []}
          imageUrl={sharedImageUrl}
        />
      );
    }
  }

  const signedUrl = imageStoragePath ? await getReceiptImageUrl(imageStoragePath) : null;

  const flowItems: EditableItem[] = items.map((item: { id: string; name: string; price: number; quantity: number }) => ({
    clientId: `item-${item.id}`,
    dbId: item.id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
  }));

  const flowParticipants: FlowParticipant[] = participants.map((p: { id: string; user_id: string | null; display_name: string; venmo_username: string; is_owner: boolean }) => ({
    clientId: `p-${p.id}`,
    dbId: p.id,
    type: (p.user_id ? "friend" : "manual") as "friend" | "manual",
    userId: p.user_id ?? undefined,
    displayName: p.display_name,
    venmoUsername: p.venmo_username,
    isOwner: p.is_owner,
  }));

  // Reconstruct item→participant assignments from DB
  const assignments: Record<string, string[]> = {};
  for (const item of items as Array<{ id: string; item_assignments?: Array<{ receipt_item_id: string; participant_id: string }> }>) {
    if (!item.item_assignments?.length) continue;
    const itemClientId = `item-${item.id}`;
    assignments[itemClientId] = item.item_assignments.map((a) => `p-${a.participant_id}`);
  }

  return (
    <ReceiptEditPage
      seed={{
        receiptId: id,
        signedUrl,
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
        assignments,
      }}
    />
  );
}

import { Suspense } from "react";
import { connection } from "next/server";
import { redirect, notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getReceiptDetail } from "@/lib/queries";
import { getSharedReceipt, getClaimCharges } from "@/app/actions/claim";
import { buildTabUrl } from "@/lib/qr/inviteUrl";
import type { EditableItem, FlowParticipant } from "@/types";
import { ReceiptEditPage } from "./ReceiptEditPage";
import { ClaimOwnerView } from "@/components/receipt/ClaimOwnerView";

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

  // Owner view of a shared (crowd-claim) receipt: live claim progress while
  // claiming, then collection once closed. Editing stays in ReceiptEditPage,
  // which the owner returns to via "Reopen editing" (status → reviewing).
  if (
    isOwner &&
    receipt.share_token &&
    (receipt.status === "claiming" ||
      receipt.status === "charging" ||
      receipt.status === "settled")
  ) {
    const [shared, chargesResult] = await Promise.all([
      getSharedReceipt(receipt.share_token),
      getClaimCharges(id),
    ]);
    if (shared) {
      return (
        <ClaimOwnerView
          shareUrl={buildTabUrl(receipt.share_token)}
          initial={shared}
          initialCharges={Array.isArray(chargesResult) ? chargesResult : []}
        />
      );
    }
  }

  const storagePath = extractStoragePath(receipt.image_url);
  const { data: signedUrlData } = storagePath
    ? await supabase.storage.from("receipt-images").createSignedUrl(storagePath, 3600)
    : { data: null };

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
        assignments,
      }}
    />
  );
}

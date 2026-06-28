import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { shareReceipt } from "@/app/actions/claim";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import type { FlowParticipant } from "@/types";

type ShareResult =
  | { url: string }
  | { error: string }
  | { needsVenmo: true };

// Persists the current receipt (items + participants + totals) for the
// "crowd-claim" share, then opens it via shareReceipt. The owner must have a
// Venmo username so claimers know who owns the check — if they don't yet
// (e.g. a guest), returns { needsVenmo: true } so the caller can prompt.
export async function persistAndShare(state: ReceiptFlowState): Promise<ShareResult> {
  const { receiptId, items, tax, tip, total, merchantName } = state;
  if (!receiptId) return { error: "No receipt to share." };

  const supabase = getSupabaseBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // The owner needs a Venmo username (so unclaimed items split across them and
  // closeClaiming knows who to reimburse). Block on it before sharing.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, venmo_username")
    .eq("id", user.id)
    .single();
  if (!profile?.venmo_username) return { needsVenmo: true };

  let parts: FlowParticipant[] = state.participants;
  if (!parts.some((p) => p.isOwner)) {
    parts = [
      ...parts,
      {
        clientId: "owner",
        type: "friend",
        userId: user.id,
        displayName: profile.display_name,
        venmoUsername: profile.venmo_username,
        isOwner: true,
      },
    ];
  }

  const itemSubtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const totalAmount = total ?? itemSubtotal + (tax ?? 0) + (tip ?? 0);

  await supabase.from("receipt_participants").delete().eq("receipt_id", receiptId);
  await supabase.from("receipt_items").delete().eq("receipt_id", receiptId);
  await Promise.all([
    items.length > 0
      ? supabase.from("receipt_items").insert(
          items.map((item, i) => ({
            receipt_id: receiptId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            sort_order: i,
          }))
        )
      : Promise.resolve(),
    parts.length > 0
      ? supabase.from("receipt_participants").insert(
          parts.map((p) => ({
            receipt_id: receiptId,
            user_id: p.userId ?? null,
            venmo_username: p.venmoUsername,
            display_name: p.displayName,
            is_owner: p.isOwner,
          }))
        )
      : Promise.resolve(),
    supabase.from("receipts").update({
      split_mode: "by_item",
      merchant_name: merchantName,
      subtotal: Math.round(itemSubtotal * 100) / 100,
      tax,
      tip,
      total: Math.round(totalAmount * 100) / 100,
    }).eq("id", receiptId),
  ]);

  return shareReceipt(receiptId);
}

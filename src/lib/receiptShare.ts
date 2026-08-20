import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { shareReceipt } from "@/app/actions/claim";
import { saveReceiptState } from "@/app/actions/saveReceipt";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import type { FlowParticipant } from "@/types";
import { itemsSubtotalCents } from "@/lib/money";

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
    // If the owner is already in the list under their own Venmo username, flag
    // that row instead of appending a second one — one participant per username
    // per receipt is now a unique index, not a convention.
    const ownerVenmo = profile.venmo_username.toLowerCase();
    const self = parts.find((p) => p.venmoUsername.toLowerCase() === ownerVenmo);
    parts = self
      ? parts.map((p) =>
          p === self ? { ...p, userId: user.id, isOwner: true } : p
        )
      : [
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

  // Integer cents throughout — nothing to round.
  const itemSubtotalCents = itemsSubtotalCents(items);
  const totalCents = total ?? itemSubtotalCents + (tax ?? 0) + (tip ?? 0);

  // One transaction on the server. Claiming starts from a clean slate, so no
  // assignments or charges are sent; the swap clears any left from an earlier
  // save. Status is left alone — shareReceipt moves it to "shared".
  const saved = await saveReceiptState({
    receiptId,
    items: items.map((item) => ({
      clientId: item.clientId,
      // Keep the row id when this item came from the database, so re-sharing a
      // tab does not re-mint the ids the claimers' open pages are holding.
      dbId: item.dbId,
      name: item.name,
      priceCents: item.price,
      quantity: item.quantity,
    })),
    participants: parts.map((p) => ({
      clientId: p.clientId,
      userId: p.userId ?? null,
      venmoUsername: p.venmoUsername,
      displayName: p.displayName,
      isOwner: p.isOwner,
    })),
    assignments: {},
    charges: [],
    receipt: {
      splitMode: "by_item",
      merchantName,
      subtotalCents: itemSubtotalCents,
      taxCents: tax,
      tipCents: tip,
      totalCents,
    },
  });
  if (saved.error) return { error: saved.error };

  return shareReceipt(receiptId);
}

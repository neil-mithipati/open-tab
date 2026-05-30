"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReceiptEditFlow } from "@/hooks/useReceiptEditFlow";
import { ReceiptSplitStep } from "@/components/receipt/ReceiptSplitStep";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { computeEqualCharges, computeItemCharges } from "@/lib/utils";
import type { ComputedCharge } from "@/types";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import { X, Check } from "lucide-react";

interface Props {
  seed: Omit<ReceiptFlowState, "step" | "imageFile">;
}

export function ReceiptEditPage({ seed }: Props) {
  const flow = useReceiptEditFlow(seed);
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [paidClientIds, setPaidClientIds] = useState<Set<string>>(new Set());

  useEffect(() => { router.prefetch("/dashboard"); }, [router]);

  const { splitMode, participants, items, assignments, tax, tip, total, receiptId, merchantName, dateOfReceipt } = flow.state;

  const nonOwnerParticipants = participants.filter((p) => !p.isOwner);
  const allItemsAssigned = items.length > 0 && items.every((item) => (assignments[item.clientId] ?? []).length >= 1);

  function handleTogglePaid(clientId: string) {
    setPaidClientIds((prev) => {
      const next = new Set(prev);
      next.has(clientId) ? next.delete(clientId) : next.add(clientId);
      return next;
    });
  }

  async function handleDone() {
    if (!receiptId) { router.push("/dashboard"); return; }
    setSaving(true);

    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const itemSubtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
    const totalAmount = total ?? itemSubtotal + (tax ?? 0) + (tip ?? 0);

    // Compute charges only if split is complete
    let computed: ComputedCharge[] = [];
    if (splitMode === "equal" && nonOwnerParticipants.length >= 1) {
      computed = computeEqualCharges(totalAmount, participants, merchantName, dateOfReceipt);
    } else if (splitMode === "by_item" && allItemsAssigned && nonOwnerParticipants.length >= 1) {
      computed = computeItemCharges(items, assignments, participants, itemSubtotal, tax ?? 0, tip ?? 0, merchantName, dateOfReceipt);
    }

    // Round 1: clear old data (cascade handles item_assignments and charges)
    await Promise.all([
      supabase.from("receipt_items").delete().eq("receipt_id", receiptId),
      supabase.from("receipt_participants").delete().eq("receipt_id", receiptId),
    ]);

    // Round 2: re-insert items and participants, get DB IDs back
    const [{ data: dbItems }, { data: dbParticipants }] = await Promise.all([
      items.length > 0
        ? supabase.from("receipt_items").insert(
            items.map((item, i) => ({
              receipt_id: receiptId,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              sort_order: i,
            }))
          ).select("id, sort_order")
        : Promise.resolve({ data: [] }),
      participants.length > 0
        ? supabase.from("receipt_participants").insert(
            participants.map((p) => ({
              receipt_id: receiptId,
              user_id: p.userId ?? null,
              venmo_username: p.venmoUsername,
              display_name: p.displayName,
              is_owner: p.isOwner,
            }))
          ).select("id, venmo_username")
        : Promise.resolve({ data: [] }),
    ]);

    // Build lookup maps
    const sortedDbItems = [...(dbItems ?? [])].sort((a: { id: string; sort_order: number }, b: { id: string; sort_order: number }) => a.sort_order - b.sort_order);
    const itemClientToDbId: Record<string, string> = {};
    items.forEach((item, i) => {
      if (sortedDbItems[i]) itemClientToDbId[item.clientId] = sortedDbItems[i].id;
    });

    const venmoToDbId = Object.fromEntries(
      (dbParticipants ?? []).map((p: { id: string; venmo_username: string }) => [p.venmo_username, p.id])
    );
    const participantClientToDbId = Object.fromEntries(
      participants.map((p) => [p.clientId, venmoToDbId[p.venmoUsername]])
    );

    // Build item_assignments rows
    const assignmentRows: { receipt_item_id: string; participant_id: string }[] = [];
    for (const [itemClientId, pClientIds] of Object.entries(assignments)) {
      const itemDbId = itemClientToDbId[itemClientId];
      if (!itemDbId) continue;
      for (const pClientId of pClientIds) {
        const pDbId = participantClientToDbId[pClientId];
        if (!pDbId) continue;
        assignmentRows.push({ receipt_item_id: itemDbId, participant_id: pDbId });
      }
    }

    const chargeRows = computed
      .map((c) => ({
        receipt_id: receiptId,
        from_user_id: user.id,
        to_participant_id: venmoToDbId[c.participant.venmoUsername] ?? null,
        amount: c.amount,
        venmo_link: c.venmoLink,
        paid_at: paidClientIds.has(c.participant.clientId) ? new Date().toISOString() : null,
      }))
      .filter((r): r is typeof r & { to_participant_id: string } => r.to_participant_id !== null);

    const allPaid = computed.length > 0 && computed.every((c) => paidClientIds.has(c.participant.clientId));
    const status = allPaid ? "settled" : computed.length > 0 ? "charging" : "reviewing";

    // Round 3: write assignments, charges, update receipt
    await Promise.all([
      assignmentRows.length > 0 ? supabase.from("item_assignments").insert(assignmentRows) : Promise.resolve(),
      chargeRows.length > 0 ? supabase.from("charges").insert(chargeRows) : Promise.resolve(),
      supabase.from("receipts").update({
        status,
        split_mode: splitMode,
        merchant_name: merchantName,
        subtotal: Math.round(itemSubtotal * 100) / 100,
        tax: tax,
        tip: tip,
        total: Math.round(totalAmount * 100) / 100,
      }).eq("id", receiptId),
    ]);

    router.push("/dashboard");
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-2">
        <button
          onClick={() => { flow.reset(); router.push("/dashboard"); }}
          className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          onClick={handleDone}
          disabled={saving}
          className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors disabled:opacity-50"
          aria-label="Done"
        >
          <Check className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 px-4 pb-8 max-w-md mx-auto w-full">
        <ReceiptSplitStep
          flow={flow}
          hideRetake
          paidClientIds={paidClientIds}
          onTogglePaid={handleTogglePaid}
        />
      </div>
    </div>
  );
}

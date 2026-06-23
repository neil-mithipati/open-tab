"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReceiptEditFlow } from "@/hooks/useReceiptEditFlow";
import { ReceiptSplitStep } from "@/components/receipt/ReceiptSplitStep";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { computeEqualCharges, computeItemCharges } from "@/lib/utils";
import { shareReceipt } from "@/app/actions/claim";
import type { ComputedCharge, FlowParticipant } from "@/types";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import { X, Check, AlignJustify, Image as ImageIcon, Share2 } from "lucide-react";

interface Props {
  seed: Omit<ReceiptFlowState, "step" | "imageFile">;
}

export function ReceiptEditPage({ seed }: Props) {
  const flow = useReceiptEditFlow(seed);
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [paidClientIds, setPaidClientIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"parsed" | "original">("parsed");

  useEffect(() => { router.prefetch("/dashboard"); }, [router]);

  const { splitMode, participants, items, assignments, tax, tip, total, receiptId, merchantName, dateOfReceipt } = flow.state;

  const nonOwnerParticipants = participants.filter((p) => !p.isOwner);
  const allItemsAssigned = items.length > 0 && items.every((item) => (assignments[item.clientId] ?? []).length >= 1);

  // Mirror the recipient charge cards shown in ReceiptSplitStep, so the Done
  // button can highlight once every recipient has been marked paid.
  const anyItemsAssigned = items.some((item) => (assignments[item.clientId] ?? []).length >= 1);
  const liveItemSubtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const liveTotal = total ?? liveItemSubtotal + (tax ?? 0) + (tip ?? 0);
  const recipientCharges =
    splitMode === "equal" && nonOwnerParticipants.length >= 1
      ? computeEqualCharges(liveTotal, participants, merchantName, items)
      : splitMode === "by_item" && anyItemsAssigned && nonOwnerParticipants.length >= 1
        ? computeItemCharges(items, assignments, participants, liveItemSubtotal, tax ?? 0, tip ?? 0, merchantName, dateOfReceipt).filter((c) => c.amount > 0)
        : [];
  const allPaid = recipientCharges.length > 0 && recipientCharges.every((c) => paidClientIds.has(c.participant.clientId));

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
      computed = computeEqualCharges(totalAmount, participants, merchantName, items);
    } else if (splitMode === "by_item" && allItemsAssigned && nonOwnerParticipants.length >= 1) {
      computed = computeItemCharges(items, assignments, participants, itemSubtotal, tax ?? 0, tip ?? 0, merchantName, dateOfReceipt);
    }

    // Round 1: delete participants first (cascades charges + item_assignments),
    // then items (cascade on item_assignments is already gone)
    await supabase.from("receipt_participants").delete().eq("receipt_id", receiptId);
    await supabase.from("receipt_items").delete().eq("receipt_id", receiptId);

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

    // Manual mode: clicking Done finalizes the check (→ closed).
    // Without a complete split there are no charges, so it stays open.
    const status = computed.length > 0 ? "closed" : "open";

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

  // Share for "crowd-claim": persist the current items/owner, then open the
  // receipt for claiming. No claims exist yet, so a clean rewrite is safe.
  async function handleShare() {
    if (!receiptId) return;
    setSharing(true);

    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSharing(false); return; }

    // Ensure an owner participant exists so unclaimed items split across the
    // owner too, and so closeClaiming knows who to reimburse.
    let parts: FlowParticipant[] = participants;
    if (!parts.some((p) => p.isOwner)) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, venmo_username")
        .eq("id", user.id)
        .single();
      if (profile?.venmo_username) {
        parts = [...parts, {
          clientId: "owner",
          type: "friend",
          userId: user.id,
          displayName: profile.display_name,
          venmoUsername: profile.venmo_username,
          isOwner: true,
        }];
      }
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

    const result = await shareReceipt(receiptId);
    setSharing(false);
    if ("url" in result) {
      try { await navigator.clipboard.writeText(result.url); } catch {}
      router.refresh();
    }
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
        {flow.state.signedUrl ? (
          <div className="glass-panel-sm rounded-2xl p-1 flex gap-1">
            <button
              onClick={() => setView("parsed")}
              className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${view === "parsed" ? "bg-white/15 text-primary" : "text-tertiary hover:text-secondary"}`}
              aria-label="Parsed receipt"
            >
              <AlignJustify className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView("original")}
              className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${view === "original" ? "bg-white/15 text-primary" : "text-tertiary hover:text-secondary"}`}
              aria-label="Original receipt"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            disabled={sharing || saving}
            className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors disabled:opacity-50"
            aria-label="Share to collect"
            title="Share a link so friends can claim their items"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleDone}
            disabled={saving}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
              allPaid
                ? "bg-emerald-500 text-white hover:bg-emerald-400"
                : "glass-panel-sm text-secondary hover:text-primary"
            }`}
            aria-label="Done"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 px-4 pb-8 max-w-md mx-auto w-full">
        <ReceiptSplitStep
          flow={flow}
          hideRetake
          paidClientIds={paidClientIds}
          onTogglePaid={handleTogglePaid}
          view={view}
          onViewChange={setView}
        />
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReceiptEditFlow } from "@/hooks/useReceiptEditFlow";
import { ReceiptSplitStep } from "@/components/receipt/ReceiptSplitStep";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { computeEqualCharges, computeItemCharges } from "@/lib/utils";
import { persistAndShare } from "@/lib/receiptShare";
import { saveReceiptState } from "@/app/actions/saveReceipt";
import { refreshUserCaches } from "@/app/actions/cache";
import { VenmoPromptModal } from "@/components/receipt/VenmoPromptModal";
import type { ComputedCharge } from "@/types";
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
  const [showVenmoPrompt, setShowVenmoPrompt] = useState(false);
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
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
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

    // Manual mode: clicking Done finalizes the check (→ closed).
    // Without a complete split there are no charges, so it stays open.
    const status = computed.length > 0 ? "closed" : "open";

    // One round trip, one transaction: the swap either lands whole or the tab
    // is left exactly as it was.
    const saved = await saveReceiptState({
      receiptId,
      items: items.map((item) => ({
        clientId: item.clientId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      participants: participants.map((p) => ({
        clientId: p.clientId,
        userId: p.userId ?? null,
        venmoUsername: p.venmoUsername,
        displayName: p.displayName,
        isOwner: p.isOwner,
      })),
      assignments,
      charges: computed.map((c) => ({
        participantClientId: c.participant.clientId,
        amount: c.amount,
        venmoLink: c.venmoLink,
        paidAt: paidClientIds.has(c.participant.clientId) ? new Date().toISOString() : null,
      })),
      receipt: {
        status,
        splitMode,
        merchantName,
        subtotal: Math.round(itemSubtotal * 100) / 100,
        tax,
        tip,
        total: Math.round(totalAmount * 100) / 100,
      },
    });
    if (saved.error) { setSaving(false); return; }

    // The profile and friend caches can also be stale by now, so drop them
    // before navigating or the dashboard renders without this tab.
    await refreshUserCaches();

    router.push("/dashboard");
  }

  // Share for "crowd-claim": persist the current items/owner, then open the
  // receipt for claiming. Guests are prompted for a Venmo first via the modal.
  async function handleShare() {
    if (!receiptId) return;
    setSharing(true);
    const result = await persistAndShare(flow.state);
    setSharing(false);
    if ("needsVenmo" in result) { setShowVenmoPrompt(true); return; }
    if ("error" in result) return;
    try { await navigator.clipboard.writeText(result.url); } catch {}
    router.refresh();
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

      {showVenmoPrompt && (
        <VenmoPromptModal
          onSaved={() => { setShowVenmoPrompt(false); handleShare(); }}
          onCancel={() => setShowVenmoPrompt(false)}
        />
      )}
    </div>
  );
}

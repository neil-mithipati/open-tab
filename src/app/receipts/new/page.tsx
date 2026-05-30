"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { CaptureStep } from "@/components/receipt/CaptureStep";
import { ScanningStep } from "@/components/receipt/ScanningStep";
import { ReceiptSplitStep } from "@/components/receipt/ReceiptSplitStep";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { computeEqualCharges, computeItemCharges } from "@/lib/utils";
import type { ComputedCharge } from "@/types";
import { X, Check } from "lucide-react";

export default function NewReceiptPage() {
  const flow = useReceiptFlow();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const { step, splitMode, participants, items, assignments, tax, tip, total, receiptId, merchantName, dateOfReceipt } = flow.state;

  const nonOwnerParticipants = participants.filter((p) => !p.isOwner);
  const allItemsAssigned = items.length > 0 && items.every((item) => (assignments[item.clientId] ?? []).length >= 1);
  const canFinalize =
    (splitMode === "equal" && nonOwnerParticipants.length >= 1) ||
    (splitMode === "by_item" && allItemsAssigned && nonOwnerParticipants.length >= 1);

  async function handleDone() {
    if (!receiptId) { flow.reset(); router.push("/dashboard"); return; }
    setSaving(true);

    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const totalAmount = total ?? items.reduce((s, it) => s + it.price * it.quantity, 0) + (tax ?? 0) + (tip ?? 0);

    let computed: ComputedCharge[];
    if (splitMode === "equal") {
      computed = computeEqualCharges(totalAmount, participants, merchantName, dateOfReceipt);
    } else {
      const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
      computed = computeItemCharges(items, assignments, participants, subtotal, tax ?? 0, tip ?? 0, merchantName, dateOfReceipt);
    }

    // Round 1: delete in parallel
    await Promise.all([
      supabase.from("receipt_participants").delete().eq("receipt_id", receiptId),
      supabase.from("charges").delete().eq("receipt_id", receiptId),
    ]);

    // Round 2: insert participants and get IDs back in the same request
    const { data: dbParticipants } = await supabase
      .from("receipt_participants")
      .insert(
        participants.map((p) => ({
          receipt_id: receiptId,
          user_id: p.userId ?? null,
          venmo_username: p.venmoUsername,
          display_name: p.displayName,
          is_owner: p.isOwner,
        }))
      )
      .select("id, venmo_username");

    const venmoToDbId = Object.fromEntries(
      (dbParticipants ?? []).map((p: { id: string; venmo_username: string }) => [p.venmo_username, p.id])
    );

    const chargeRows = computed
      .map((c) => ({
        receipt_id: receiptId,
        from_user_id: user.id,
        to_participant_id: venmoToDbId[c.participant.venmoUsername] ?? null,
        amount: c.amount,
        venmo_link: c.venmoLink,
      }))
      .filter((r): r is typeof r & { to_participant_id: string } => r.to_participant_id !== null);

    // Round 3: write charges and update receipt in parallel
    await Promise.all([
      chargeRows.length > 0 ? supabase.from("charges").insert(chargeRows) : Promise.resolve(),
      supabase.from("receipts").update({ status: "charging", split_mode: splitMode, merchant_name: merchantName }).eq("id", receiptId),
    ]);

    flow.reset();
    router.push(`/receipts/${receiptId}`);
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-2">
        {step !== "scanning" ? (
          <button
            onClick={() => router.push("/dashboard")}
            className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-9 h-9" />
        )}
        {step === "split" && canFinalize ? (
          <button
            onClick={handleDone}
            disabled={saving}
            className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors disabled:opacity-50"
            aria-label="Done"
          >
            <Check className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-9 h-9" />
        )}
      </div>

      <StepDots step={step} />

      <div className="flex-1 px-4 pb-8 max-w-md mx-auto w-full">
        {step === "capture" && <CaptureStep flow={flow} />}
        {step === "scanning" && <ScanningStep />}
        {step === "split" && <ReceiptSplitStep flow={flow} />}
      </div>
    </div>
  );
}

const ORDERED_STEPS = ["capture", "split"] as const;

function StepDots({ step }: { step: string }) {
  const idx = ORDERED_STEPS.indexOf(step as (typeof ORDERED_STEPS)[number]);
  return (
    <div className="flex items-center justify-center gap-1.5 py-2">
      {ORDERED_STEPS.map((s, i) => (
        <div
          key={s}
          className={`rounded-full transition-all duration-300 ${
            i === idx
              ? "w-5 h-1.5 bg-brand"
              : i < idx
              ? "w-1.5 h-1.5 bg-brand/50"
              : "w-1.5 h-1.5 bg-white/20"
          }`}
        />
      ))}
    </div>
  );
}

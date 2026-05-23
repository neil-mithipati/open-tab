"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import { formatCurrency, computeEqualCharges, computeItemCharges } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { ExternalLink } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

export function ChargeReviewStep({ flow }: { flow: Flow }) {
  const { state, reset } = flow;
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const total = state.total ?? (
    state.items.reduce((s, it) => s + it.price * it.quantity, 0) +
    (state.tax ?? 0) + (state.tip ?? 0)
  );

  const charges = useMemo(() => {
    if (state.splitMode === "equal") {
      return computeEqualCharges(total, state.participants, state.merchantName, state.dateOfReceipt);
    }
    const subtotal = state.items.reduce((s, it) => s + it.price * it.quantity, 0);
    return computeItemCharges(
      state.items,
      state.assignments,
      state.participants,
      subtotal,
      state.tax ?? 0,
      state.tip ?? 0,
      state.merchantName,
      state.dateOfReceipt
    );
  }, [state]);

  async function handleDone() {
    setSaving(true);
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !state.receiptId) return;

    // fetch participant db IDs
    const { data: dbParticipants } = await supabase
      .from("receipt_participants")
      .select("id, venmo_username")
      .eq("receipt_id", state.receiptId);

    const venmoToDbId = Object.fromEntries(
      (dbParticipants ?? []).map((p: { id: string; venmo_username: string }) => [p.venmo_username, p.id])
    );

    // write charges
    const chargeRows = charges.map((c) => ({
      receipt_id: state.receiptId,
      from_user_id: user.id,
      to_participant_id: venmoToDbId[c.participant.venmoUsername] ?? null,
      amount: c.amount,
      venmo_link: c.venmoLink,
    })).filter((r): r is typeof r & { to_participant_id: string } => r.to_participant_id !== null);

    if (chargeRows.length > 0) {
      await supabase.from("charges").insert(chargeRows);
    }

    await supabase.from("receipts").update({ status: "charging", split_mode: state.splitMode }).eq("id", state.receiptId);

    reset();
    router.push(`/receipts/${state.receiptId}`);
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <GlassCard size="sm" className="p-4 flex justify-between items-center">
        <span className="text-secondary text-sm">{state.merchantName ?? "Receipt"} — Total</span>
        <span className="font-bold text-primary text-lg">{formatCurrency(total)}</span>
      </GlassCard>

      <div className="flex flex-col gap-3">
        {charges.map((c) => (
          <GlassCard key={c.participant.clientId} size="sm" className="p-4 flex items-center gap-3">
            <Avatar name={c.participant.displayName} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-primary">@{c.participant.displayName}</p>
              <p className="text-sm text-secondary">@{c.participant.venmoUsername}</p>
            </div>
            <p className="font-semibold text-primary flex-shrink-0">{formatCurrency(c.amount)}</p>
            <button
              onClick={() => {
                const isMobile = /Mobi|Android/i.test(navigator.userAgent);
                window.open(isMobile ? c.venmoAppLink : c.venmoLink, "_blank");
              }}
              className="flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-light flex-shrink-0"
            >
              Venmo <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </GlassCard>
        ))}
      </div>

      <GlassButton size="lg" loading={saving} onClick={handleDone} className="mt-2">
        Done — save charges
      </GlassButton>
    </div>
  );
}

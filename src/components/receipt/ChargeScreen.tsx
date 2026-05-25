"use client";

import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import { VenmoIcon } from "@/components/ui/VenmoIcon";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { ExternalLink } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

export function ChargeScreen({ flow }: { flow: Flow }) {
  const router = useRouter();
  const { state, reset } = flow;
  const { charges, merchantName, dateOfReceipt, receiptId } = state;

  const note = `open-tab: ${merchantName ?? "receipt"}${dateOfReceipt ? ` ${dateOfReceipt}` : ""}`;

  function openVenmo(venmoLink: string, venmoAppLink: string) {
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    window.open(isMobile ? venmoAppLink : venmoLink, "_blank");
  }

  function handleDone() {
    const dest = receiptId ? `/receipts/${receiptId}` : "/dashboard";
    reset();
    router.push(dest);
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-primary">{merchantName ?? "Receipt"}</h2>
        {dateOfReceipt && (
          <p className="text-sm text-secondary">{formatDate(dateOfReceipt)}</p>
        )}
        <span className="inline-flex self-start mt-2 text-xs font-mono text-tertiary glass-panel-sm px-2.5 py-1 rounded-full">
          {note}
        </span>
      </div>

      {/* Charges table */}
      <div className="flex flex-col gap-2">
        {charges.map((c) => (
          <GlassCard key={c.participant.clientId} size="sm" className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={c.participant.displayName} size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-primary">@{c.participant.venmoUsername}</p>
                {c.participant.displayName !== c.participant.venmoUsername && (
                  <p className="text-xs text-secondary truncate">{c.participant.displayName}</p>
                )}
              </div>
              <p className="font-bold text-primary text-lg flex-shrink-0">
                {formatCurrency(c.amount)}
              </p>
            </div>
            <button
              onClick={() => openVenmo(c.venmoLink, c.venmoAppLink)}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-brand/15 hover:bg-brand/25 active:bg-brand/30 text-brand font-semibold text-sm px-4 py-2.5 rounded-2xl transition-colors"
            >
              <VenmoIcon className="w-4 h-4 rounded-sm overflow-hidden" />
              Pay on Venmo
              <ExternalLink className="w-3.5 h-3.5 opacity-60" />
            </button>
          </GlassCard>
        ))}
      </div>

      <GlassButton size="lg" onClick={handleDone} className="mt-2">
        Done
      </GlassButton>
    </div>
  );
}

"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import { formatCurrency } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Check, ExternalLink } from "lucide-react";
import type { Charge, ReceiptParticipant } from "@/types";

interface Props {
  charges: Charge[];
  participants: ReceiptParticipant[];
  isOwner: boolean;
  receiptId: string;
}

export function ChargeList({ charges, participants, isOwner }: Props) {
  const participantMap = Object.fromEntries(participants.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-primary">Charges</h2>
      {charges.map((charge) => {
        const participant = participantMap[charge.to_participant_id];
        if (!participant) return null;
        return (
          <ChargeRow
            key={charge.id}
            charge={charge}
            participant={participant}
            isOwner={isOwner}
          />
        );
      })}
    </div>
  );
}

function ChargeRow({
  charge,
  participant,
  isOwner,
}: {
  charge: Charge;
  participant: ReceiptParticipant;
  isOwner: boolean;
}) {
  const [paid, setPaid] = useState(!!charge.paid_at);
  const [loading, setLoading] = useState(false);

  async function markPaid() {
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("charges")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", charge.id);
    setPaid(true);
    setLoading(false);
  }

  function openVenmo() {
    if (!charge.venmo_link) return;
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const appLink = charge.venmo_link.replace("https://venmo.com/paycharge", "venmo://paycharge");
    window.open(isMobile ? appLink : charge.venmo_link, "_blank");
  }

  return (
    <GlassCard size="sm" className="p-4 flex items-center gap-3">
      <Avatar name={participant.display_name} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-primary">@{participant.display_name}</p>
        <p className="text-sm text-secondary">@{participant.venmo_username}</p>
      </div>
      <p className="font-semibold text-primary flex-shrink-0">{formatCurrency(charge.amount)}</p>
      {paid ? (
        <div className="flex items-center gap-1 text-emerald-400 text-sm font-medium">
          <Check className="w-4 h-4" /> Paid
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {charge.venmo_link && (
            <GlassButton variant="primary" size="sm" className="gap-1.5" onClick={openVenmo}>
              Venmo <ExternalLink className="w-3 h-3" />
            </GlassButton>
          )}
          {isOwner && (
            <GlassButton variant="ghost" size="sm" loading={loading} onClick={markPaid}>
              Mark paid
            </GlassButton>
          )}
        </div>
      )}
    </GlassCard>
  );
}

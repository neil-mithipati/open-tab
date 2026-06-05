"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import {
  computeSharedClaimCharges,
  formatCurrency,
  isValidVenmoUsername,
} from "@/lib/utils";
import {
  getSharedReceipt,
  joinReceipt,
  toggleClaim,
  setClaimDone,
} from "@/app/actions/claim";
import type {
  SharedReceipt,
  EditableItem,
  FlowParticipant,
  ComputedCharge,
} from "@/types";
import { Check, RotateCw } from "lucide-react";

interface Props {
  token: string;
  initial: SharedReceipt;
}

function storageKey(token: string) {
  return `open_tab_claim_${token}`;
}

export function ClaimPage({ token, initial }: Props) {
  const [receipt, setReceipt] = useState<SharedReceipt>(initial);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [, startRefresh] = useTransition();

  // Restore a prior identity for this receipt.
  useEffect(() => {
    const stored = localStorage.getItem(storageKey(token));
    if (stored) setParticipantId(stored);
  }, [token]);

  async function refresh() {
    const fresh = await getSharedReceipt(token);
    if (fresh) setReceipt(fresh);
  }

  const me = participantId
    ? receipt.participants.find((p) => p.id === participantId) ?? null
    : null;

  // If the stored id no longer exists on the receipt (e.g. owner reset), drop it.
  useEffect(() => {
    if (participantId && receipt.participants.length > 0 && !me) {
      localStorage.removeItem(storageKey(token));
      setParticipantId(null);
    }
  }, [participantId, me, receipt.participants.length, token]);

  // My charge — computed the same way the server will at close time, so the
  // live estimate and the final amount stay consistent.
  const myCharge: ComputedCharge | null = useMemo(() => {
    if (!participantId) return null;
    const items: EditableItem[] = receipt.items.map((it) => ({
      clientId: it.id,
      dbId: it.id,
      name: it.name,
      price: it.price,
      quantity: it.quantity,
    }));
    const participants: FlowParticipant[] = receipt.participants.map((p) => ({
      clientId: p.id,
      dbId: p.id,
      type: "manual",
      displayName: p.display_name,
      venmoUsername: p.venmo_username,
      isOwner: p.is_owner,
    }));
    const charges = computeSharedClaimCharges(
      items,
      receipt.assignments,
      participants,
      receipt.tax ?? 0,
      receipt.tip ?? 0,
      receipt.owner.venmo_username ?? "",
      receipt.merchant_name,
      receipt.date_of_receipt
    );
    return charges.find((c) => c.participant.clientId === participantId) ?? null;
  }, [participantId, receipt]);

  async function handleJoin() {
    const clean = username.trim().replace(/^@/, "");
    if (!isValidVenmoUsername(clean)) {
      setError("Enter a valid Venmo username (5–16 letters, numbers, _ or -).");
      return;
    }
    setError("");
    setJoining(true);
    const result = await joinReceipt(token, clean);
    setJoining(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    localStorage.setItem(storageKey(token), result.participantId);
    setParticipantId(result.participantId);
    await refresh();
  }

  async function handleToggle(itemId: string) {
    if (!participantId) return;
    // Optimistic update, then reconcile with the server.
    setReceipt((prev) => {
      const current = prev.assignments[itemId] ?? [];
      const next = current.includes(participantId)
        ? current.filter((id) => id !== participantId)
        : [...current, participantId];
      return { ...prev, assignments: { ...prev.assignments, [itemId]: next } };
    });
    const result = await toggleClaim(token, participantId, itemId);
    if ("error" in result) {
      setError(result.error);
    }
    await refresh();
  }

  async function handleDone(done: boolean) {
    if (!participantId) return;
    await setClaimDone(token, participantId, done);
    await refresh();
  }

  const merchant = receipt.merchant_name ?? "Receipt";
  const isMobile =
    typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);

  // -- Closed for claiming (owner hasn't shared, or reopened to edit) ---------
  if (receipt.status === "draft" || receipt.status === "reviewing") {
    return (
      <Centered>
        <GlassCard className="w-full max-w-sm p-8 text-center flex flex-col gap-3">
          <h1 className="text-xl font-bold text-primary">{merchant}</h1>
          <p className="text-secondary text-sm">
            This receipt isn&apos;t open for claiming right now. Check back in a bit.
          </p>
        </GlassCard>
      </Centered>
    );
  }

  // -- Owner has closed claiming: show final amount + pay ---------------------
  if (receipt.status === "charging" || receipt.status === "settled") {
    return (
      <Centered>
        <GlassCard className="w-full max-w-sm p-8 text-center flex flex-col gap-5">
          <div>
            <h1 className="text-xl font-bold text-primary">{merchant}</h1>
            <p className="text-secondary text-sm mt-1">
              Claiming is closed. Here&apos;s what you owe @
              {receipt.owner.venmo_username ?? receipt.owner.display_name}.
            </p>
          </div>
          {myCharge && myCharge.amount > 0 ? (
            <>
              <p className="text-4xl font-bold text-primary">
                {formatCurrency(myCharge.amount)}
              </p>
              <a
                href={isMobile ? myCharge.venmoAppLink : myCharge.venmoLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <GlassButton size="lg">Pay with Venmo</GlassButton>
              </a>
            </>
          ) : (
            <p className="text-secondary text-sm">
              You don&apos;t have anything to pay on this receipt.
            </p>
          )}
        </GlassCard>
      </Centered>
    );
  }

  // -- status === 'claiming' --------------------------------------------------

  // Not yet identified: ask for a Venmo username.
  if (!me) {
    return (
      <Centered>
        <GlassCard className="w-full max-w-sm p-8 flex flex-col items-center gap-5 text-center">
          <Avatar name={receipt.owner.display_name} size="lg" />
          <div>
            <h1 className="text-xl font-bold text-primary">{merchant}</h1>
            <p className="text-secondary text-sm mt-1">
              @{receipt.owner.venmo_username ?? receipt.owner.display_name} wants
              you to claim what you ordered.
            </p>
          </div>
          <div className="w-full flex flex-col gap-2">
            <div className="flex items-center glass-panel-sm rounded-2xl overflow-hidden w-full">
              <span className="pl-3 text-secondary text-sm flex-shrink-0">@</span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="your Venmo username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                className="flex-1 min-w-0 bg-transparent text-sm text-primary px-2 py-3 outline-none"
              />
            </div>
            {error && <p className="text-xs text-red-400 text-left">{error}</p>}
            <GlassButton size="lg" loading={joining} onClick={handleJoin}>
              Start claiming
            </GlassButton>
          </div>
        </GlassCard>
      </Centered>
    );
  }

  // Identified: claim items.
  const isDone = !!me.claim_done_at;

  return (
    <div className="min-h-dvh flex flex-col max-w-md mx-auto w-full px-4 pt-safe pt-6 pb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-primary truncate">{merchant}</h1>
          <p className="text-sm text-secondary">
            Claiming as @{me.venmo_username}
          </p>
        </div>
        <button
          onClick={() => startRefresh(refresh)}
          className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors flex-shrink-0"
          aria-label="Refresh"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-tertiary mb-3">
        Tap the items you ordered. Shared items split evenly between everyone who
        claims them.
      </p>

      <GlassCard className="p-2 flex flex-col divide-y divide-white/8">
        {receipt.items.map((item) => {
          const claimers = receipt.assignments[item.id] ?? [];
          const mineClaimed = claimers.includes(me.id);
          const others = claimers.filter((id) => id !== me.id).length;
          return (
            <button
              key={item.id}
              onClick={() => handleToggle(item.id)}
              disabled={isDone}
              className="flex items-center gap-3 px-3 py-3 text-left disabled:opacity-60"
            >
              <span
                className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 border transition-colors ${
                  mineClaimed
                    ? "bg-brand border-brand text-white"
                    : "border-white/20 text-transparent"
                }`}
              >
                <Check className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-primary truncate">
                  {item.quantity > 1 ? `${item.quantity}× ` : ""}
                  {item.name}
                </p>
                {others > 0 && (
                  <p className="text-xs text-tertiary">
                    shared with {others} {others === 1 ? "other" : "others"}
                  </p>
                )}
              </div>
              <span className="text-sm text-secondary flex-shrink-0">
                {formatCurrency(item.price * item.quantity)}
              </span>
            </button>
          );
        })}
      </GlassCard>

      <div className="mt-5 flex items-center justify-between px-1">
        <span className="text-secondary text-sm">Your estimated total</span>
        <span className="text-xl font-bold text-primary">
          {formatCurrency(myCharge?.amount ?? 0)}
        </span>
      </div>
      <p className="text-[11px] text-tertiary mt-1 px-1">
        Estimate — tax &amp; tip are split proportionally, and any unclaimed
        items get divided evenly when the host closes the tab.
      </p>

      <div className="mt-6">
        {isDone ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-center gap-2 text-emerald-400 font-medium py-2">
              <Check className="w-5 h-5" /> You&apos;re all set — waiting on the host
            </div>
            <GlassButton variant="secondary" onClick={() => handleDone(false)}>
              Edit my claims
            </GlassButton>
          </div>
        ) : (
          <GlassButton size="lg" onClick={() => handleDone(true)}>
            I&apos;m done claiming
          </GlassButton>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4">
      {children}
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import { buildVenmoLinks } from "@/lib/venmo/deepLink";
import {
  computeSharedClaimCharges,
  formatCurrency,
} from "@/lib/utils";
import {
  getSharedReceipt,
  getClaimCharges,
  closeClaiming,
  reopenEditing,
  markClaimChargePaid,
  type ClaimChargeRow,
} from "@/app/actions/claim";
import type {
  SharedReceipt,
  EditableItem,
  FlowParticipant,
  ComputedCharge,
} from "@/types";
import { X, RotateCw, Check, Copy, Link as LinkIcon, ChevronDown } from "lucide-react";

interface Props {
  shareUrl: string;
  initial: SharedReceipt;
  initialCharges: ClaimChargeRow[];
}

export function ClaimOwnerView({ shareUrl, initial, initialCharges }: Props) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<SharedReceipt>(initial);
  const [charges, setCharges] = useState<ClaimChargeRow[]>(initialCharges);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startRefresh] = useTransition();

  const receiptId = receipt.id;
  const merchant = receipt.merchant_name ?? "Receipt";
  const isMobile =
    typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);

  async function refresh() {
    const [fresh, freshCharges] = await Promise.all([
      getSharedReceipt(shareTokenFromUrl(shareUrl)),
      getClaimCharges(receiptId),
    ]);
    if (fresh) setReceipt(fresh);
    if (Array.isArray(freshCharges)) setCharges(freshCharges);
  }

  // Amounts each non-owner owes — same computation the server persisted.
  const computed: ComputedCharge[] = useMemo(() => {
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
    return computeSharedClaimCharges(
      items,
      receipt.assignments,
      participants,
      receipt.tax ?? 0,
      receipt.tip ?? 0,
      receipt.owner.venmo_username ?? "",
      receipt.merchant_name,
      receipt.date_of_receipt
    );
  }, [receipt]);

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleClose() {
    setBusy(true);
    await closeClaiming(receiptId);
    setBusy(false);
    router.refresh();
  }

  async function handleReopen() {
    setBusy(true);
    await reopenEditing(receiptId);
    setBusy(false);
    router.refresh();
  }

  const claimers = receipt.participants.filter((p) => p.joined_via_share);
  const unclaimed = receipt.items.filter(
    (it) => (receipt.assignments[it.id] ?? []).length === 0
  );

  const note = `Open Tab: ${merchant}${
    receipt.date_of_receipt ? ` ${receipt.date_of_receipt}` : ""
  }`;

  return (
    <div className="min-h-dvh flex flex-col max-w-md mx-auto w-full px-4 pt-safe pt-4 pb-10">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push("/dashboard")}
          className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          onClick={() => startRefresh(refresh)}
          className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors"
          aria-label="Refresh"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      <h1 className="text-2xl font-bold text-primary truncate">{merchant}</h1>

      {/* Share link */}
      <button
        onClick={copyLink}
        className="mt-3 flex items-center gap-2 glass-panel-sm rounded-2xl px-3 py-2.5 text-left"
      >
        <LinkIcon className="w-4 h-4 text-tertiary flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate text-sm text-secondary">
          {shareUrl.replace(/^https?:\/\//, "")}
        </span>
        {copied ? (
          <span className="text-xs text-emerald-400 flex items-center gap-1 flex-shrink-0">
            <Check className="w-3.5 h-3.5" /> Copied
          </span>
        ) : (
          <Copy className="w-4 h-4 text-tertiary flex-shrink-0" />
        )}
      </button>

      {receipt.status === "claiming" ? (
        <ClaimingBody
          claimers={claimers}
          assignments={receipt.assignments}
          items={receipt.items}
          unclaimed={unclaimed}
          busy={busy}
          onReopen={handleReopen}
          onClose={handleClose}
        />
      ) : (
        <CollectBody
          receipt={receipt}
          computed={computed}
          charges={charges}
          receiptId={receiptId}
          note={note}
          isMobile={isMobile}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

function ClaimingBody({
  claimers,
  assignments,
  items,
  unclaimed,
  busy,
  onReopen,
  onClose,
}: {
  claimers: SharedReceipt["participants"];
  assignments: Record<string, string[]>;
  items: SharedReceipt["items"];
  unclaimed: SharedReceipt["items"];
  busy: boolean;
  onReopen: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <p className="text-xs text-tertiary mt-4 mb-2">
        Editing is locked while friends claim. Reopen to make changes.
      </p>

      <h2 className="text-sm font-semibold text-primary mt-3 mb-2">
        Who&apos;s claimed ({claimers.length})
      </h2>
      {claimers.length === 0 ? (
        <GlassCard size="sm" className="p-4 text-center text-secondary text-sm">
          No one has joined yet. Share the link above.
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-2">
          {claimers.map((c) => {
            const claimedItems = items.filter((it) =>
              (assignments[it.id] ?? []).includes(c.id)
            );
            const done = !!c.claim_done_at;
            return (
              <GlassCard key={c.id} size="sm" className="p-3 flex items-center gap-3">
                <Avatar name={c.display_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-primary truncate">
                    @{c.venmo_username}
                  </p>
                  <p className="text-xs text-tertiary truncate">
                    {claimedItems.length > 0
                      ? claimedItems.map((it) => it.name).join(", ")
                      : "nothing yet"}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium flex items-center gap-1 flex-shrink-0 ${
                    done ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  {done ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> done
                    </>
                  ) : (
                    "claiming…"
                  )}
                </span>
              </GlassCard>
            );
          })}
        </div>
      )}

      {unclaimed.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-amber-400 mt-5 mb-2">
            Unclaimed ({unclaimed.length})
          </h2>
          <GlassCard size="sm" className="p-3 flex flex-col gap-1.5">
            {unclaimed.map((it) => (
              <div key={it.id} className="flex items-center justify-between text-sm">
                <span className="text-secondary truncate">{it.name}</span>
                <span className="text-tertiary flex-shrink-0">
                  {formatCurrency(it.price * it.quantity)}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-tertiary mt-1">
              Unclaimed items are split evenly across everyone when you close.
            </p>
          </GlassCard>
        </>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <GlassButton size="lg" loading={busy} onClick={onClose}>
          Close claiming &amp; create charges
        </GlassButton>
        <GlassButton variant="secondary" disabled={busy} onClick={onReopen}>
          Reopen editing
        </GlassButton>
      </div>
    </>
  );
}

function CollectBody({
  receipt,
  computed,
  charges,
  receiptId,
  note,
  isMobile,
  onRefresh,
}: {
  receipt: SharedReceipt;
  computed: ComputedCharge[];
  charges: ClaimChargeRow[];
  receiptId: string;
  note: string;
  isMobile: boolean;
  onRefresh: () => void;
}) {
  const paidMap = new Map(charges.map((c) => [c.participantId, c.paidAt]));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  async function togglePaid(participantId: string, paid: boolean) {
    await markClaimChargePaid(receiptId, participantId, paid);
    onRefresh();
  }

  function toggleExpanded(id: string) {
    setExpandedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const claimedItemsFor = (participantId: string) =>
    receipt.items.filter((it) => (receipt.assignments[it.id] ?? []).includes(participantId));

  // Owner is the first user in the list, showing what they claimed for themselves.
  const ownerParticipant = receipt.participants.find((p) => p.is_owner);
  const subtotal = receipt.items.reduce((s, it) => s + it.price * it.quantity, 0);
  const total = receipt.total ?? subtotal + (receipt.tax ?? 0) + (receipt.tip ?? 0);
  // The bill splits exhaustively across everyone, so the owner's own share is
  // whatever isn't owed by the friends.
  const nonOwnerSum = computed.reduce((s, c) => s + c.amount, 0);
  const ownerShare = Math.max(0, Math.round((total - nonOwnerSum) * 100) / 100);

  const owed = computed.filter((c) => c.amount > 0);

  return (
    <>
      <p className="text-xs text-tertiary mt-4 mb-2">
        Claiming is closed. Friends pay you from their own link — mark each as
        paid when the money lands, and nudge anyone who&apos;s slow.
      </p>
      <div className="flex flex-col gap-2">
        {ownerParticipant && (
          <CollectRow
            name={ownerParticipant.display_name}
            venmoUsername={ownerParticipant.venmo_username}
            amount={ownerShare}
            youTag
            claimedItems={claimedItemsFor(ownerParticipant.id)}
            expanded={expandedIds.has(ownerParticipant.id)}
            onToggle={() => toggleExpanded(ownerParticipant.id)}
          />
        )}
        {owed.map((c) => {
          const pid = c.participant.dbId!;
          const paid = !!paidMap.get(pid);
          const remind = buildVenmoLinks({
            recipientUsername: c.participant.venmoUsername,
            amount: c.amount,
            note,
            txn: "charge",
          });
          return (
            <CollectRow
              key={pid}
              name={c.participant.displayName}
              venmoUsername={c.participant.venmoUsername}
              amount={c.amount}
              claimedItems={claimedItemsFor(pid)}
              expanded={expandedIds.has(pid)}
              onToggle={() => toggleExpanded(pid)}
              action={
                paid ? (
                  <button
                    onClick={() => togglePaid(pid, false)}
                    className="text-xs font-medium text-emerald-400 flex items-center gap-1 flex-shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" /> paid
                  </button>
                ) : (
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <a
                      href={isMobile ? remind.venmoAppLink : remind.venmoLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-tertiary hover:text-secondary underline-offset-2 hover:underline"
                    >
                      Remind
                    </a>
                    <GlassButton
                      variant="secondary"
                      size="sm"
                      onClick={() => togglePaid(pid, true)}
                    >
                      Mark paid
                    </GlassButton>
                  </div>
                )
              }
            />
          );
        })}
        {owed.length === 0 && (
          <GlassCard size="sm" className="p-4 text-center text-secondary text-sm">
            No charges yet — nobody else has claimed anything.
          </GlassCard>
        )}
      </div>

      {/* Full check breakdown, kept visible once claiming has closed */}
      <h2 className="text-sm font-semibold text-primary mt-6 mb-2">Receipt</h2>
      <GlassCard size="sm" className="p-3 flex flex-col gap-1.5">
        {receipt.items.map((it) => (
          <div key={it.id} className="flex justify-between text-sm">
            <span className="text-secondary truncate">
              {it.name}
              {it.quantity > 1 && ` ×${it.quantity}`}
            </span>
            <span className="text-primary flex-shrink-0 ml-2">
              {formatCurrency(it.price * it.quantity)}
            </span>
          </div>
        ))}
        <div className="flex justify-between text-sm pt-1.5 border-t border-white/8 mt-0.5">
          <span className="text-secondary">Subtotal</span>
          <span className="text-primary">{formatCurrency(subtotal)}</span>
        </div>
        {receipt.tax != null && (
          <div className="flex justify-between text-sm">
            <span className="text-secondary">Tax</span>
            <span className="text-primary">{formatCurrency(receipt.tax)}</span>
          </div>
        )}
        {receipt.tip != null && (
          <div className="flex justify-between text-sm">
            <span className="text-secondary">Tip</span>
            <span className="text-primary">{formatCurrency(receipt.tip)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1.5 border-t border-white/8">
          <span className="font-bold text-primary">Total</span>
          <span className="font-bold text-primary">{formatCurrency(total)}</span>
        </div>
      </GlassCard>
    </>
  );
}

function CollectRow({
  name,
  venmoUsername,
  amount,
  claimedItems,
  expanded,
  onToggle,
  action,
  youTag = false,
}: {
  name: string;
  venmoUsername: string;
  amount: number;
  claimedItems: SharedReceipt["items"];
  expanded: boolean;
  onToggle: () => void;
  action?: ReactNode;
  youTag?: boolean;
}) {
  return (
    <GlassCard size="sm" className="p-3 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Avatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 max-w-full"
            aria-expanded={expanded}
          >
            <span className="text-sm font-medium text-primary truncate">@{venmoUsername}</span>
            {youTag && (
              <span className="text-[10px] uppercase tracking-wide font-semibold text-tertiary bg-white/8 rounded px-1.5 py-0.5 flex-shrink-0">
                you
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-tertiary flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
          <p className="text-sm text-secondary">{formatCurrency(amount)}</p>
        </div>
        {action}
      </div>
      {expanded && (
        <div className="flex flex-col gap-1 pl-11 pt-1 border-t border-white/8">
          {claimedItems.length === 0 ? (
            <p className="text-xs text-tertiary">Nothing claimed</p>
          ) : (
            claimedItems.map((it) => (
              <div key={it.id} className="flex justify-between text-xs">
                <span className="text-secondary truncate">
                  {it.name}
                  {it.quantity > 1 && ` ×${it.quantity}`}
                </span>
                <span className="text-tertiary flex-shrink-0 ml-2">
                  {formatCurrency(it.price * it.quantity)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </GlassCard>
  );
}

function shareTokenFromUrl(url: string): string {
  return url.split("/tab/")[1] ?? "";
}

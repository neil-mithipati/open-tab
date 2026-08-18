"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Image from "next/image";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import { ParticipantBubble } from "@/components/friends/ParticipantBubble";
import { UsernameAutocomplete } from "@/components/friends/UsernameAutocomplete";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  formatCurrency,
  formatDate,
  computeEqualCharges,
  computeItemCharges,
  buildVenmoNote,
} from "@/lib/utils";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import type { Profile, FlowParticipant, ComputedCharge, FriendGroup } from "@/types";
import { VenmoIcon } from "@/components/ui/VenmoIcon";
import { addFriendByUsername } from "@/lib/friends";
import { groupToParticipants, mapGroupRows } from "@/lib/friendGroups";
import { buildVenmoLinks } from "@/lib/venmo/deepLink";
import { parseQuantity, parseAmount } from "@/lib/receiptValidation";
import { Users2, Check } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

// ─── LiveChargeCard ───────────────────────────────────────────────────────────

function LiveChargeCard({
  charge,
  splitMode,
  items,
  assignments,
  paid,
  onMarkPaid,
  merchantName,
}: {
  charge: ComputedCharge;
  splitMode: "equal" | "by_item";
  items: ReturnType<typeof useReceiptFlow>["state"]["items"];
  assignments: Record<string, string[]>;
  paid: boolean;
  onMarkPaid: () => void;
  merchantName: string | null;
}) {
  const breakdown =
    splitMode === "by_item"
      ? items
          .filter((item) => (assignments[item.clientId] ?? []).includes(charge.participant.clientId))
          .map((item) => {
            const assignees = assignments[item.clientId] ?? [];
            return {
              item,
              perPersonAmount: (item.price * item.quantity) / assignees.length,
              shared: assignees.length > 1,
            };
          })
      : [];

  // Note defaults to the recipient's items (every item in an even split, or
  // just their assigned items when itemized); the user can still edit it.
  const noteItems =
    splitMode === "by_item"
      ? breakdown.map(({ item }) => ({ name: item.name, quantity: item.quantity }))
      : items.map((item) => ({ name: item.name, quantity: item.quantity }));
  const [note, setNote] = useState(() => buildVenmoNote(merchantName, noteItems));

  function openVenmo() {
    const { venmoLink, venmoAppLink } = buildVenmoLinks({
      recipientUsername: charge.participant.venmoUsername,
      amount: charge.amount,
      note,
      // Owner is collecting from this friend → request money (charge), not pay.
      txn: "charge",
    });
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    window.open(isMobile ? venmoAppLink : venmoLink, "_blank");
  }

  const showDisplayName = charge.participant.displayName !== charge.participant.venmoUsername;

  return (
    <GlassCard size="sm" className="p-4 flex flex-col gap-3">
      {/* Top row: user info + mark paid */}
      <div className="flex items-center gap-3">
        <Avatar name={charge.participant.displayName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-primary truncate">
            {showDisplayName ? charge.participant.displayName : `@${charge.participant.venmoUsername}`}
          </p>
          {showDisplayName && (
            <p className="text-xs text-secondary">@{charge.participant.venmoUsername}</p>
          )}
        </div>
        <button
          onClick={onMarkPaid}
          className={`flex-shrink-0 flex items-center gap-1 text-xs transition-colors glass-panel-sm px-2.5 py-1 rounded-xl ${
            paid ? "text-emerald-400 hover:text-emerald-300" : "text-secondary hover:text-primary"
          }`}
        >
          {paid && <Check className="w-3 h-3" />}
          {paid ? "Paid" : "Mark paid"}
        </button>
      </div>

      {/* Venmo note input + send button */}
      <div className="flex items-center glass-panel-sm rounded-2xl overflow-hidden">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Venmo note"
          className="flex-1 min-w-0 bg-transparent text-sm text-secondary px-3 py-2.5 outline-none"
        />
        <button
          onClick={openVenmo}
          className="flex items-center justify-center px-3 py-2.5 bg-brand/20 hover:bg-brand/30 active:bg-brand/40 text-brand transition-colors border-l border-white/8 flex-shrink-0"
          aria-label="Send on Venmo"
        >
          <VenmoIcon className="w-5 h-5 rounded-sm overflow-hidden" />
        </button>
      </div>

      {/* Read-only charge breakdown */}
      {splitMode === "by_item" && breakdown.length > 0 ? (
        <div className="flex flex-col gap-1.5 pt-1 border-t border-white/8">
          {breakdown.map(({ item, perPersonAmount, shared }) => (
            <div key={item.clientId} className="flex justify-between text-xs text-secondary">
              <span className="truncate">
                {item.name}
                {item.quantity > 1 && ` ×${item.quantity}`}
                {shared && " (shared)"}
              </span>
              <span className="flex-shrink-0 ml-2">{formatCurrency(perPersonAmount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-semibold text-primary pt-1.5 border-t border-white/8">
            <span>Total</span>
            <span>{formatCurrency(charge.amount)}</span>
          </div>
        </div>
      ) : (
        <div className="flex justify-between text-sm pt-1 border-t border-white/8">
          <span className="text-secondary">Even split</span>
          <span className="font-semibold text-primary">{formatCurrency(charge.amount)}</span>
        </div>
      )}
    </GlassCard>
  );
}

// ─── OwnerChargeCard ─────────────────────────────────────────────────────────

function OwnerChargeCard({
  participant,
  amount,
  splitMode,
  items,
  assignments,
}: {
  participant: FlowParticipant;
  amount: number;
  splitMode: "equal" | "by_item";
  items: ReturnType<typeof useReceiptFlow>["state"]["items"];
  assignments: Record<string, string[]>;
}) {
  const showDisplayName = participant.displayName !== participant.venmoUsername;
  const breakdown =
    splitMode === "by_item"
      ? items
          .filter((item) => (assignments[item.clientId] ?? []).includes(participant.clientId))
          .map((item) => {
            const assignees = assignments[item.clientId] ?? [];
            return {
              item,
              perPersonAmount: (item.price * item.quantity) / assignees.length,
              shared: assignees.length > 1,
            };
          })
      : [];

  return (
    <GlassCard size="sm" className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={participant.displayName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-primary truncate">
            {showDisplayName ? participant.displayName : `@${participant.venmoUsername}`}
          </p>
          {showDisplayName && (
            <p className="text-xs text-secondary">@{participant.venmoUsername}</p>
          )}
        </div>
        <span className="text-xs text-secondary glass-panel-sm px-2.5 py-1 rounded-xl">You</span>
      </div>

      {splitMode === "by_item" && breakdown.length > 0 ? (
        <div className="flex flex-col gap-1.5 pt-1 border-t border-white/8">
          {breakdown.map(({ item, perPersonAmount, shared }) => (
            <div key={item.clientId} className="flex justify-between text-xs text-secondary">
              <span className="truncate">
                {item.name}
                {item.quantity > 1 && ` ×${item.quantity}`}
                {shared && " (shared)"}
              </span>
              <span className="flex-shrink-0 ml-2">{formatCurrency(perPersonAmount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-semibold text-primary pt-1.5 border-t border-white/8">
            <span>Total</span>
            <span>{formatCurrency(amount)}</span>
          </div>
        </div>
      ) : (
        <div className="flex justify-between text-sm pt-1 border-t border-white/8">
          <span className="text-secondary">Even split</span>
          <span className="font-semibold text-primary">{formatCurrency(amount)}</span>
        </div>
      )}
    </GlassCard>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ReceiptSplitStep({
  flow,
  hideRetake = false,
  paidClientIds: externalPaidClientIds,
  onTogglePaid,
  view: viewProp,
  onViewChange,
}: {
  flow: Flow;
  hideRetake?: boolean;
  paidClientIds?: Set<string>;
  onTogglePaid?: (clientId: string) => void;
  view?: "parsed" | "original";
  onViewChange?: (v: "parsed" | "original") => void;
}) {
  const router = useRouter();
  const [internalView, setInternalView] = useState<"parsed" | "original">("parsed");
  const view = viewProp ?? internalView;
  // Kept for API symmetry with the paid-ids pair below (external override vs.
  // internal fallback) even though nothing calls it yet; deleting it would
  // ripple into removing internalView/onViewChange too, which is out of scope.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function setView(v: "parsed" | "original") {
    if (onViewChange) onViewChange(v); else setInternalView(v);
  }
  const [internalPaidClientIds, setInternalPaidClientIds] = useState<Set<string>>(new Set());
  const paidClientIds = externalPaidClientIds ?? internalPaidClientIds;
  const [friends, setFriends] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  // Venmo usernames in the order they were last picked, most recent first.
  const [recentUsernames, setRecentUsernames] = useState<string[]>([]);
  const [evenSplitOpen, setEvenSplitOpen] = useState(false);
  const [evenSplitQuery, setEvenSplitQuery] = useState("");
  // Staged locally so Cancel can leave the check exactly as it was.
  const [evenSplitStaged, setEvenSplitStaged] = useState<Omit<FlowParticipant, "clientId">[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const evenSplitInputRef = useRef<HTMLInputElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = useRef<HTMLDivElement | null>(null);

  const { state, addParticipant, removeParticipant, toggleAssignment, clearSplitState, update, goTo, reset } = flow;
  const nonOwnerParticipants = state.participants.filter((p) => !p.isOwner);

  function noteRecent(venmoUsername: string) {
    const clean = venmoUsername.trim().replace(/^@/, "").toLowerCase();
    if (!clean) return;
    setRecentUsernames((prev) => [clean, ...prev.filter((u) => u !== clean)]);
  }

  // Alphabetical until someone is picked, then whoever was picked most recently
  // rises to the top — the same people tend to be assigned item after item.
  const orderedFriends = useMemo(() => {
    const rank = new Map(recentUsernames.map((u, i) => [u, i]));
    return [...friends]
      .sort((a, b) =>
        a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" })
      )
      .sort((a, b) => {
        // Sorting is stable, so anyone never picked keeps alphabetical order.
        const ra = rank.get((a.venmo_username ?? "").toLowerCase()) ?? Infinity;
        const rb = rank.get((b.venmo_username ?? "").toLowerCase()) ?? Infinity;
        return ra === rb ? 0 : ra - rb;
      });
  }, [friends, recentUsernames]);

  function dismissActiveInput() {
    setActiveItemId(null);
    setItemQuery("");
  }

  useEffect(() => {
    if (!activeItemId) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (!activeInputRef.current?.contains(e.target as Node)) {
        dismissActiveInput();
      }
    }
    // setTimeout(0) so this listener doesn't catch the click that opened the panel
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handleOutside);
      document.addEventListener("touchstart", handleOutside, { passive: true });
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [activeItemId]);

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setSelfId(user.id);
      const [{ data: selfData }, { data: friendData }, { data: externalData }, { data: groupData }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, venmo_username, email, invite_token, created_at, updated_at")
          .eq("id", user.id)
          .single(),
        // profiles is own-row only under RLS, so friends come back through a
        // scoped function: id / display_name / venmo_username, nothing else.
        supabase.rpc("list_friend_profiles") as unknown as Promise<{
          data: Array<{ id: string; display_name: string; venmo_username: string | null }> | null;
        }>,
        supabase
          .from("external_contacts")
          .select("id, venmo_username, display_name")
          .eq("user_id", user.id),
        supabase
          .from("friend_groups")
          .select("id, name, friend_group_members(venmo_username, display_name)")
          .eq("user_id", user.id),
      ]);

      const self: Profile[] = selfData ? [selfData as Profile] : [];
      const realFriends: Profile[] = (friendData ?? []).map((f) => ({
        ...f,
        email: "",
        invite_token: "",
        created_at: "",
        updated_at: "",
      }));
      const externalFriends: Profile[] = (externalData ?? []).map((c: { id: string; venmo_username: string; display_name: string | null }) => ({
        id: "",  // not a profiles.id — treat as manual when adding to participants
        display_name: (c.display_name ?? c.venmo_username) as string,
        venmo_username: c.venmo_username as string,
        email: "",
        invite_token: "",
        created_at: "",
        updated_at: "",
      }));

      setFriends([...self, ...realFriends, ...externalFriends]);
      setGroups(mapGroupRows(groupData));
    }
    load();
  }, []);

  useEffect(() => {
    if (evenSplitOpen) {
      const t = setTimeout(() => evenSplitInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [evenSplitOpen]);

  useEffect(() => {
    if (activeItemId) {
      const t = setTimeout(() => itemInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [activeItemId]);

  async function handleDelete() {
    if (!state.receiptId) return;
    const supabase = getSupabaseBrowserClient();
    const { data: receipt } = await supabase
      .from("receipts")
      .select("image_url")
      .eq("id", state.receiptId)
      .single();
    if (receipt?.image_url) {
      try {
        const pathname = new URL(receipt.image_url).pathname;
        const marker = "/receipt-images/";
        const idx = pathname.indexOf(marker);
        if (idx !== -1) {
          await supabase.storage.from("receipt-images").remove([pathname.slice(idx + marker.length)]);
        }
      } catch {}
    }
    await supabase.from("receipts").delete().eq("id", state.receiptId);
    reset();
    router.push("/dashboard");
  }

  // The modal only ever edits its own staged list — the check is untouched
  // until Done, so Cancel is a genuine no-op.
  function handleEvenSplitPress() {
    setEvenSplitStaged(
      state.participants.map((p) => ({
        type: p.type,
        userId: p.userId,
        displayName: p.displayName,
        venmoUsername: p.venmoUsername,
        isOwner: p.isOwner,
      }))
    );
    setEvenSplitQuery("");
    setEvenSplitOpen(true);
    setActiveItemId(null);
    setItemQuery("");
  }

  function handleEvenSplitCancel() {
    setEvenSplitOpen(false);
    setEvenSplitQuery("");
    setEvenSplitStaged([]);
  }

  function stageParticipant(p: Omit<FlowParticipant, "clientId">) {
    noteRecent(p.venmoUsername);
    setEvenSplitStaged((prev) =>
      prev.some((s) => s.venmoUsername.toLowerCase() === p.venmoUsername.toLowerCase())
        ? prev
        : [...prev, p]
    );
    setEvenSplitQuery("");
    setTimeout(() => evenSplitInputRef.current?.focus(), 50);
  }

  // Merged inside one functional update so `prev` is authoritative: the group's
  // members dedupe against what's already staged and against each other.
  function stageGroup(group: FriendGroup) {
    const expanded = groupToParticipants(group, friends, selfId);
    setEvenSplitStaged((prev) => {
      const seen = new Set(prev.map((p) => p.venmoUsername.toLowerCase()));
      const next = [...prev];
      for (const p of expanded) {
        const key = p.venmoUsername.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(p);
      }
      return next;
    });
    setEvenSplitQuery("");
    setTimeout(() => evenSplitInputRef.current?.focus(), 50);
  }

  function unstageParticipant(venmoUsername: string) {
    setEvenSplitStaged((prev) =>
      prev.filter((s) => s.venmoUsername.toLowerCase() !== venmoUsername.toLowerCase())
    );
  }

  function handleEvenSplitDone() {
    const staged = new Set(evenSplitStaged.map((p) => p.venmoUsername.toLowerCase()));
    const existing = new Set(state.participants.map((p) => p.venmoUsername.toLowerCase()));

    for (const p of state.participants) {
      if (!staged.has(p.venmoUsername.toLowerCase())) removeParticipant(p.clientId);
    }
    for (const p of evenSplitStaged) {
      if (existing.has(p.venmoUsername.toLowerCase())) continue;
      addParticipant(p);
      maybeAddFriend(p.venmoUsername);
    }

    // An even split covers every item, so any per-item assignments left over
    // from itemising no longer apply.
    update("assignments", {});
    update("splitMode", "equal");
    setEvenSplitOpen(false);
    setEvenSplitQuery("");
    setEvenSplitStaged([]);
  }

  function handleItemClick(itemClientId: string) {
    if (state.splitMode === "equal" && nonOwnerParticipants.length > 0) {
      clearSplitState();
    }
    update("splitMode", "by_item");
    setEvenSplitOpen(false);
    setEvenSplitQuery("");
    setActiveItemId(activeItemId === itemClientId ? null : itemClientId);
    setItemQuery("");
  }

  // Persist a newly-typed Venmo username to the user's friend list so it's
  // available on future checks (applies to guests and logged-in users alike).
  // Existing friends are skipped; the write is fire-and-forget.
  function maybeAddFriend(venmoUsername: string) {
    if (!selfId) return;
    const clean = venmoUsername.trim().replace(/^@/, "");
    if (!clean) return;
    const exists = friends.some(
      (f) => (f.venmo_username ?? "").toLowerCase() === clean.toLowerCase()
    );
    if (exists) return;
    addFriendByUsername(selfId, clean)
      .then((res) => {
        if ("friend" in res) {
          setFriends((prev) => [
            ...prev,
            {
              id: res.friend.id,
              display_name: res.friend.display_name,
              venmo_username: res.friend.venmo_username,
              email: "",
              invite_token: "",
              created_at: "",
              updated_at: "",
            },
          ]);
        }
      })
      .catch(() => {}); // best-effort; a failed auto-add shouldn't disrupt splitting
  }

  // Adding a group is the same as adding each member by hand: they become
  // ordinary participants, so the charges below the check list out one per
  // person. The local map is the batch's source of truth — state.participants
  // is stale the moment the first addParticipant fires, so re-reading it inside
  // the loop would add the same person twice.
  function handleAddGroupToItem(itemClientId: string, group: FriendGroup) {
    const byUsername = new Map(
      state.participants.map((p) => [p.venmoUsername.toLowerCase(), p.clientId])
    );
    const clientIds: string[] = [];

    for (const p of groupToParticipants(group, friends, selfId)) {
      const key = p.venmoUsername.toLowerCase();
      let clientId = byUsername.get(key);
      if (!clientId) {
        clientId = addParticipant(p);
        byUsername.set(key, clientId);
        maybeAddFriend(p.venmoUsername);
      }
      clientIds.push(clientId);
    }

    // Safe to read stale: every id here is either brand new (so it can't be
    // assigned yet) or pre-existing (so the stale read is accurate).
    const assigned = state.assignments[itemClientId] ?? [];
    for (const clientId of clientIds) {
      if (!assigned.includes(clientId)) toggleAssignment(itemClientId, clientId);
    }

    setActiveItemId(null);
    setItemQuery("");
  }

  function handleAddToItem(itemClientId: string, p: Omit<FlowParticipant, "clientId">) {
    const existing = state.participants.find(
      (ep) => ep.venmoUsername.toLowerCase() === p.venmoUsername.toLowerCase()
    );
    let clientId: string;
    if (existing) {
      clientId = existing.clientId;
    } else {
      clientId = addParticipant(p);
    }
    const assigned = state.assignments[itemClientId] ?? [];
    if (!assigned.includes(clientId)) {
      toggleAssignment(itemClientId, clientId);
    }
    maybeAddFriend(p.venmoUsername);
    noteRecent(p.venmoUsername);
    setActiveItemId(null);
    setItemQuery("");
  }

  function handleItemUpdate(clientId: string, field: "price" | "quantity", raw: string) {
    const newItems = state.items.map((it) => {
      if (it.clientId !== clientId) return it;
      if (field === "price") return { ...it, price: parseAmount(raw) };
      if (field === "quantity") return { ...it, quantity: parseQuantity(raw) };
      return it;
    });
    update("items", newItems);
    const newSubtotal = Math.round(newItems.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
    update("subtotal", newSubtotal);
    update("total", Math.round((newSubtotal + (state.tax ?? 0) + (state.tip ?? 0)) * 100) / 100);
  }

  function handleTaxUpdate(raw: string) {
    const tax = parseAmount(raw);
    update("tax", tax);
    const subtotal = Math.round(state.items.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
    update("total", Math.round((subtotal + tax + (state.tip ?? 0)) * 100) / 100);
  }

  function handleTipUpdate(raw: string) {
    const tip = parseAmount(raw);
    update("tip", tip);
    const subtotal = Math.round(state.items.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
    update("total", Math.round((subtotal + (state.tax ?? 0) + tip) * 100) / 100);
  }

  const anyItemsAssigned =
    state.items.some((item) => (state.assignments[item.clientId] ?? []).length >= 1);

  const total =
    state.total ??
    state.items.reduce((s, it) => s + it.price * it.quantity, 0) +
      (state.tax ?? 0) +
      (state.tip ?? 0);

  const liveCharges: ComputedCharge[] = (() => {
    if (state.splitMode === "equal" && nonOwnerParticipants.length >= 1) {
      return computeEqualCharges(total, state.participants, state.merchantName, state.items);
    }
    if (state.splitMode === "by_item" && anyItemsAssigned && nonOwnerParticipants.length >= 1) {
      const subtotal = state.items.reduce((s, it) => s + it.price * it.quantity, 0);
      return computeItemCharges(state.items, state.assignments, state.participants, subtotal, state.tax ?? 0, state.tip ?? 0, state.merchantName, state.dateOfReceipt)
        .filter((c) => c.amount > 0);
    }
    return [];
  })();

  const ownerParticipant = state.participants.find((p) => p.isOwner);
  const ownerAmount = (() => {
    if (!ownerParticipant || liveCharges.length === 0) return null;
    if (state.splitMode === "equal") {
      return Math.round((total / state.participants.length) * 100) / 100;
    }
    if (state.splitMode === "by_item") {
      const subtotal = state.items.reduce((s, it) => s + it.price * it.quantity, 0);
      const taxRate = subtotal > 0 ? (state.tax ?? 0) / subtotal : 0;
      const tipRate = subtotal > 0 ? (state.tip ?? 0) / subtotal : 0;
      let itemSubtotal = 0;
      for (const item of state.items) {
        const assignees = state.assignments[item.clientId] ?? [];
        if (assignees.includes(ownerParticipant.clientId) && assignees.length > 0) {
          itemSubtotal += (item.price * item.quantity) / assignees.length;
        }
      }
      const amount = Math.round(itemSubtotal * (1 + taxRate + tipRate) * 100) / 100;
      return amount > 0 ? amount : null;
    }
    return null;
  })();

  return (
    <div className="flex flex-col gap-4 pt-1 pb-7">
      {/* Animated view container — height animates via layout. Both views stay
          mounted: the original is a full-size photo, and keeping it in the tree
          (with priority, so Next preloads it) means switching to it is instant
          instead of starting a download on the first press. */}
      <motion.div layout transition={{ layout: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } }} className="relative">
        {state.signedUrl && (
          <div className={view === "original" ? "" : "hidden"}>
            <GlassCard className="overflow-hidden p-0">
              <div className="relative w-full" style={{ minHeight: "60vh" }}>
                <Image
                  src={state.signedUrl}
                  alt="Original receipt"
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 448px"
                  className="object-contain"
                />
              </div>
            </GlassCard>
          </div>
        )}
        <div className={view === "original" ? "hidden" : ""}>
      <div className="flex flex-col gap-4">
      {/* Receipt card */}
      <GlassCard className="p-0 overflow-hidden">
        {/* Header */}
        <div className="relative px-4 pt-4 pb-3 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={state.merchantName ?? ""}
              onChange={(e) => update("merchantName", e.target.value || null)}
              placeholder="Receipt"
              className="font-bold text-primary text-lg leading-tight bg-transparent outline-none w-full border-b border-transparent focus:border-white/20 transition-colors truncate"
              autoCapitalize="words"
              autoCorrect="off"
            />
            {state.dateOfReceipt && (
              <p className="text-sm text-secondary mt-0.5">
                {formatDate(state.dateOfReceipt)}
              </p>
            )}
          </div>
          {/* Even Split button + hint */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              onClick={handleEvenSplitPress}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-sm font-semibold transition-all bg-brand text-white hover:brightness-110 active:scale-95"
            >
              <Users2 className="w-4 h-4" />
              Even Split
            </button>
            <p className="text-xs text-secondary">Click an item to itemize</p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/8" />

        {/* Items */}
        <div className="px-4 py-2 flex flex-col divide-y divide-white/8">
          {state.items.map((item) => {
            const assignedParticipants = (state.assignments[item.clientId] ?? [])
              .map((id) => state.participants.find((p) => p.clientId === id))
              .filter((p): p is FlowParticipant => p !== undefined);
            const isActive = activeItemId === item.clientId;

            return (
              <div key={item.clientId} className="py-2.5">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleItemClick(item.clientId)}
                  onKeyDown={(e) => e.key === "Enter" && handleItemClick(item.clientId)}
                  className={`w-full flex items-center gap-2 text-left transition-colors cursor-pointer ${
                    state.splitMode === "by_item" ? "active:bg-white/5 rounded-xl px-1 -mx-1" : ""
                  }`}
                >
                  {/* Name — read-only; click bubbles up to row's handleItemClick */}
                  <span className="flex-1 min-w-0 text-sm text-primary truncate">
                    {item.name}
                  </span>
                  {/* Quantity */}
                  <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-primary text-sm font-medium">×</span>
                    <div className="w-6 h-6 rounded-full border border-white/15 bg-white/5 flex items-center justify-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(e) => handleItemUpdate(item.clientId, "quantity", e.target.value.replace(/\D/g, ""))}
                        className="w-5 text-sm text-primary font-medium bg-transparent outline-none text-center"
                      />
                    </div>
                  </div>
                  {/* Unit price */}
                  <div className="flex items-center flex-shrink-0 border border-white/15 bg-white/5 rounded-lg px-1.5 py-0.5" onClick={(e) => e.stopPropagation()}>
                    <span className="text-tertiary text-sm">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.price}
                      onChange={(e) => handleItemUpdate(item.clientId, "price", e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                      className="w-14 text-sm text-right font-medium text-primary bg-transparent outline-none"
                    />
                  </div>
                </div>

                {/* Assigned participants row */}
                {assignedParticipants.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {assignedParticipants.map((p) => (
                      <ParticipantBubble
                        key={p.clientId}
                        participant={p}
                        onRemove={() => toggleAssignment(item.clientId, p.clientId)}
                      />
                    ))}
                  </div>
                )}

                {/* Inline username input for itemize mode */}
                {isActive && (
                  <div ref={activeInputRef} className="mt-2">
                    <UsernameAutocomplete
                      friends={orderedFriends}
                      groups={groups}
                      existingParticipants={assignedParticipants}
                      query={itemQuery}
                      onQueryChange={setItemQuery}
                      onAdd={(p) => handleAddToItem(item.clientId, p)}
                      onAddGroup={(g) => handleAddGroupToItem(item.clientId, g)}
                      inputRef={itemInputRef}
                      placeholder="who had this?"
                      selfId={selfId}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/8" />

        {/* Totals */}
        <div className="px-4 py-3 flex flex-col gap-1.5">
          {state.subtotal !== null && (
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Subtotal</span>
              <span className="text-primary">{formatCurrency(state.subtotal)}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-sm">
            <span className="text-secondary">Tax</span>
            <div className="flex items-center border border-white/15 bg-white/5 rounded-lg px-1.5 py-0.5">
              <span className="text-tertiary text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={state.tax ?? 0}
                onChange={(e) => handleTaxUpdate(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                className="w-16 text-sm text-right text-primary bg-transparent outline-none"
              />
            </div>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-secondary">Tip</span>
            <div className="flex items-center border border-white/15 bg-white/5 rounded-lg px-1.5 py-0.5">
              <span className="text-tertiary text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={state.tip ?? 0}
                onChange={(e) => handleTipUpdate(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                className="w-16 text-sm text-right text-primary bg-transparent outline-none"
              />
            </div>
          </div>
          <div className="flex justify-between pt-1 border-t border-white/8 mt-0.5">
            <span className="font-bold text-primary">Total</span>
            <span className="font-bold text-primary text-lg">{formatCurrency(total)}</span>
          </div>
        </div>
      </GlassCard>

      {/* Retake */}
      {!hideRetake && (
        <GlassButton variant="secondary" size="md" onClick={() => goTo("capture")}>
          Retake
        </GlassButton>
      )}
      </div>
        </div>
      </motion.div>

      {/* Live charge cards */}
      {(liveCharges.length > 0 || ownerAmount != null) && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-primary">Charges</h2>
          {ownerParticipant && ownerAmount != null && (
            <OwnerChargeCard
              participant={ownerParticipant}
              amount={ownerAmount}
              splitMode={state.splitMode}
              items={state.items}
              assignments={state.assignments}
            />
          )}
          {liveCharges.map((charge) => (
            <LiveChargeCard
              key={charge.participant.clientId}
              charge={charge}
              splitMode={state.splitMode}
              items={state.items}
              assignments={state.assignments}
              paid={paidClientIds.has(charge.participant.clientId)}
              onMarkPaid={() => {
                if (onTogglePaid) {
                  onTogglePaid(charge.participant.clientId);
                } else {
                  setInternalPaidClientIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(charge.participant.clientId)) {
                      next.delete(charge.participant.clientId);
                    } else {
                      next.add(charge.participant.clientId);
                    }
                    return next;
                  });
                }
              }}
              merchantName={state.merchantName}
            />
          ))}
        </div>
      )}

      {state.receiptId && (
        <div className="flex justify-center pt-2 pb-4">
          <button
            onClick={handleDelete}
            className="text-sm text-red-500 underline underline-offset-2"
          >
            Delete receipt
          </button>
        </div>
      )}

      {evenSplitOpen && (
        <EvenSplitModal
          friends={orderedFriends}
          groups={groups}
          staged={evenSplitStaged}
          query={evenSplitQuery}
          onQueryChange={setEvenSplitQuery}
          onStage={stageParticipant}
          onStageGroup={stageGroup}
          onUnstage={unstageParticipant}
          onDone={handleEvenSplitDone}
          onCancel={handleEvenSplitCancel}
          inputRef={evenSplitInputRef}
          selfId={selfId}
        />
      )}
    </div>
  );
}

// ─── EvenSplitModal ───────────────────────────────────────────────────────────

function EvenSplitModal({
  friends,
  groups,
  staged,
  query,
  onQueryChange,
  onStage,
  onStageGroup,
  onUnstage,
  onDone,
  onCancel,
  inputRef,
  selfId,
}: {
  friends: Profile[];
  groups: FriendGroup[];
  staged: Omit<FlowParticipant, "clientId">[];
  query: string;
  onQueryChange: (q: string) => void;
  onStage: (p: Omit<FlowParticipant, "clientId">) => void;
  onStageGroup: (group: FriendGroup) => void;
  onUnstage: (venmoUsername: string) => void;
  onDone: () => void;
  onCancel: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  selfId: string | null;
}) {

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <GlassCard
        className="w-full max-w-sm p-6 flex flex-col gap-4"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-bold text-primary">Even split</h2>
          <p className="text-sm text-secondary mt-1">
            Pick who&apos;s in — the whole check is divided evenly between them.
          </p>
        </div>

        {staged.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {staged.map((p) => (
              <ParticipantBubble
                key={p.venmoUsername.toLowerCase()}
                participant={p}
                onRemove={() => onUnstage(p.venmoUsername)}
              />
            ))}
          </div>
        )}

        <UsernameAutocomplete
          friends={friends}
          groups={groups}
          existingParticipants={staged}
          query={query}
          onQueryChange={onQueryChange}
          onAdd={onStage}
          onAddGroup={onStageGroup}
          inputRef={inputRef}
          placeholder="add by Venmo username"
          selfId={selfId}
        />

        <div className="flex items-center gap-2">
          <GlassButton size="md" className="flex-1" onClick={onDone}>
            Done
          </GlassButton>
          <GlassButton variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  );
}

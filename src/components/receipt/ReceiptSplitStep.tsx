"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassInput } from "@/components/ui/GlassInput";
import { Avatar } from "@/components/ui/Avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  formatCurrency,
  formatDate,
  computeEqualCharges,
  computeItemCharges,
} from "@/lib/utils";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import type { Profile, FlowParticipant, ComputedCharge } from "@/types";
import { VenmoIcon } from "@/components/ui/VenmoIcon";
import { buildVenmoLinks } from "@/lib/venmo/deepLink";
import { parseQuantity, parseAmount } from "@/lib/receiptValidation";
import { X, UserPlus, Users2, AlignJustify, Image as ImageIcon, Check } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

// ─── ParticipantBubble ────────────────────────────────────────────────────────

function ParticipantBubble({
  participant,
  onRemove,
}: {
  participant: FlowParticipant;
  onRemove?: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative flex-shrink-0">
      {/* Avatar — toggles tooltip on click */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setShowTooltip((v) => !v)}
        onKeyDown={(e) => e.key === "Enter" && setShowTooltip((v) => !v)}
        className="relative cursor-pointer"
      >
        <Avatar name={participant.displayName} size="sm" />
      </div>
      {/* Remove button — separate from avatar so no nested button */}
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center border border-white/20"
          aria-label="Remove"
        >
          <X className="w-2.5 h-2.5 text-white" />
        </button>
      )}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-sm text-white text-xs rounded-lg px-2.5 py-1 whitespace-nowrap z-30 pointer-events-none shadow-lg">
          @{participant.venmoUsername}
        </div>
      )}
    </div>
  );
}

// ─── UsernameAutocomplete ─────────────────────────────────────────────────────

function UsernameAutocomplete({
  friends,
  existingParticipants,
  query,
  onQueryChange,
  onAdd,
  inputRef,
  placeholder,
}: {
  friends: Profile[];
  existingParticipants: FlowParticipant[];
  query: string;
  onQueryChange: (q: string) => void;
  onAdd: (p: Omit<FlowParticipant, "clientId">) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
}) {
  const raw = query.trim().replace(/^@/, "");

  function isAdded(venmoUsername: string) {
    return existingParticipants.some(
      (p) => p.venmoUsername.toLowerCase() === venmoUsername.toLowerCase()
    );
  }

  const filteredFriends = raw
    ? friends.filter(
        (f) =>
          f.display_name.toLowerCase().includes(raw.toLowerCase()) ||
          (f.venmo_username ?? "").toLowerCase().includes(raw.toLowerCase())
      )
    : friends;

  const exactFriendMatch = raw
    ? friends.find((f) => f.venmo_username?.toLowerCase() === raw.toLowerCase())
    : null;
  const showAddManual = raw.length > 0 && !exactFriendMatch && !isAdded(raw);
  const showDropdown = showAddManual || filteredFriends.length > 0;

  function handleAddFriend(friend: Profile) {
    if (!friend.venmo_username || isAdded(friend.venmo_username)) return;
    onAdd({
      type: "friend",
      userId: friend.id,
      displayName: friend.display_name,
      venmoUsername: friend.venmo_username,
      isOwner: false,
    });
    onQueryChange("");
  }

  function handleAddManual() {
    if (!raw || isAdded(raw)) return;
    onAdd({ type: "manual", displayName: raw, venmoUsername: raw, isOwner: false });
    onQueryChange("");
  }

  return (
    <div className="flex flex-col gap-1">
      <GlassInput
        ref={inputRef}
        prefix="@"
        placeholder={placeholder ?? "search friends or username"}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" && showAddManual) handleAddManual();
        }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {showDropdown && (
        <div className="glass-panel-sm rounded-2xl overflow-hidden flex flex-col z-10">
          {showAddManual && (
            <button
              onClick={handleAddManual}
              className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0">
                <UserPlus className="w-3.5 h-3.5 text-brand" />
              </div>
              <span className="text-sm font-medium text-primary">Add @{raw}</span>
            </button>
          )}
          {filteredFriends.slice(0, 5).map((f) => {
            const added = f.venmo_username ? isAdded(f.venmo_username) : false;
            const noVenmo = !f.venmo_username;
            return (
              <button
                key={f.id}
                onClick={() => handleAddFriend(f)}
                disabled={added || noVenmo}
                className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 active:bg-white/10 transition-colors disabled:opacity-50 text-left"
              >
                <Avatar name={f.display_name} size="sm" />
                <span className="text-sm font-medium text-primary flex-1 min-w-0 truncate">
                  @{f.display_name}
                </span>
                {added && (
                  <span className="text-xs text-brand font-medium flex-shrink-0">Added</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LiveChargeCard ───────────────────────────────────────────────────────────

function LiveChargeCard({
  charge,
  splitMode,
  items,
  assignments,
  paid,
  onMarkPaid,
  defaultNote,
}: {
  charge: ComputedCharge;
  splitMode: "equal" | "by_item";
  items: ReturnType<typeof useReceiptFlow>["state"]["items"];
  assignments: Record<string, string[]>;
  paid: boolean;
  onMarkPaid: () => void;
  defaultNote: string;
}) {
  const [note, setNote] = useState(defaultNote);

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

  function openVenmo() {
    const { venmoLink, venmoAppLink } = buildVenmoLinks({
      recipientUsername: charge.participant.venmoUsername,
      amount: charge.amount,
      note,
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

export function ReceiptSplitStep({ flow, hideRetake = false }: { flow: Flow; hideRetake?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<"parsed" | "original">("parsed");
  const [paidClientIds, setPaidClientIds] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<Profile[]>([]);
  const [evenSplitOpen, setEvenSplitOpen] = useState(false);
  const [evenSplitQuery, setEvenSplitQuery] = useState("");
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const evenSplitInputRef = useRef<HTMLInputElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = useRef<HTMLDivElement | null>(null);

  const { state, addParticipant, removeParticipant, toggleAssignment, clearSplitState, update, goTo } = flow;
  const nonOwnerParticipants = state.participants.filter((p) => !p.isOwner);

  function dismissActiveInput() {
    setEvenSplitOpen(false);
    setEvenSplitQuery("");
    setActiveItemId(null);
    setItemQuery("");
  }

  useEffect(() => {
    if (!evenSplitOpen && !activeItemId) return;
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
  }, [evenSplitOpen, activeItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: selfData }, { data: friendshipData }, { data: externalData }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, venmo_username, email, invite_token, created_at, updated_at")
          .eq("id", user.id)
          .single(),
        supabase
          .from("friendships")
          .select("friend_id, profiles!friendships_friend_id_fkey(id, display_name, venmo_username, email)")
          .eq("user_id", user.id) as unknown as Promise<{ data: Array<{ friend_id: string; profiles: Profile | null }> | null }>,
        supabase
          .from("external_contacts")
          .select("id, venmo_username, display_name")
          .eq("user_id", user.id),
      ]);

      const self: Profile[] = selfData ? [selfData as Profile] : [];
      const realFriends = (friendshipData ?? []).map((f) => f.profiles).filter((p): p is Profile => p !== null);
      const externalFriends: Profile[] = (externalData ?? []).map((c: { id: string; venmo_username: string; display_name: string | null }) => ({
        id: c.id,
        display_name: (c.display_name ?? c.venmo_username) as string,
        venmo_username: c.venmo_username as string,
        email: "",
        invite_token: "",
        created_at: "",
        updated_at: "",
      }));

      setFriends([...self, ...realFriends, ...externalFriends]);
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

  function handleEvenSplitPress() {
    if (state.splitMode === "by_item" && nonOwnerParticipants.length > 0) {
      clearSplitState();
    }
    update("splitMode", "equal");
    setEvenSplitOpen(true);
    setActiveItemId(null);
    setItemQuery("");
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

  function handleAddToEvenSplit(p: Omit<FlowParticipant, "clientId">) {
    addParticipant(p);
    setTimeout(() => evenSplitInputRef.current?.focus(), 50);
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
      return computeEqualCharges(total, state.participants, state.merchantName, state.dateOfReceipt);
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
    <div className="flex flex-col gap-4 pt-4 pb-7">
      {/* View toggle */}
      <div className="flex self-start glass-panel-sm rounded-2xl p-1 gap-1">
        <button
          onClick={() => setView("parsed")}
          className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
            view === "parsed" ? "bg-white/15 text-primary" : "text-tertiary hover:text-secondary"
          }`}
          aria-label="Parsed receipt"
        >
          <AlignJustify className="w-4 h-4" />
        </button>
        <button
          onClick={() => setView("original")}
          className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
            view === "original" ? "bg-white/15 text-primary" : "text-tertiary hover:text-secondary"
          }`}
          aria-label="Original receipt"
        >
          <ImageIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Animated view container — height animates via layout, content fades via AnimatePresence */}
      <motion.div layout transition={{ layout: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } }} className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          {view === "original" ? (
            <motion.div
              key="original"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {state.signedUrl && (
                <GlassCard className="overflow-hidden p-0">
                  <div className="relative w-full" style={{ minHeight: "60vh" }}>
                    <Image
                      src={state.signedUrl}
                      alt="Original receipt"
                      fill
                      className="object-contain"
                    />
                  </div>
                </GlassCard>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="parsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
      <div className="flex flex-col gap-4">
      {/* Receipt card */}
      <GlassCard className="p-0 overflow-hidden">
        {/* Header */}
        <div className="relative px-4 pt-4 pb-3 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-primary text-lg leading-tight truncate">
              {state.merchantName ?? "Receipt"}
            </h2>
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

        {/* Even Split panel */}
        {evenSplitOpen && (
          <div ref={activeInputRef} className="px-4 pb-3 flex flex-col gap-3 border-t border-white/8 pt-3">
            {nonOwnerParticipants.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {nonOwnerParticipants.map((p) => (
                  <ParticipantBubble
                    key={p.clientId}
                    participant={p}
                    onRemove={() => removeParticipant(p.clientId)}
                  />
                ))}
              </div>
            )}
            <UsernameAutocomplete
              friends={friends}
              existingParticipants={state.participants}
              query={evenSplitQuery}
              onQueryChange={setEvenSplitQuery}
              onAdd={handleAddToEvenSplit}
              inputRef={evenSplitInputRef}
              placeholder="add by Venmo username"
            />
          </div>
        )}

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
                  {/* Inline avatars for itemize mode */}
                  {assignedParticipants.length > 0 && (
                    <div className="flex items-center -space-x-1.5">
                      {assignedParticipants.map((p) => (
                        <div key={p.clientId} onClick={(e) => e.stopPropagation()}>
                          <ParticipantBubble
                            participant={p}
                            onRemove={() => toggleAssignment(item.clientId, p.clientId)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
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

                {/* Inline username input for itemize mode */}
                {isActive && (
                  <div ref={activeInputRef} className="mt-2">
                    <UsernameAutocomplete
                      friends={friends}
                      existingParticipants={[]}
                      query={itemQuery}
                      onQueryChange={setItemQuery}
                      onAdd={(p) => handleAddToItem(item.clientId, p)}
                      inputRef={itemInputRef}
                      placeholder="who had this?"
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
            </motion.div>
          )}
        </AnimatePresence>
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
              onMarkPaid={() =>
                setPaidClientIds((prev) => {
                  const next = new Set(prev);
                  next.has(charge.participant.clientId) ? next.delete(charge.participant.clientId) : next.add(charge.participant.clientId);
                  return next;
                })
              }
              defaultNote={`open-tab: ${state.merchantName ?? "receipt"}${state.dateOfReceipt ? ` ${state.dateOfReceipt}` : ""}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

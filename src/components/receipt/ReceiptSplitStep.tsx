"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
import { X, UserPlus, Users2, AlignJustify, Image as ImageIcon } from "lucide-react";

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

// ─── Main Component ───────────────────────────────────────────────────────────

export function ReceiptSplitStep({ flow }: { flow: Flow }) {
  const router = useRouter();
  const [view, setView] = useState<"parsed" | "original">("parsed");
  const [friends, setFriends] = useState<Profile[]>([]);
  const [evenSplitOpen, setEvenSplitOpen] = useState(false);
  const [evenSplitQuery, setEvenSplitQuery] = useState("");
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [saving, setSaving] = useState(false);
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
      const { data } = (await supabase
        .from("friendships")
        .select(
          "friend_id, profiles!friendships_friend_id_fkey(id, display_name, venmo_username, email)"
        )
        .eq("user_id", user.id)) as {
        data: Array<{ friend_id: string; profiles: Profile | null }> | null;
      };
      setFriends(
        (data ?? []).map((f) => f.profiles).filter((p): p is Profile => p !== null)
      );
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

  function handleItemUpdate(clientId: string, field: "name" | "price" | "quantity", raw: string) {
    const newItems = state.items.map((it) => {
      if (it.clientId !== clientId) return it;
      if (field === "name") return { ...it, name: raw };
      if (field === "price") return { ...it, price: Math.round((parseFloat(raw) || 0) * 100) / 100 };
      if (field === "quantity") return { ...it, quantity: Math.max(1, parseInt(raw) || 1) };
      return it;
    });
    update("items", newItems);
    if (field !== "name") {
      const newSubtotal = Math.round(newItems.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
      update("subtotal", newSubtotal);
      update("total", Math.round((newSubtotal + (state.tax ?? 0) + (state.tip ?? 0)) * 100) / 100);
    }
  }

  function handleTaxUpdate(raw: string) {
    const tax = Math.round((parseFloat(raw) || 0) * 100) / 100;
    update("tax", tax);
    const subtotal = Math.round(state.items.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
    update("total", Math.round((subtotal + tax + (state.tip ?? 0)) * 100) / 100);
  }

  function handleTipUpdate(raw: string) {
    const tip = Math.round((parseFloat(raw) || 0) * 100) / 100;
    update("tip", tip);
    const subtotal = Math.round(state.items.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
    update("total", Math.round((subtotal + (state.tax ?? 0) + tip) * 100) / 100);
  }

  const allItemsAssigned =
    state.items.length > 0 &&
    state.items.every((item) => (state.assignments[item.clientId] ?? []).length >= 1);

  const canCharge =
    (state.splitMode === "equal" && nonOwnerParticipants.length >= 1) ||
    (state.splitMode === "by_item" && allItemsAssigned && nonOwnerParticipants.length >= 1);

  async function handleCharge() {
    setSaving(true);
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !state.receiptId) {
      setSaving(false);
      return;
    }

    const total =
      state.total ??
      state.items.reduce((s, it) => s + it.price * it.quantity, 0) +
        (state.tax ?? 0) +
        (state.tip ?? 0);

    let computed: ComputedCharge[];
    if (state.splitMode === "equal") {
      computed = computeEqualCharges(
        total,
        state.participants,
        state.merchantName,
        state.dateOfReceipt
      );
    } else {
      const subtotal = state.items.reduce((s, it) => s + it.price * it.quantity, 0);
      computed = computeItemCharges(
        state.items,
        state.assignments,
        state.participants,
        subtotal,
        state.tax ?? 0,
        state.tip ?? 0,
        state.merchantName,
        state.dateOfReceipt
      );
    }

    // Persist participants
    await supabase
      .from("receipt_participants")
      .delete()
      .eq("receipt_id", state.receiptId);
    await supabase.from("receipt_participants").insert(
      state.participants.map((p) => ({
        receipt_id: state.receiptId,
        user_id: p.userId ?? null,
        venmo_username: p.venmoUsername,
        display_name: p.displayName,
        is_owner: p.isOwner,
      }))
    );

    // Fetch participant DB IDs
    const { data: dbParticipants } = await supabase
      .from("receipt_participants")
      .select("id, venmo_username")
      .eq("receipt_id", state.receiptId);

    const venmoToDbId = Object.fromEntries(
      (dbParticipants ?? []).map(
        (p: { id: string; venmo_username: string }) => [p.venmo_username, p.id]
      )
    );

    // Write charges
    const chargeRows = computed
      .map((c) => ({
        receipt_id: state.receiptId,
        from_user_id: user.id,
        to_participant_id: venmoToDbId[c.participant.venmoUsername] ?? null,
        amount: c.amount,
        venmo_link: c.venmoLink,
      }))
      .filter(
        (r): r is typeof r & { to_participant_id: string } =>
          r.to_participant_id !== null
      );

    if (chargeRows.length > 0) {
      await supabase.from("charges").insert(chargeRows);
    }

    await supabase
      .from("receipts")
      .update({ status: "charging", split_mode: state.splitMode })
      .eq("id", state.receiptId);

    update("charges", computed);
    goTo("charge");
    setSaving(false);
  }

  const total =
    state.total ??
    state.items.reduce((s, it) => s + it.price * it.quantity, 0) +
      (state.tax ?? 0) +
      (state.tip ?? 0);

  return (
    <div className="flex flex-col gap-4 pt-4 pb-28">
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

      {/* Original receipt image */}
      {view === "original" && state.signedUrl && (
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

      {/* Parsed receipt — hidden when viewing original */}
      {view === "original" ? null : (
      <>
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
          {/* Even Split button */}
          <button
            onClick={handleEvenSplitPress}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-sm font-semibold transition-all flex-shrink-0 ${
              state.splitMode === "equal" && (evenSplitOpen || nonOwnerParticipants.length > 0)
                ? "bg-brand/20 text-brand"
                : "glass-panel-sm text-secondary hover:text-primary"
            }`}
          >
            <Users2 className="w-4 h-4" />
            Even Split
          </button>
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
                  {/* Name */}
                  <input
                    value={item.name}
                    onChange={(e) => handleItemUpdate(item.clientId, "name", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 text-sm text-primary bg-transparent outline-none focus:bg-white/5 rounded px-1 -mx-1 truncate"
                  />
                  {/* Quantity */}
                  <div className="flex items-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-tertiary text-xs">×</span>
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={item.quantity}
                      onChange={(e) => handleItemUpdate(item.clientId, "quantity", e.target.value)}
                      className="w-7 text-xs text-tertiary bg-transparent outline-none text-center focus:bg-white/5 rounded [appearance:textfield]"
                    />
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
                  <div className="flex items-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-tertiary text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={item.price}
                      onChange={(e) => handleItemUpdate(item.clientId, "price", e.target.value)}
                      className="w-14 text-sm text-right font-medium text-primary bg-transparent outline-none focus:bg-white/5 rounded [appearance:textfield]"
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
            <div className="flex items-center">
              <span className="text-tertiary text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={state.tax ?? 0}
                onChange={(e) => handleTaxUpdate(e.target.value)}
                className="w-16 text-sm text-right text-primary bg-transparent outline-none focus:bg-white/5 rounded [appearance:textfield]"
              />
            </div>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-secondary">Tip</span>
            <div className="flex items-center">
              <span className="text-tertiary text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={state.tip ?? 0}
                onChange={(e) => handleTipUpdate(e.target.value)}
                className="w-16 text-sm text-right text-primary bg-transparent outline-none focus:bg-white/5 rounded [appearance:textfield]"
              />
            </div>
          </div>
          <div className="flex justify-between pt-1 border-t border-white/8 mt-0.5">
            <span className="font-bold text-primary">Total</span>
            <span className="font-bold text-primary text-lg">{formatCurrency(total)}</span>
          </div>
        </div>
      </GlassCard>

      {/* Cancel / Retake */}
      <div className="flex gap-3">
        <GlassButton
          variant="ghost"
          size="md"
          className="flex-1"
          onClick={() => router.push("/dashboard")}
        >
          Cancel
        </GlassButton>
        <GlassButton
          variant="secondary"
          size="md"
          className="flex-1"
          onClick={() => goTo("capture")}
        >
          Retake
        </GlassButton>
      </div>
      </>
      )}

      {/* Floating Charge button */}
      {canCharge && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-20 px-4 w-full max-w-md">
          <GlassButton
            size="lg"
            loading={saving}
            onClick={handleCharge}
            className="shadow-xl"
          >
            Charge {nonOwnerParticipants.length > 0 ? `${nonOwnerParticipants.length} ` : ""}
            {nonOwnerParticipants.length === 1 ? "person" : "people"}
          </GlassButton>
        </div>
      )}
    </div>
  );
}

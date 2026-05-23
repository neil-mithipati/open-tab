"use client";

import { useState, useEffect } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassInput } from "@/components/ui/GlassInput";
import { Avatar } from "@/components/ui/Avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import type { Profile } from "@/types";
import { X, UserPlus } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

export function AddParticipantsStep({ flow }: { flow: Flow }) {
  const [friends, setFriends] = useState<Profile[]>([]);
  const [query, setQuery] = useState("");
  const { state, addParticipant, removeParticipant, goTo } = flow;

  const nonOwnerParticipants = state.participants.filter((p) => !p.isOwner);

  useEffect(() => {
    async function loadFriends() {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("friendships")
        .select("friend_id, profiles!friendships_friend_id_fkey(id, display_name, venmo_username, email)")
        .eq("user_id", user.id) as { data: Array<{ friend_id: string; profiles: Profile | null }> | null };

      const profiles = (data ?? [])
        .map((f) => f.profiles)
        .filter((p): p is Profile => p !== null);
      setFriends(profiles);
    }
    loadFriends();
  }, []);

  const raw = query.trim().replace(/^@/, "");

  function isAddedById(userId: string) {
    return state.participants.some((p) => p.userId === userId);
  }

  function isUsernameAdded(username: string) {
    return state.participants.some(
      (p) => p.venmoUsername.toLowerCase() === username.toLowerCase()
    );
  }

  function addFriend(friend: Profile) {
    if (isAddedById(friend.id) || !friend.venmo_username) return;
    addParticipant({
      type: "friend",
      userId: friend.id,
      displayName: friend.display_name,
      venmoUsername: friend.venmo_username,
      isOwner: false,
    });
    setQuery("");
  }

  function addManual(username: string) {
    const cleaned = username.trim().replace(/^@/, "");
    if (!cleaned || isUsernameAdded(cleaned)) return;
    addParticipant({
      type: "manual",
      displayName: cleaned,
      venmoUsername: cleaned,
      isOwner: false,
    });
    setQuery("");
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
  const showAddManual = raw.length > 0 && !exactFriendMatch && !isUsernameAdded(raw);

  async function handleNext() {
    // flush any typed-but-not-yet-added username
    if (raw && !isUsernameAdded(raw)) addManual(raw);

    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !state.receiptId) { goTo("choose_split"); return; }

    await supabase.from("receipt_participants").delete().eq("receipt_id", state.receiptId);
    await supabase.from("receipt_participants").insert(
      state.participants.map((p) => ({
        receipt_id: state.receiptId,
        user_id: p.userId ?? null,
        venmo_username: p.venmoUsername,
        display_name: p.displayName,
        is_owner: p.isOwner,
      }))
    );
    goTo("choose_split");
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      {nonOwnerParticipants.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nonOwnerParticipants.map((p) => (
            <div key={p.clientId} className="flex items-center gap-1.5 glass-panel-sm px-3 py-1.5 rounded-2xl">
              <Avatar name={p.displayName} size="sm" />
              <span className="text-sm font-medium text-primary">@{p.displayName}</span>
              <button onClick={() => removeParticipant(p.clientId)} className="text-tertiary hover:text-red-400 ml-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <GlassInput
        label="Add by Venmo username"
        prefix="@"
        placeholder="search friends or any username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" && showAddManual) addManual(raw);
        }}
      />

      <div className="flex flex-col gap-2">
        {showAddManual && (
          <GlassCard
            size="sm"
            className="p-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => addManual(raw)}
          >
            <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-brand" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-primary text-sm">Add @{raw}</p>
              <p className="text-xs text-tertiary">Not in your friends list</p>
            </div>
          </GlassCard>
        )}

        {filteredFriends.length > 0
          ? filteredFriends.map((f) => {
              const added = isAddedById(f.id);
              const noVenmo = !f.venmo_username;
              return (
                <GlassCard
                  key={f.id}
                  size="sm"
                  className={`p-3 flex items-center gap-3 ${!added && !noVenmo ? "cursor-pointer active:scale-[0.98] transition-transform" : "opacity-60"}`}
                  onClick={() => !added && !noVenmo && addFriend(f)}
                >
                  <Avatar name={f.display_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-primary text-sm">@{f.display_name}</p>
                    {noVenmo && <p className="text-xs text-tertiary">Needs Venmo username</p>}
                  </div>
                  {added && <span className="text-xs text-brand font-medium">Added</span>}
                </GlassCard>
              );
            })
          : friends.length === 0 && !raw && (
              <GlassCard size="sm" className="p-5 text-center">
                <p className="text-secondary text-sm">
                  No friends yet — type any Venmo username above to add them.
                </p>
              </GlassCard>
            )}
      </div>

      <GlassButton
        size="lg"
        onClick={handleNext}
        disabled={nonOwnerParticipants.length === 0 && !raw}
        className="mt-2"
      >
        Continue
      </GlassButton>
    </div>
  );
}

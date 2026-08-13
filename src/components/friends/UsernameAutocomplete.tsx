"use client";

import { GlassInput } from "@/components/ui/GlassInput";
import { Avatar } from "@/components/ui/Avatar";
import { formatGroupMembers, type FriendLike } from "@/lib/friendGroups";
import type { FlowParticipant, FriendGroup } from "@/types";
import { UserPlus, Users2 } from "lucide-react";

// Search over friends and friend groups. Groups sit above the friends they
// contain: picking one is the coarse-grained choice, and the caller expands it
// into individual people. Typed on the narrow shapes it actually reads, so both
// the split UI's Profile[] and the profile page's Friend[] fit without adapting.
export function UsernameAutocomplete({
  friends,
  groups,
  existingParticipants,
  query,
  onQueryChange,
  onAdd,
  onAddGroup,
  inputRef,
  placeholder,
  selfId,
}: {
  friends: FriendLike[];
  groups?: FriendGroup[];
  existingParticipants: { venmoUsername: string }[];
  query: string;
  onQueryChange: (q: string) => void;
  onAdd: (p: Omit<FlowParticipant, "clientId">) => void;
  onAddGroup?: (group: FriendGroup) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  selfId?: string | null;
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

  const filteredGroups = !onAddGroup
    ? []
    : raw
      ? (groups ?? []).filter((g) => g.name.toLowerCase().includes(raw.toLowerCase()))
      : (groups ?? []);

  const exactFriendMatch = raw
    ? friends.find((f) => f.venmo_username?.toLowerCase() === raw.toLowerCase())
    : null;
  const showAddManual = raw.length > 0 && !exactFriendMatch && !isAdded(raw);
  const showDropdown =
    showAddManual || filteredFriends.length > 0 || filteredGroups.length > 0;

  function handleAddFriend(friend: FriendLike) {
    if (!friend.venmo_username || isAdded(friend.venmo_username)) return;
    onAdd({
      type: friend.id ? "friend" : "manual",
      userId: friend.id || undefined,
      displayName: friend.display_name,
      venmoUsername: friend.venmo_username,
      // The logged-in user is the owner, not a chargeable recipient.
      isOwner: !!friend.id && friend.id === selfId,
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
        <div className="glass-panel-sm rounded-2xl overflow-y-auto flex flex-col z-10 max-h-64">
          {filteredGroups.map((group) => {
            // Only spent once everyone in it is already on the check — a partial
            // overlap still has people left to add.
            const allAdded =
              group.members.length > 0 && group.members.every((m) => isAdded(m.venmoUsername));
            return (
              <button
                key={group.id}
                onClick={() => onAddGroup?.(group)}
                disabled={allAdded}
                className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 active:bg-white/10 transition-colors disabled:opacity-50 text-left border-b border-white/8"
              >
                <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0">
                  <Users2 className="w-3.5 h-3.5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{group.name}</p>
                  <p className="text-xs text-secondary truncate">
                    {formatGroupMembers(group.members)}
                  </p>
                </div>
                {allAdded && (
                  <span className="text-xs text-brand font-medium flex-shrink-0">Added</span>
                )}
              </button>
            );
          })}
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
          {filteredFriends.map((f) => {
            const added = f.venmo_username ? isAdded(f.venmo_username) : false;
            const noVenmo = !f.venmo_username;
            return (
              <button
                key={f.id || f.venmo_username}
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

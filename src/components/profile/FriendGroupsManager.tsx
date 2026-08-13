"use client";

import { useState } from "react";
import { GlassButton } from "@/components/ui/GlassButton";
import { FriendGroupModal } from "@/components/profile/FriendGroupModal";
import { formatGroupMembers } from "@/lib/friendGroups";
import { deleteFriendGroup } from "@/app/actions/friendGroups";
import { addFriendByUsername, type Friend } from "@/lib/friends";
import { refreshUserCaches } from "@/app/actions/cache";
import type { FriendGroup } from "@/types";
import { Plus, X } from "lucide-react";

interface Props {
  userId: string;
  initialGroups: FriendGroup[];
  initialFriends: Friend[];
}

export function FriendGroupsManager({ userId, initialGroups, initialFriends }: Props) {
  const [groups, setGroups] = useState<FriendGroup[]>(initialGroups);
  const [editing, setEditing] = useState<FriendGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(group: FriendGroup) {
    setDeletingId(group.id);
    setError("");
    // Optimistic: drop the row, restore it if the server rejects.
    const prev = groups;
    setGroups((cur) => cur.filter((g) => g.id !== group.id));
    const result = await deleteFriendGroup(group.id);
    if ("error" in result) {
      setGroups(prev);
      setError(result.error);
    }
    setDeletingId(null);
  }

  function handleSaved(saved: FriendGroup, addedUsernames: string[]) {
    setGroups((cur) => {
      const without = cur.filter((g) => g.id !== saved.id);
      return [...without, saved].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
    });
    setEditing(null);
    setCreating(false);

    // Members typed in by hand join the friends list too, so they're findable
    // on the next check. Best-effort, same as the split UI's auto-add.
    Promise.all(addedUsernames.map((u) => addFriendByUsername(userId, u)))
      .then(() => refreshUserCaches())
      .catch(() => {});
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.length > 0 && (
        <div className="flex flex-col divide-y divide-white/8">
          {groups.map((group) => (
            <div
              key={group.id}
              role="button"
              tabIndex={0}
              onClick={() => setEditing(group)}
              onKeyDown={(e) => e.key === "Enter" && setEditing(group)}
              className="flex items-center gap-3 py-2.5 text-left cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-primary truncate">{group.name}</p>
                <p className="text-xs text-secondary truncate">
                  {group.members.length > 0
                    ? formatGroupMembers(group.members)
                    : "No one in this group yet"}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(group); }}
                disabled={deletingId === group.id}
                className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-tertiary hover:text-primary hover:bg-white/8 transition-colors disabled:opacity-40"
                aria-label={`Delete ${group.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <GlassButton
        variant="secondary"
        size="md"
        className="w-full gap-1.5"
        onClick={() => { setEditing(null); setCreating(true); }}
      >
        <Plus className="w-4 h-4" strokeWidth={2.5} /> Create friend group
      </GlassButton>

      {(creating || editing) && (
        <FriendGroupModal
          key={editing?.id ?? "new"}
          group={editing}
          friends={initialFriends}
          onSaved={handleSaved}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

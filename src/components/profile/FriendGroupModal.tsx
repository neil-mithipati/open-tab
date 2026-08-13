"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassInput } from "@/components/ui/GlassInput";
import { ParticipantBubble } from "@/components/friends/ParticipantBubble";
import { UsernameAutocomplete } from "@/components/friends/UsernameAutocomplete";
import { memberLabel, type FriendLike } from "@/lib/friendGroups";
import { createFriendGroup, updateFriendGroup } from "@/app/actions/friendGroups";
import type { FriendGroup, FriendGroupMember } from "@/types";

// Create or edit a group. Everything is staged locally, so Cancel changes
// nothing — including the friends list, which the manager only touches once a
// save has actually landed.
export function FriendGroupModal({
  group,
  friends,
  onSaved,
  onCancel,
}: {
  group: FriendGroup | null;
  friends: FriendLike[];
  onSaved: (group: FriendGroup, addedUsernames: string[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<FriendGroupMember[]>(group?.members ?? []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function stageMember(p: { displayName: string; venmoUsername: string }) {
    const clean = p.venmoUsername.trim().replace(/^@/, "");
    if (!clean) return;
    setMembers((prev) =>
      prev.some((m) => m.venmoUsername.toLowerCase() === clean.toLowerCase())
        ? prev
        : [...prev, { venmoUsername: clean, displayName: p.displayName }]
    );
    setQuery("");
    setError("");
  }

  function unstageMember(venmoUsername: string) {
    setMembers((prev) =>
      prev.filter((m) => m.venmoUsername.toLowerCase() !== venmoUsername.toLowerCase())
    );
  }

  async function handleDone() {
    const cleanName = name.trim();
    if (!cleanName) { setError("Give your group a name."); return; }
    if (members.length === 0) { setError("Add at least one person."); return; }

    setError("");
    setSaving(true);
    const result = group
      ? await updateFriendGroup(group.id, cleanName, members)
      : await createFriendGroup(cleanName, members);

    if ("error" in result) {
      setError(result.error);
      setSaving(false);
      return;
    }

    // Anyone typed in by hand isn't a friend yet — hand them to the manager to
    // add, so the next check finds them in the search.
    const known = new Set(
      friends.map((f) => (f.venmo_username ?? "").toLowerCase()).filter(Boolean)
    );
    const added = members
      .map((m) => m.venmoUsername)
      .filter((u) => !known.has(u.toLowerCase()));

    onSaved(result.group, added);
  }

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
          <h2 className="text-lg font-bold text-primary">
            {group ? "Edit group" : "New friend group"}
          </h2>
          <p className="text-sm text-secondary mt-1">
            Add the group to a check in one tap — everyone in it is charged
            individually.
          </p>
        </div>

        <GlassInput
          label="Group name"
          placeholder="Roommates"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          autoFocus
          autoCapitalize="words"
          autoCorrect="off"
        />

        {members.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <ParticipantBubble
                key={m.venmoUsername.toLowerCase()}
                participant={{ displayName: memberLabel(m), venmoUsername: m.venmoUsername }}
                onRemove={() => unstageMember(m.venmoUsername)}
              />
            ))}
          </div>
        )}

        {/* No `groups` prop — a group can't contain another group. */}
        <UsernameAutocomplete
          friends={friends}
          existingParticipants={members}
          query={query}
          onQueryChange={setQuery}
          onAdd={stageMember}
          placeholder="add by Venmo username"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          <GlassButton size="md" className="flex-1" loading={saving} onClick={handleDone}>
            Done
          </GlassButton>
          <GlassButton variant="secondary" size="md" disabled={saving} onClick={onCancel}>
            Cancel
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  );
}

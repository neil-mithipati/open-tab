import type { FlowParticipant, FriendGroup, FriendGroupMember } from "@/types";

// The subset of a friend both loaders agree on — profiles and external contacts
// alike. External contacts carry an empty id in the split UI's friend list.
export interface FriendLike {
  id: string;
  display_name: string;
  venmo_username: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  friend_group_members?: { venmo_username: string; display_name: string | null }[] | null;
}

// Shared by the cached server read and the split UI's browser read so the two
// can't drift. Sorting happens here rather than in the query: the test suite's
// Supabase mock has no `.order`, and both callers want the same order anyway.
export function mapGroupRows(rows: unknown): FriendGroup[] {
  if (!Array.isArray(rows)) return [];

  return (rows as GroupRow[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      members: (row.friend_group_members ?? [])
        .map((m) => ({ venmoUsername: m.venmo_username, displayName: m.display_name }))
        .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b), undefined, { sensitivity: "base" })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function memberLabel(member: FriendGroupMember): string {
  return member.displayName ?? member.venmoUsername;
}

// "alice, bob, cara +3" — the group row shows names and a count rather than a
// stack of avatars, so a large group still reads at a glance on one line.
export function formatGroupMembers(members: FriendGroupMember[], max = 3): string {
  const labels = members.map(memberLabel);
  if (labels.length <= max) return labels.join(", ");
  return `${labels.slice(0, max).join(", ")} +${labels.length - max}`;
}

// Expands a group into the participants a check understands. Each member is
// matched against the live friends list by username, which is what recovers the
// account link (and the current display name) for members who are real users —
// an unmatched member becomes a manual entry, exactly as typing the username by
// hand would. Duplicates within the group collapse.
export function groupToParticipants(
  group: FriendGroup,
  friends: FriendLike[],
  selfId: string | null
): Omit<FlowParticipant, "clientId">[] {
  const byUsername = new Map(
    friends
      .filter((f) => f.venmo_username)
      .map((f) => [f.venmo_username!.toLowerCase(), f] as const)
  );

  const seen = new Set<string>();
  const participants: Omit<FlowParticipant, "clientId">[] = [];

  for (const member of group.members) {
    const key = member.venmoUsername.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const friend = byUsername.get(key);
    participants.push({
      type: friend?.id ? "friend" : "manual",
      userId: friend?.id || undefined,
      displayName: friend?.display_name ?? memberLabel(member),
      venmoUsername: friend?.venmo_username ?? member.venmoUsername,
      isOwner: !!friend?.id && friend.id === selfId,
    });
  }

  return participants;
}

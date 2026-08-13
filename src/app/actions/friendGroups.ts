"use server";

import { updateTag } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { userFriendGroupsTag, userFriendsTag } from "@/lib/cacheTags";
import type { FriendGroup } from "@/types";

export interface GroupMemberInput {
  venmoUsername: string;
  displayName: string | null;
}

type GroupResult = { group: FriendGroup } | { error: string };

// Groups are written through the session client rather than the service client:
// they're owner-scoped with nothing to reconcile across users, so the RLS
// policies are the real guard. A create is one insert plus its members, and an
// edit is an update plus a member swap — one action keeps that a single round
// trip with one error surface, unlike the single-row friend writes that happen
// straight from the browser.

export async function createFriendGroup(
  name: string,
  members: GroupMemberInput[]
): Promise<GroupResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const cleanName = name.trim();
  const cleanMembers = dedupeMembers(members);
  if (!cleanName) return { error: "Give your group a name." };
  if (cleanMembers.length === 0) return { error: "Add at least one person." };

  const { data: group, error } = await supabase
    .from("friend_groups")
    .insert({ user_id: user.id, name: cleanName })
    .select("id, name")
    .single();

  if (error || !group) {
    if (error?.code === "23505") return { error: "You already have a group with that name." };
    console.error("[createFriendGroup] Supabase error:", error);
    return { error: "Couldn't create the group. Try again." };
  }

  const membersError = await writeMembers(supabase, group.id, cleanMembers);
  if (membersError) return { error: membersError };

  invalidate(user.id);
  return { group: { id: group.id, name: group.name, members: cleanMembers } };
}

export async function updateFriendGroup(
  groupId: string,
  name: string,
  members: GroupMemberInput[]
): Promise<GroupResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const cleanName = name.trim();
  const cleanMembers = dedupeMembers(members);
  if (!cleanName) return { error: "Give your group a name." };
  if (cleanMembers.length === 0) return { error: "Add at least one person." };

  const { data: group, error } = await supabase
    .from("friend_groups")
    .update({ name: cleanName })
    .eq("id", groupId)
    .eq("user_id", user.id)
    .select("id, name")
    .single();

  if (error || !group) {
    if (error?.code === "23505") return { error: "You already have a group with that name." };
    console.error("[updateFriendGroup] Supabase error:", error);
    return { error: "Couldn't save the group. Try again." };
  }

  // Member rows carry no identity worth preserving, so the staged list replaces
  // them wholesale rather than being diffed.
  const { error: deleteError } = await supabase
    .from("friend_group_members")
    .delete()
    .eq("group_id", groupId);
  if (deleteError) {
    console.error("[updateFriendGroup] Supabase error:", deleteError);
    return { error: "Couldn't save the group. Try again." };
  }

  const membersError = await writeMembers(supabase, groupId, cleanMembers);
  if (membersError) return { error: membersError };

  invalidate(user.id);
  return { group: { id: group.id, name: group.name, members: cleanMembers } };
}

export async function deleteFriendGroup(
  groupId: string
): Promise<{ ok: true } | { error: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("friend_groups")
    .delete()
    .eq("id", groupId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[deleteFriendGroup] Supabase error:", error);
    return { error: "Couldn't delete the group. Try again." };
  }

  updateTag(userFriendGroupsTag(user.id));
  return { ok: true };
}

async function writeMembers(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  groupId: string,
  members: GroupMemberInput[]
): Promise<string | null> {
  const { error } = await supabase.from("friend_group_members").insert(
    members.map((m) => ({
      group_id: groupId,
      venmo_username: m.venmoUsername,
      display_name: m.displayName,
    }))
  );

  if (error) {
    console.error("[writeMembers] Supabase error:", error);
    return "Couldn't save the group's members. Try again.";
  }
  return null;
}

// The unique on (group_id, venmo_username) is case-sensitive, so two spellings
// of the same person would both insert — collapse them before they get there.
function dedupeMembers(members: GroupMemberInput[]): GroupMemberInput[] {
  const seen = new Set<string>();
  const clean: GroupMemberInput[] = [];

  for (const member of members) {
    const venmoUsername = member.venmoUsername.trim().replace(/^@/, "");
    const key = venmoUsername.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clean.push({ venmoUsername, displayName: member.displayName });
  }

  return clean;
}

function invalidate(userId: string) {
  updateTag(userFriendGroupsTag(userId));
  // Members typed into the modal are added to the friends list too.
  updateTag(userFriendsTag(userId));
}

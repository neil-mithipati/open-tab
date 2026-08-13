import { describe, it, expect } from "vitest";
import {
  mapGroupRows,
  formatGroupMembers,
  groupToParticipants,
  type FriendLike,
} from "@/lib/friendGroups";
import type { FriendGroup } from "@/types";

const member = (venmoUsername: string, displayName: string | null = null) => ({
  venmoUsername,
  displayName,
});

describe("mapGroupRows", () => {
  it("returns an empty list for null data", () => {
    expect(mapGroupRows(null)).toEqual([]);
  });

  it("treats a group with no members key as empty", () => {
    expect(mapGroupRows([{ id: "g1", name: "Roommates" }])).toEqual([
      { id: "g1", name: "Roommates", members: [] },
    ]);
  });

  it("maps snake_case member columns to the flow's shape", () => {
    const [group] = mapGroupRows([
      {
        id: "g1",
        name: "Roommates",
        friend_group_members: [{ venmo_username: "alice", display_name: "Alice A" }],
      },
    ]);
    expect(group.members).toEqual([{ venmoUsername: "alice", displayName: "Alice A" }]);
  });

  it("sorts groups by name and members by label", () => {
    const groups = mapGroupRows([
      {
        id: "g2",
        name: "Poker",
        friend_group_members: [
          { venmo_username: "zoe", display_name: null },
          { venmo_username: "adam", display_name: null },
        ],
      },
      { id: "g1", name: "Brunch", friend_group_members: [] },
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Brunch", "Poker"]);
    expect(groups[1].members.map((m) => m.venmoUsername)).toEqual(["adam", "zoe"]);
  });
});

describe("formatGroupMembers", () => {
  it("lists every name when the group is small", () => {
    expect(formatGroupMembers([member("alice"), member("bob")])).toBe("alice, bob");
  });

  it("truncates with a count once past the cap", () => {
    const members = ["alice", "bob", "cara", "dan", "eve", "fin"].map((u) => member(u));
    expect(formatGroupMembers(members)).toBe("alice, bob, cara +3");
  });

  it("prefers the saved display name over the username", () => {
    expect(formatGroupMembers([member("alice", "Alice A")])).toBe("Alice A");
  });
});

describe("groupToParticipants", () => {
  const group: FriendGroup = {
    id: "g1",
    name: "Roommates",
    members: [member("alice", "stale name"), member("bob"), member("carol")],
  };

  const friends: FriendLike[] = [
    { id: "u-alice", display_name: "Alice A", venmo_username: "alice" },
    // External contacts carry an empty id in the split UI's friend list.
    { id: "", display_name: "bob", venmo_username: "bob" },
  ];

  it("links a member who is a real user to their account", () => {
    const [alice] = groupToParticipants(group, friends, null);
    expect(alice).toMatchObject({ type: "friend", userId: "u-alice", venmoUsername: "alice" });
  });

  it("prefers the friend's current name over the saved snapshot", () => {
    const [alice] = groupToParticipants(group, friends, null);
    expect(alice.displayName).toBe("Alice A");
  });

  it("treats an external contact as a manual entry", () => {
    const [, bob] = groupToParticipants(group, friends, null);
    expect(bob).toMatchObject({ type: "manual", userId: undefined, venmoUsername: "bob" });
  });

  it("falls back to the snapshot for a member who is no longer a friend", () => {
    const [, , carol] = groupToParticipants(group, friends, null);
    expect(carol).toMatchObject({ type: "manual", displayName: "carol", venmoUsername: "carol" });
  });

  it("marks the signed-in user as the owner", () => {
    const [alice] = groupToParticipants(group, friends, "u-alice");
    expect(alice.isOwner).toBe(true);
  });

  it("does not mark other members as the owner", () => {
    const [, bob] = groupToParticipants(group, friends, "u-alice");
    expect(bob.isOwner).toBe(false);
  });

  it("collapses members that differ only in case", () => {
    const dupes: FriendGroup = {
      id: "g2",
      name: "Dupes",
      members: [member("Alice"), member("alice")],
    };
    expect(groupToParticipants(dupes, friends, null)).toHaveLength(1);
  });
});

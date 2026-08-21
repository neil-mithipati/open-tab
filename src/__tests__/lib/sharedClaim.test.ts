import { describe, it, expect } from "vitest";
import { computeSharedClaimCharges, isValidVenmoUsername } from "@/lib/utils";
import type { FlowParticipant, EditableItem } from "@/types";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const owner: FlowParticipant = {
  clientId: "owner",
  type: "friend",
  userId: "u-owner",
  displayName: "Me",
  venmoUsername: "me",
  isOwner: true,
};
const alice: FlowParticipant = {
  clientId: "alice",
  type: "friend",
  displayName: "Alice",
  venmoUsername: "alice",
  isOwner: false,
};
const bob: FlowParticipant = {
  clientId: "bob",
  type: "manual",
  displayName: "bob",
  venmoUsername: "bob",
  isOwner: false,
};

// Integer cents throughout — see src/lib/money.ts. The dollar figures in the
// comments are what each cent value means.
const burger: EditableItem = { clientId: "item-1", name: "Burger", price: 1200, quantity: 1 };
const fries: EditableItem = { clientId: "item-2", name: "Fries", price: 800, quantity: 1 };

// ─── computeSharedClaimCharges ───────────────────────────────────────────────

describe("computeSharedClaimCharges", () => {
  it("charges each claimer for the items they claimed (no tax/tip, nothing unclaimed)", () => {
    const assignments = { "item-1": ["alice"], "item-2": ["bob"] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    expect(charges.find((c) => c.participant.clientId === "alice")?.amountCents).toBe(1200);
    expect(charges.find((c) => c.participant.clientId === "bob")?.amountCents).toBe(800);
  });

  it("splits unclaimed items evenly across ALL participants, including the owner", () => {
    // alice claims the burger; fries ($8) goes unclaimed.
    // 3 participants → each owes $8/3 = $2.67 of the unclaimed item.
    const assignments = { "item-1": ["alice"], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    const a = charges.find((c) => c.participant.clientId === "alice")!;
    const b = charges.find((c) => c.participant.clientId === "bob")!;
    // alice: $12 claimed + $2.667 unclaimed share = $14.67
    expect(a.amountCents).toBe(1467);
    // bob: $0 claimed + $2.667 unclaimed share. Exact 1/3 shares of $8 are
    // $2.667, $2.667, $2.667 (owner, alice, bob) summing to $8.00; the owner
    // and alice absorb the two leftover cents (largest-remainder allocation,
    // ties broken by participant order), leaving bob at the floored $2.66 so
    // the three shares sum exactly instead of drifting a cent over $8.00.
    expect(b.amountCents).toBe(266);
  });

  it("applies tax/tip proportionally on top of claimed + unclaimed shares", () => {
    // subtotal=20, tax=2 (10%), tip=4 (20%) → 1.3 multiplier.
    const assignments = { "item-1": ["alice"], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 200, 400, "me", "Test", null
    );
    const a = charges.find((c) => c.participant.clientId === "alice")!;
    const b = charges.find((c) => c.participant.clientId === "bob")!;
    // alice: (12 + 8/3) * 1.3 = 19.07 ; bob: (8/3) * 1.3 = 3.4667, which
    // floors to $3.46 — the owner absorbs the leftover cent (see the
    // largest-remainder note above) so the three shares sum exactly to
    // $26.00 instead of overcollecting by a cent.
    expect(a.amountCents).toBe(1907);
    expect(b.amountCents).toBe(346);
  });

  it("splits a shared item equally between its claimers", () => {
    // alice and bob both claim the burger ($6 each); fries unclaimed ($8/3 each).
    const assignments = { "item-1": ["alice", "bob"], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    const a = charges.find((c) => c.participant.clientId === "alice")!;
    const b = charges.find((c) => c.participant.clientId === "bob")!;
    // Both alice and bob owe an exact $8.6667 (6 + 8/3); the owner absorbs
    // the leftover cent from the $8/3 unclaimed split, so only one of the
    // two non-owners picks up the remaining leftover cent — alice here,
    // by participant order — leaving bob at the floored $8.66.
    expect(a.amountCents).toBe(867);
    expect(b.amountCents).toBe(866);
  });

  it("divides a fully-unclaimed bill evenly among non-owners (owner absorbs own share)", () => {
    const assignments = { "item-1": [], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    // total $20 / 3 participants = $6.6667 each. The owner and alice absorb
    // the two leftover cents (largest-remainder allocation, ties broken by
    // participant order), so alice is $6.67 and bob is the floored $6.66 —
    // the three shares now sum exactly to $20.00 instead of $20.01.
    expect(charges.find((c) => c.participant.clientId === "alice")?.amountCents).toBe(667);
    expect(charges.find((c) => c.participant.clientId === "bob")?.amountCents).toBe(666);
  });

  it("excludes the owner from the returned charges", () => {
    const assignments = { "item-1": ["alice"], "item-2": ["bob"] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    expect(charges.every((c) => !c.participant.isOwner)).toBe(true);
  });

  it("builds a friend → owner pay link (txn=pay, recipient = owner)", () => {
    const assignments = { "item-1": ["alice"], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    const a = charges.find((c) => c.participant.clientId === "alice")!;
    expect(a.venmoLink).toContain("txn=pay");
    expect(a.venmoLink).toContain("recipients=me");
  });

  it("returns an empty array when there are no participants", () => {
    expect(computeSharedClaimCharges([burger], {}, [], 0, 0, "me", "Test", null)).toHaveLength(0);
  });

  // ─── exact-sum rounding ───────────────────────────────────────────────────

  function allFriends(n: number): FlowParticipant[] {
    const list: FlowParticipant[] = [];
    for (let i = 0; i < n; i++) {
      list.push({
        clientId: `f${i}`,
        type: "manual",
        displayName: `Friend ${i}`,
        venmoUsername: `friend${i}`,
        isOwner: false,
      });
    }
    return list;
  }

  it.each([3, 7])(
    "all-friend, fully-unclaimed charges sum exactly to the total for %i people",
    (n) => {
      const participants = allFriends(n);
      const item: EditableItem = { clientId: "item-1", name: "Tab", price: 11671, quantity: 1 };
      const assignments: Record<string, string[]> = { "item-1": [] }; // fully unclaimed
      const tax = 850;
      const tip = 1500;
      const charges = computeSharedClaimCharges(
        [item], assignments, participants, tax, tip, "me", "Test", null
      );
      const grandTotalCents = 11671 + tax + tip;
      const chargeCents = charges.map((c) => c.amountCents);
      expect(chargeCents.reduce((sum, c) => sum + c, 0)).toBe(grandTotalCents);
      expect(Math.max(...chargeCents) - Math.min(...chargeCents)).toBeLessThanOrEqual(1);
    }
  );
});

// ─── isValidVenmoUsername ────────────────────────────────────────────────────

describe("isValidVenmoUsername", () => {
  it("accepts 5–16 char names of letters, numbers, hyphens, underscores", () => {
    expect(isValidVenmoUsername("alice")).toBe(true);
    expect(isValidVenmoUsername("bob_smith")).toBe(true);
    expect(isValidVenmoUsername("a-b-c-d-e")).toBe(true);
    expect(isValidVenmoUsername("sixteen_chars_16")).toBe(true); // exactly 16
  });

  it("rejects names that are too short or too long", () => {
    expect(isValidVenmoUsername("abcd")).toBe(false); // 4
    expect(isValidVenmoUsername("seventeen_chars_x")).toBe(false); // 17
  });

  it("rejects spaces and disallowed characters", () => {
    expect(isValidVenmoUsername("alice smith")).toBe(false);
    expect(isValidVenmoUsername("alice!")).toBe(false);
    expect(isValidVenmoUsername("@alice")).toBe(false); // caller strips the @ first
    expect(isValidVenmoUsername("")).toBe(false);
  });
});

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

const burger: EditableItem = { clientId: "item-1", name: "Burger", price: 12.0, quantity: 1 };
const fries: EditableItem = { clientId: "item-2", name: "Fries", price: 8.0, quantity: 1 };

// ─── computeSharedClaimCharges ───────────────────────────────────────────────

describe("computeSharedClaimCharges", () => {
  it("charges each claimer for the items they claimed (no tax/tip, nothing unclaimed)", () => {
    const assignments = { "item-1": ["alice"], "item-2": ["bob"] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    expect(charges.find((c) => c.participant.clientId === "alice")?.amount).toBe(12);
    expect(charges.find((c) => c.participant.clientId === "bob")?.amount).toBe(8);
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
    expect(a.amount).toBeCloseTo(14.67, 2);
    // bob: $0 claimed + $2.667 unclaimed share = $2.67
    expect(b.amount).toBeCloseTo(2.67, 2);
  });

  it("applies tax/tip proportionally on top of claimed + unclaimed shares", () => {
    // subtotal=20, tax=2 (10%), tip=4 (20%) → 1.3 multiplier.
    const assignments = { "item-1": ["alice"], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 2, 4, "me", "Test", null
    );
    const a = charges.find((c) => c.participant.clientId === "alice")!;
    const b = charges.find((c) => c.participant.clientId === "bob")!;
    // alice: (12 + 8/3) * 1.3 = 19.07 ; bob: (8/3) * 1.3 = 3.47
    expect(a.amount).toBeCloseTo(19.07, 2);
    expect(b.amount).toBeCloseTo(3.47, 2);
  });

  it("splits a shared item equally between its claimers", () => {
    // alice and bob both claim the burger ($6 each); fries unclaimed ($8/3 each).
    const assignments = { "item-1": ["alice", "bob"], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    const a = charges.find((c) => c.participant.clientId === "alice")!;
    const b = charges.find((c) => c.participant.clientId === "bob")!;
    expect(a.amount).toBeCloseTo(8.67, 2); // 6 + 8/3
    expect(b.amount).toBeCloseTo(8.67, 2);
  });

  it("divides a fully-unclaimed bill evenly among non-owners (owner absorbs own share)", () => {
    const assignments = { "item-1": [], "item-2": [] };
    const charges = computeSharedClaimCharges(
      [burger, fries], assignments, [owner, alice, bob], 0, 0, "me", "Test", null
    );
    // total $20 / 3 participants = $6.67 each for the two non-owners.
    expect(charges.find((c) => c.participant.clientId === "alice")?.amount).toBeCloseTo(6.67, 2);
    expect(charges.find((c) => c.participant.clientId === "bob")?.amount).toBeCloseTo(6.67, 2);
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

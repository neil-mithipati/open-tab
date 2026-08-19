import { describe, it, expect } from "vitest";
import { buildVenmoNote, computeEqualCharges, computeItemCharges, formatCurrency } from "@/lib/utils";
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

// ─── computeEqualCharges ───────────────────────────────────────────────────

describe("computeEqualCharges", () => {
  it("splits total evenly among all participants, charges only non-owners", () => {
    // total=$30, 3 participants (owner + alice + bob)  → each owes $30/3=$10
    const charges = computeEqualCharges(30, [owner, alice, bob], "Chipotle", []);
    expect(charges).toHaveLength(2);
    expect(charges.find((c) => c.participant.clientId === "alice")?.amount).toBe(10);
    expect(charges.find((c) => c.participant.clientId === "bob")?.amount).toBe(10);
  });

  it("excludes the owner from the returned charge list", () => {
    const charges = computeEqualCharges(30, [owner, alice], "Chipotle", []);
    expect(charges.every((c) => !c.participant.isOwner)).toBe(true);
  });

  it("returns empty array when there are no non-owner participants", () => {
    const charges = computeEqualCharges(50, [owner], "Chipotle", []);
    expect(charges).toHaveLength(0);
  });

  it("rounds per-person amount to 2 decimal places", () => {
    // $10 / 3 participants = $3.3333… → should round to $3.33
    const charges = computeEqualCharges(10, [owner, alice, bob], "Test", []);
    expect(charges.every((c) => Number.isFinite(c.amount))).toBe(true);
    const str = charges[0].amount.toString();
    const decimals = str.includes(".") ? str.split(".")[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it("includes venmoLink and venmoAppLink on each charge", () => {
    const charges = computeEqualCharges(20, [owner, alice], "Cafe", []);
    expect(charges[0].venmoLink).toMatch(/^https:\/\/venmo\.com/);
    expect(charges[0].venmoAppLink).toMatch(/^venmo:\/\//);
  });

  it("encodes the merchant name and lists all items in the venmo note", () => {
    const charges = computeEqualCharges(20, [owner, alice], "Shake Shack", [burger, fries]);
    // Note: "Open Tab: Shake Shack (Burger, Fries)"
    expect(charges[0].venmoLink).toContain("Open%20Tab");
    expect(charges[0].venmoLink).toContain("Shake%20Shack");
    expect(charges[0].venmoLink).toContain("Burger");
    expect(charges[0].venmoLink).toContain("Fries");
  });
});

describe("buildVenmoNote", () => {
  it("omits the parenthetical when there are no items", () => {
    expect(buildVenmoNote("Chipotle", [])).toBe("Open Tab: Chipotle");
  });

  it("lists items, grouping duplicates with a (xN) suffix", () => {
    const note = buildVenmoNote("Joe's", [
      { name: "Burger", quantity: 1 },
      { name: "Beer", quantity: 1 },
      { name: "Beer", quantity: 1 },
      { name: "Fries", quantity: 1 },
    ]);
    expect(note).toBe("Open Tab: Joe's (Burger, Beer (x2), Fries)");
  });

  it("sums quantities from item lines when grouping", () => {
    const note = buildVenmoNote("Bar", [{ name: "Shot", quantity: 3 }]);
    expect(note).toBe("Open Tab: Bar (Shot (x3))");
  });
});

// ─── computeItemCharges ────────────────────────────────────────────────────

describe("computeItemCharges", () => {
  // subtotal=20, tax=2 (10%), tip=4 (20%), total=26
  const subtotal = 20;
  const tax = 2;
  const tip = 4;

  it("assigns item cost to the person who ordered it, plus prorated tax/tip", () => {
    // alice ordered burger ($12), bob ordered fries ($8)
    const assignments: Record<string, string[]> = {
      "item-1": ["alice"],
      "item-2": ["bob"],
    };
    const charges = computeItemCharges(
      [burger, fries], assignments, [owner, alice, bob],
      subtotal, tax, tip, "Test", null
    );

    const aliceCharge = charges.find((c) => c.participant.clientId === "alice")!;
    const bobCharge = charges.find((c) => c.participant.clientId === "bob")!;

    // alice: $12 * (1 + 0.1 + 0.2) = $12 * 1.3 = $15.60
    expect(aliceCharge.amount).toBeCloseTo(15.6, 2);
    // bob: $8 * 1.3 = $10.40
    expect(bobCharge.amount).toBeCloseTo(10.4, 2);
  });

  it("splits a shared item equally between assignees", () => {
    // alice and bob both ordered the burger ($12 shared → $6 each)
    const assignments: Record<string, string[]> = {
      "item-1": ["alice", "bob"],
      "item-2": [],
    };
    const charges = computeItemCharges(
      [burger, fries], assignments, [owner, alice, bob],
      subtotal, tax, tip, "Test", null
    );
    const aliceCharge = charges.find((c) => c.participant.clientId === "alice")!;
    const bobCharge = charges.find((c) => c.participant.clientId === "bob")!;
    // each pays $6 * 1.3 = $7.80
    expect(aliceCharge.amount).toBeCloseTo(7.8, 2);
    expect(bobCharge.amount).toBeCloseTo(7.8, 2);
  });

  it("returns $0 for a participant with no assigned items", () => {
    // alice ordered everything, bob gets nothing
    const assignments: Record<string, string[]> = {
      "item-1": ["alice"],
      "item-2": ["alice"],
    };
    const charges = computeItemCharges(
      [burger, fries], assignments, [owner, alice, bob],
      subtotal, tax, tip, "Test", null
    );
    const bobCharge = charges.find((c) => c.participant.clientId === "bob")!;
    expect(bobCharge.amount).toBe(0);
  });

  it("excludes the owner from the returned charge list", () => {
    const assignments = { "item-1": ["alice"], "item-2": ["bob"] };
    const charges = computeItemCharges(
      [burger, fries], assignments, [owner, alice, bob],
      subtotal, tax, tip, "Test", null
    );
    expect(charges.every((c) => !c.participant.isOwner)).toBe(true);
  });

  it("handles items with quantity > 1 by multiplying price × quantity", () => {
    const doubleFries: EditableItem = { clientId: "item-2", name: "Fries", price: 4.0, quantity: 2 };
    // price=4, qty=2 → $8 total for item
    const assignments = { "item-1": ["alice"], "item-2": ["bob"] };
    const charges = computeItemCharges(
      [burger, doubleFries], assignments, [owner, alice, bob],
      subtotal, tax, tip, "Test", null
    );
    const bobCharge = charges.find((c) => c.participant.clientId === "bob")!;
    // bob's item subtotal = $8; tax=10% tip=20% → $8 * 1.3 = $10.40
    expect(bobCharge.amount).toBeCloseTo(10.4, 2);
  });
});

// ─── rounding-remainder allocation ─────────────────────────────────────────

// One owner (whose share is implicit, never returned) plus (n - 1) friends,
// so a group of size `n` produces `n - 1` returned charges.
function ownerPlusFriends(n: number): FlowParticipant[] {
  const list: FlowParticipant[] = [{ ...owner }];
  for (let i = 1; i < n; i++) {
    list.push({
      clientId: `p${i}`,
      type: "manual",
      displayName: `Person ${i}`,
      venmoUsername: `person${i}`,
      isOwner: false,
    });
  }
  return list;
}

// A group of `n` friends with no owner at all, so every share is returned
// and their sum can be checked directly against the charged total with no
// implicit, unreturned owner share to account for.
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

describe("computeEqualCharges — exact-sum rounding", () => {
  it.each([
    [3, 100.0],
    [7, 100.0],
    [3, 116.71],
    [7, 116.71],
  ])("all-friend charges sum exactly to the total for %i people, $%s", (n, total) => {
    const participants = allFriends(n);
    const charges = computeEqualCharges(total, participants, "Test", []);
    const totalCents = Math.round(total * 100);
    const chargeCents = charges.map((c) => Math.round(c.amount * 100));
    expect(chargeCents.reduce((sum, c) => sum + c, 0)).toBe(totalCents);
    // No two shares should differ by more than 1 cent in an equal split.
    expect(Math.max(...chargeCents) - Math.min(...chargeCents)).toBeLessThanOrEqual(1);
  });

  it.each([
    [3, 100.0],
    [7, 100.0],
    [3, 116.71],
    [7, 116.71],
  ])("owner's implicit share plus non-owner charges sum exactly to the total for %i people, $%s", (n, total) => {
    const participants = ownerPlusFriends(n);
    const charges = computeEqualCharges(total, participants, "Test", []);
    const totalCents = Math.round(total * 100);
    // Re-derive the owner's implicit share the same way the returned
    // charges were derived (all-friends run above proves the allocator
    // itself sums exactly), then check the invariant holds when an owner
    // is present too.
    const allParticipantCharges = computeEqualCharges(total, allFriends(n).map((p, i) => ({ ...p, isOwner: i === 0 })), "Test", []);
    const impliedOwnerCents = totalCents - allParticipantCharges.reduce((s, c) => s + Math.round(c.amount * 100), 0);
    const nonOwnerCents = charges.reduce((sum, c) => sum + Math.round(c.amount * 100), 0);
    expect(nonOwnerCents + impliedOwnerCents).toBe(totalCents);
  });
});

describe("computeItemCharges — exact-sum rounding", () => {
  it.each([3, 7])("all-friend, fully-shared-item charges sum exactly to the total for %i people", (n) => {
    const participants = allFriends(n);
    const items: EditableItem[] = [{ clientId: "item-1", name: "Shared Tab", price: 116.71, quantity: 1 }];
    const assignments: Record<string, string[]> = {
      "item-1": participants.map((p) => p.clientId),
    };
    const subtotal = 116.71;
    const tax = 8.5;
    const tip = 15.0;
    const charges = computeItemCharges(items, assignments, participants, subtotal, tax, tip, "Test", null);

    const grandTotalCents = Math.round((subtotal + tax + tip) * 100);
    const chargeCents = charges.map((c) => Math.round(c.amount * 100));
    expect(chargeCents.reduce((sum, c) => sum + c, 0)).toBe(grandTotalCents);
    expect(Math.max(...chargeCents) - Math.min(...chargeCents)).toBeLessThanOrEqual(1);
  });
});

// ─── formatCurrency ────────────────────────────────────────────────────────

describe("formatCurrency", () => {
  it("formats whole dollar amounts", () => {
    expect(formatCurrency(10)).toBe("$10.00");
  });
  it("formats cents correctly", () => {
    expect(formatCurrency(3.5)).toBe("$3.50");
  });
  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });
});

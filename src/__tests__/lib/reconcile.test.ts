import { describe, it, expect } from "vitest";
import {
  reconcileReceipt,
  RECONCILE_TOLERANCE_CENTS,
  type ReconcileInput,
} from "@/lib/reconcile";
import { toCents } from "@/lib/money";

// Every amount below is integer cents. A dollar figure appears only where a
// test is about the dollars → cents boundary itself.

function input(over: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    // $12.00 + $8.00 = $20.00 subtotal, $2 tax, $4 tip, $26 total.
    items: [
      { price: 1200, quantity: 1 },
      { price: 800, quantity: 1 },
    ],
    subtotalCents: 2000,
    taxCents: 200,
    tipCents: 400,
    totalCents: 2600,
    ...over,
  };
}

describe("reconcileReceipt — a receipt that adds up", () => {
  it("passes, flags nothing and raises no issue", () => {
    const result = reconcileReceipt(input());

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.flagged).toEqual([]);
  });

  it("handles quantities and a discount line", () => {
    // 3 × $3.33 = $9.99, less a $0.99 coupon = $9.00, plus $0.75 tax = $9.75.
    const result = reconcileReceipt({
      items: [
        { price: 333, quantity: 3 },
        { price: -99, quantity: 1 },
      ],
      subtotalCents: 900,
      taxCents: 75,
      tipCents: null,
      totalCents: 975,
    });

    expect(result.ok).toBe(true);
  });
});

describe("reconcileReceipt — the line items do not sum to the subtotal", () => {
  it("fails, and flags the items and the subtotal", () => {
    // The model read the fries as $8.00 when the subtotal says the two lines
    // came to $24.00.
    const result = reconcileReceipt(
      input({ subtotalCents: 2400, taxCents: 200, tipCents: 400, totalCents: 3000 })
    );

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.check === "items_vs_subtotal");
    expect(issue).toMatchObject({
      expectedCents: 2000,
      actualCents: 2400,
      deltaCents: 400,
      fields: ["items", "subtotal"],
    });
    expect(issue?.message).toContain("$20.00");
    expect(issue?.message).toContain("$24.00");
    expect(result.flagged).toContain("items");
    expect(result.flagged).toContain("subtotal");
    // The other check is satisfied by these numbers, so nothing else is
    // flagged: 2400 + 200 + 400 = 3000.
    expect(result.issues).toHaveLength(1);
    expect(result.flagged).not.toContain("total");
  });
});

describe("reconcileReceipt — subtotal plus tax and tip does not reach the total", () => {
  it("fails, and flags the subtotal and the total", () => {
    // Every line is right; the total was misread as $28.00.
    const result = reconcileReceipt(input({ totalCents: 2800 }));

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.check === "sum_vs_total");
    expect(issue).toMatchObject({
      expectedCents: 2600,
      actualCents: 2800,
      deltaCents: 200,
      fields: ["subtotal", "total"],
    });
    expect(result.flagged).toEqual(["subtotal", "total"]);
    expect(result.issues).toHaveLength(1);
  });

  it("treats a missing tax or tip as zero rather than skipping the check", () => {
    const result = reconcileReceipt({
      items: [{ price: 1000, quantity: 1 }],
      subtotalCents: 1000,
      taxCents: null,
      tipCents: null,
      totalCents: 1500,
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      check: "sum_vs_total",
      expectedCents: 1000,
      actualCents: 1500,
    });
  });

  it("reports both failures at once and unions the flagged fields", () => {
    const result = reconcileReceipt(input({ subtotalCents: 2400, totalCents: 9999 }));

    expect(result.issues.map((i) => i.check)).toEqual([
      "items_vs_subtotal",
      "sum_vs_total",
    ]);
    expect(result.flagged.sort()).toEqual(["items", "subtotal", "total"]);
  });
});

describe("reconcileReceipt — the 2¢ tolerance", () => {
  it("is 2 cents", () => {
    expect(RECONCILE_TOLERANCE_CENTS).toBe(2);
  });

  it.each([-2, -1, 0, 1, 2])("accepts a subtotal %i¢ off the line items", (off) => {
    expect(reconcileReceipt(input({ subtotalCents: 2000 + off, totalCents: null })).ok).toBe(
      true
    );
  });

  it.each([-3, 3])("rejects a subtotal %i¢ off the line items", (off) => {
    expect(reconcileReceipt(input({ subtotalCents: 2000 + off, totalCents: null })).ok).toBe(
      false
    );
  });

  it.each([-2, 2])("accepts a total %i¢ off subtotal plus tax and tip", (off) => {
    expect(reconcileReceipt(input({ totalCents: 2600 + off })).ok).toBe(true);
  });

  it.each([-3, 3])("rejects a total %i¢ off subtotal plus tax and tip", (off) => {
    expect(reconcileReceipt(input({ totalCents: 2600 + off })).ok).toBe(false);
  });
});

describe("reconcileReceipt — incomplete is not wrong", () => {
  it("skips the item check when the receipt has no subtotal on it", () => {
    expect(reconcileReceipt(input({ subtotalCents: null, totalCents: null })).ok).toBe(true);
  });

  it("skips the item check when nothing was itemised", () => {
    const result = reconcileReceipt({
      items: [],
      subtotalCents: 2000,
      taxCents: 200,
      tipCents: 400,
      totalCents: 2600,
    });

    expect(result.ok).toBe(true);
  });

  it("skips the total check when there is no total", () => {
    expect(reconcileReceipt(input({ totalCents: null })).ok).toBe(true);
  });
});

describe("reconcileReceipt — the rounding edge case", () => {
  // The failure this whole design exists to prevent: a receipt that is
  // actually correct reading as a mismatch because a half-cent was rounded
  // twice, or rounded one way in the split arithmetic and another way here.
  //
  // Five lines at $1.005. The merchant's own subtotal is 5 × 1.005 = $5.025,
  // printed as $5.03.
  const unitDollars = 1.005;
  const lines = 5;
  const printedSubtotal = 5.03;

  it("rounds each dollar figure once, at the boundary, and the receipt passes", () => {
    // toCents is the single rounding step. $1.005 → 101¢, and the sum of the
    // lines is then exact integer arithmetic: 5 × 101 = 505¢.
    const unitCents = toCents(unitDollars);
    expect(unitCents).toBe(101);

    const result = reconcileReceipt({
      items: [{ price: unitCents, quantity: lines }],
      subtotalCents: toCents(printedSubtotal),
      taxCents: 0,
      tipCents: 0,
      totalCents: toCents(printedSubtotal),
    });

    // 505 against 503 — two cents, exactly the tolerance, which is what the
    // tolerance is for.
    expect(toCents(printedSubtotal)).toBe(503);
    expect(result.ok).toBe(true);
  });

  it("would fail this same correct receipt if the cent were rounded naively", () => {
    // Math.round($1.005 * 100) is 100, not 101 — binary floating point puts
    // 1.005 * 100 at 100.49999999999999. Five lines lose five cents, which
    // pushes a correct receipt three cents out and past the tolerance.
    const naiveUnitCents = Math.round(unitDollars * 100);
    expect(naiveUnitCents).toBe(100);

    const result = reconcileReceipt({
      items: [{ price: naiveUnitCents, quantity: lines }],
      subtotalCents: toCents(printedSubtotal),
      taxCents: 0,
      tipCents: 0,
      totalCents: toCents(printedSubtotal),
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0].deltaCents).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import {
  validateModelReceipt,
  parsedReceiptCentsSchema,
  ReceiptParseError,
} from "@/lib/gemini/parseReceipt";
import { reconcileReceipt } from "@/lib/reconcile";

// What the model is asked for: plain USD numbers. validateModelReceipt is the
// server-side gate between that reply and any database write — it validates
// the shape, then converts to integer cents. Nothing that fails it is
// returned, so nothing that fails it can be persisted.

const GOOD = {
  merchant_name: "Cafe Mote",
  date_of_receipt: "2026-08-19",
  items: [
    { name: "Latte", price: 5.25, quantity: 2 },
    { name: "Croissant", price: 3.5, quantity: 1 },
  ],
  subtotal: 14,
  tax: 1.26,
  tip: 2.8,
  total: 18.06,
};

describe("validateModelReceipt — a usable reply", () => {
  it("converts every amount to integer cents", () => {
    const receipt = validateModelReceipt(GOOD);

    expect(receipt).toEqual({
      merchant_name: "Cafe Mote",
      date_of_receipt: "2026-08-19",
      items: [
        { name: "Latte", price: 525, quantity: 2 },
        { name: "Croissant", price: 350, quantity: 1 },
      ],
      subtotal: 1400,
      tax: 126,
      tip: 280,
      total: 1806,
    });
    // Integers, not "integers to two decimal places".
    for (const value of [receipt.subtotal, receipt.tax, receipt.tip, receipt.total]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("keeps a discount line, which is a genuinely negative price", () => {
    const receipt = validateModelReceipt({
      ...GOOD,
      items: [...GOOD.items, { name: "Coupon", price: -2, quantity: 1 }],
      subtotal: 12,
      total: 16.06,
    });

    expect(receipt.items[2]).toEqual({ name: "Coupon", price: -200, quantity: 1 });
  });

  it("normalises a quantity rather than dropping the line", () => {
    const receipt = validateModelReceipt({
      ...GOOD,
      items: [{ name: "Latte", price: 5.25, quantity: 0 }],
    });

    expect(receipt.items[0].quantity).toBe(1);
  });

  it("drops a date it cannot put in a date column, and keeps the receipt", () => {
    const receipt = validateModelReceipt({ ...GOOD, date_of_receipt: "last Tuesday" });

    expect(receipt.date_of_receipt).toBeNull();
    expect(receipt.total).toBe(1806);
  });

  it("gives an unnamed line a placeholder so it stays in the arithmetic", () => {
    const receipt = validateModelReceipt({
      ...GOOD,
      items: [{ name: "   ", price: 5.25, quantity: 1 }],
    });

    expect(receipt.items[0]).toEqual({ name: "Item", price: 525, quantity: 1 });
  });
});

describe("validateModelReceipt — the all-nulls EMPTY parse", () => {
  // The live hazard this task exists to close. parseReceiptImage used to
  // swallow a reply that failed JSON.parse and hand back this object, which
  // the route then wrote as if the photo had genuinely been read and simply
  // had no values on it.
  const EMPTY = {
    merchant_name: null,
    date_of_receipt: null,
    items: [],
    subtotal: null,
    tax: null,
    tip: null,
    total: null,
  };

  it("throws rather than returning something persistable", () => {
    expect(() => validateModelReceipt(EMPTY)).toThrow(ReceiptParseError);
    expect(() => validateModelReceipt(EMPTY)).toThrow(/nothing was read off this receipt/);
  });

  it("is refused by the schema the write path checks, too", () => {
    expect(parsedReceiptCentsSchema.safeParse(EMPTY).success).toBe(false);
  });

  it("does not look like a transient failure the route should retry", () => {
    try {
      validateModelReceipt(EMPTY);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ReceiptParseError).name).toBe("ReceiptParseError");
      expect((err as ReceiptParseError).reason).toBe("empty");
    }
  });

  it("still accepts a receipt with a total but no itemisation", () => {
    const receipt = validateModelReceipt({ ...EMPTY, total: 18.06 });

    expect(receipt.total).toBe(1806);
  });
});

describe("validateModelReceipt — malformed replies", () => {
  it.each([
    ["not an object", 42],
    ["null", null],
    ["items missing", { ...GOOD, items: undefined }],
    ["items not an array", { ...GOOD, items: "Latte" }],
    ["a price that is a string", { ...GOOD, items: [{ name: "Latte", price: "5.25", quantity: 1 }] }],
    ["a NaN total", { ...GOOD, total: NaN }],
    ["a negative total", { ...GOOD, total: -18.06 }],
    ["a negative subtotal", { ...GOOD, subtotal: -14 }],
  ])("throws on %s", (_label, reply) => {
    expect(() => validateModelReceipt(reply)).toThrow(ReceiptParseError);
  });

  it("reports which field was wrong", () => {
    try {
      validateModelReceipt({ ...GOOD, total: -1 });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ReceiptParseError).reason).toBe("schema");
      expect((err as Error).message).toContain("total");
    }
  });
});

describe("validateModelReceipt — the rounding edge case, end to end", () => {
  // Half-cent dollar values off a real receipt: five units at $1.005 each,
  // with the merchant's own printed subtotal of $5.03. The conversion rounds
  // once, at this boundary, and the reconciliation check that runs next does
  // no rounding at all — so the receipt reads as correct, which it is.
  const HALF_CENT = {
    merchant_name: "Bulk Bin",
    date_of_receipt: "2026-08-19",
    items: [{ name: "Scoop", price: 1.005, quantity: 5 }],
    subtotal: 5.03,
    tax: null,
    tip: null,
    total: 5.03,
  };

  it("rounds $1.005 up to 101¢ and the receipt reconciles", () => {
    const receipt = validateModelReceipt(HALF_CENT);

    expect(receipt.items[0].price).toBe(101);
    expect(receipt.subtotal).toBe(503);
    expect(receipt.total).toBe(503);

    const result = reconcileReceipt({
      items: receipt.items,
      subtotalCents: receipt.subtotal,
      taxCents: receipt.tax,
      tipCents: receipt.tip,
      totalCents: receipt.total,
    });

    // 5 × 101 = 505 against a printed 503: two cents, inside the tolerance.
    expect(result.ok).toBe(true);
  });
});

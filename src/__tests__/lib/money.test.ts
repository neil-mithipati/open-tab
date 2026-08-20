import { describe, it, expect } from "vitest";
import {
  centsInputValue,
  formatCents,
  fromCents,
  fromCentsOrNull,
  itemsSubtotalCents,
  lineTotalCents,
  parseAmountCents,
  roundCents,
  toCents,
  toCentsOrNull,
} from "@/lib/money";

// The rounding rule under test, stated in src/lib/money.ts: half away from
// zero, at the cent, applied exactly once at a dollars → cents boundary, and
// never again below it.

describe("roundCents — half away from zero", () => {
  it("rounds a half up in magnitude, in both directions", () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(2.5)).toBe(3);
    // Math.round is half-UP rather than half-away-from-zero and would return
    // -2 here. A discount line is the case that notices.
    expect(roundCents(-2.5)).toBe(-3);
    expect(roundCents(-0.5)).toBe(-1);
  });

  it("leaves whole cents alone", () => {
    expect(roundCents(0)).toBe(0);
    expect(roundCents(1234)).toBe(1234);
    expect(roundCents(-1234)).toBe(-1234);
  });

  it("refuses a non-finite value rather than producing NaN cents", () => {
    expect(() => roundCents(NaN)).toThrow(RangeError);
    expect(() => roundCents(Infinity)).toThrow(RangeError);
  });
});

describe("toCents — the rounding edge case", () => {
  // The whole reason roundCents normalises to 12 significant digits first.
  // 1.005 * 100 is 100.49999999999999 in binary floating point, so the naive
  // Math.round(dollars * 100) answers 100¢ for a value the receipt prints as
  // $1.005 and every human reads as 101¢.
  it("rounds $1.005 to 101 cents, where Math.round(d * 100) gives 100", () => {
    expect(1.005 * 100).toBe(100.49999999999999);
    expect(Math.round(1.005 * 100)).toBe(100);
    expect(toCents(1.005)).toBe(101);
  });

  it("rounds $0.145 to 15 cents, where Math.round(d * 100) gives 14", () => {
    expect(Math.round(0.145 * 100)).toBe(14);
    expect(toCents(0.145)).toBe(15);
  });

  it("rounds a negative half away from zero: -$1.005 → -101 cents", () => {
    expect(Math.round(-1.005 * 100)).toBe(-100);
    expect(toCents(-1.005)).toBe(-101);
  });

  it("does not round a value that is merely close to a half", () => {
    // 12 significant digits is far finer than a cent, so it cannot mask a
    // genuine fraction below the half.
    expect(toCents(1.004999)).toBe(100);
    expect(toCents(1.00501)).toBe(101);
  });

  it("converts ordinary money exactly", () => {
    expect(toCents(0)).toBe(0);
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(10.1)).toBe(1010);
    expect(toCents(99999999.99)).toBe(9999999999);
  });

  it("passes null and undefined through", () => {
    expect(toCentsOrNull(null)).toBeNull();
    expect(toCentsOrNull(undefined)).toBeNull();
    expect(toCentsOrNull(4.2)).toBe(420);
  });
});

describe("fromCents — the way back out", () => {
  it("round-trips every cent value it is given", () => {
    for (const cents of [0, 1, 99, 100, 101, 1234, 9999, 100000]) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
  });

  it("prints the exact two-decimal value a numeric(10,2) column expects", () => {
    expect(fromCents(1234).toFixed(2)).toBe("12.34");
    expect(fromCents(5).toFixed(2)).toBe("0.05");
    expect(fromCentsOrNull(null)).toBeNull();
    expect(fromCentsOrNull(305)).toBe(3.05);
  });
});

describe("display and input helpers", () => {
  it("formats cents as USD", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(-500)).toBe("-$5.00");
  });

  it("renders an input value without forcing decimals mid-typing", () => {
    expect(centsInputValue(1234)).toBe("12.34");
    expect(centsInputValue(1200)).toBe("12");
    expect(centsInputValue(0)).toBe("0");
  });

  it("parses what a user types into whole cents", () => {
    expect(parseAmountCents("12.34")).toBe(1234);
    expect(parseAmountCents("$12.34")).toBe(1234);
    expect(parseAmountCents("12")).toBe(1200);
    expect(parseAmountCents("")).toBe(0);
    expect(parseAmountCents(".")).toBe(0);
    expect(parseAmountCents("abc")).toBe(0);
    // A second decimal point and everything after it is dropped.
    expect(parseAmountCents("12.3.4")).toBe(1230);
    // Sub-cent typing rounds by the same rule as everything else.
    expect(parseAmountCents("1.005")).toBe(101);
  });
});

describe("line arithmetic stays integral", () => {
  it("multiplies unit price by quantity without rounding", () => {
    expect(lineTotalCents({ price: 333, quantity: 3 })).toBe(999);
    expect(lineTotalCents({ price: 101, quantity: 5 })).toBe(505);
  });

  it("sums lines exactly", () => {
    expect(
      itemsSubtotalCents([
        { price: 1200, quantity: 1 },
        { price: 800, quantity: 2 },
        { price: -150, quantity: 1 },
      ])
      // $12.00 + 2 × $8.00 − $1.50 discount.
    ).toBe(2650);
    expect(itemsSubtotalCents([])).toBe(0);
  });
});

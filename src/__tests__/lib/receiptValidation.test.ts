import { describe, it, expect } from "vitest";
import { parseQuantity, parseAmount } from "@/lib/receiptValidation";

// ─── parseQuantity ────────────────────────────────────────────────────────────

describe("parseQuantity", () => {
  describe("valid integers", () => {
    it("parses 1", () => expect(parseQuantity("1")).toBe(1));
    it("parses 5", () => expect(parseQuantity("5")).toBe(5));
    it("parses 100", () => expect(parseQuantity("100")).toBe(100));
    it("strips leading zeros", () => expect(parseQuantity("02")).toBe(2));
  });

  describe("zero is rejected (minimum is 1)", () => {
    it("returns 1 for '0'", () => expect(parseQuantity("0")).toBe(1));
    it("returns 1 for '00'", () => expect(parseQuantity("00")).toBe(1));
  });

  describe("non-numeric input", () => {
    it("returns 1 for empty string", () => expect(parseQuantity("")).toBe(1));
    it("returns 1 for letters", () => expect(parseQuantity("abc")).toBe(1));
    it("returns 1 for symbols", () => expect(parseQuantity("!@#")).toBe(1));
    it("returns 1 for whitespace", () => expect(parseQuantity("   ")).toBe(1));
  });

  describe("negative numbers are rejected", () => {
    it("strips minus sign and parses remaining digits", () =>
      expect(parseQuantity("-3")).toBe(3));
    it("returns 1 when only minus sign remains", () =>
      expect(parseQuantity("-")).toBe(1));
  });

  describe("decimals are not allowed for quantity", () => {
    it("truncates decimal for '1.5'", () => expect(parseQuantity("1.5")).toBe(1));
    it("truncates decimal for '2.9'", () => expect(parseQuantity("2.9")).toBe(2));
    it("returns 1 for '.5' (no integer part)", () => expect(parseQuantity(".5")).toBe(1));
  });
});

// ─── parseAmount ─────────────────────────────────────────────────────────────

describe("parseAmount", () => {
  describe("valid amounts", () => {
    it("parses integer", () => expect(parseAmount("10")).toBe(10));
    it("parses decimal", () => expect(parseAmount("8.50")).toBe(8.5));
    it("parses zero", () => expect(parseAmount("0")).toBe(0));
    it("parses '0.00'", () => expect(parseAmount("0.00")).toBe(0));
    it("parses small decimal", () => expect(parseAmount("0.99")).toBe(0.99));
    it("parses leading decimal '.5'", () => expect(parseAmount(".5")).toBe(0.5));
  });

  describe("non-numeric input", () => {
    it("returns 0 for empty string", () => expect(parseAmount("")).toBe(0));
    it("returns 0 for letters", () => expect(parseAmount("abc")).toBe(0));
    it("returns 0 for symbols", () => expect(parseAmount("!@#")).toBe(0));
    it("returns 0 for bare decimal point", () => expect(parseAmount(".")).toBe(0));
  });

  describe("negative numbers are rejected", () => {
    it("strips minus and parses remaining digits", () =>
      expect(parseAmount("-5")).toBe(5));
    it("strips minus sign only result returns 0", () =>
      expect(parseAmount("-")).toBe(0));
  });

  describe("rounding to 2 decimal places", () => {
    it("rounds down '1.234'", () => expect(parseAmount("1.234")).toBe(1.23));
    it("rounds up '1.235'", () => expect(parseAmount("1.235")).toBe(1.24));
    it("rounds '9.999'", () => expect(parseAmount("9.999")).toBe(10));
  });

  describe("multiple decimal points", () => {
    it("ignores second decimal point in '1.2.3'", () =>
      expect(parseAmount("1.2.3")).toBe(1.2));
    it("ignores second decimal in '0.5.0'", () =>
      expect(parseAmount("0.5.0")).toBe(0.5));
  });

  describe("zero is allowed (e.g. no-tax receipts)", () => {
    it("accepts '0' for tax", () => expect(parseAmount("0")).toBe(0));
    it("accepts '0.00' for tip", () => expect(parseAmount("0.00")).toBe(0));
  });
});

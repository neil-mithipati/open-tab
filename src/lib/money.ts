// ===========================================================================
// Money.
//
// Every amount between the parse boundary and the screen is an INTEGER NUMBER
// OF CENTS. Floating-point dollars exist in exactly two places, both of them
// edges:
//
//   in   — what Gemini returns (plain USD numbers) and what Postgres returns
//          for a numeric(10,2) column. Converted with toCents() on the way in.
//   out  — what gets written back to a numeric(10,2) column, what a Venmo
//          deep link carries, and what a user reads on screen. Converted with
//          fromCents() / formatCents() on the way out.
//
// Nothing in between — not the split arithmetic, not the reconciliation check,
// not the charge rows — is allowed to hold a fractional dollar.
//
// ---------------------------------------------------------------------------
// THE ROUNDING RULE, stated once so it can be applied identically everywhere:
//
//   1. Half away from zero, at the cent.
//   2. Applied exactly ONCE, at a dollars → cents boundary.
//   3. Below that boundary nothing rounds again. Division inside the cent
//      domain (splitting a bill N ways, pro-rating tax) allocates by largest
//      remainder — see allocateCents in src/lib/utils.ts — so the parts always
//      sum exactly to the whole rather than each rounding independently.
//
// Rule 3 is the one that matters for reconciliation: because the check
// compares integers that were rounded once, a receipt that is actually correct
// can never fail it on a half-cent. A second rounding anywhere would produce
// exactly that, and a warning users learn to click through is worse than the
// bug it was meant to catch.
// ===========================================================================

// Binary floating point cannot represent most cent values exactly, so the
// naive Math.round(dollars * 100) rounds a real half-cent the WRONG way about
// as often as the right way: 1.005 * 100 is 100.49999999999999, which rounds
// to 100¢ rather than 101¢. Normalising to 12 significant digits first snaps
// that representation error away before the rounding decision is taken.
//
// 12 digits is chosen against the column, not arbitrarily: numeric(10,2) tops
// out at 99,999,999.99, which is 10 digits of cents, so 12 leaves two spare
// digits of sub-cent precision to round on and still cannot reach far enough
// down to mask a genuine fraction.
const SIGNIFICANT_DIGITS = 12;

/**
 * Round a possibly-fractional cent value to a whole cent, half away from zero.
 * This is the single rounding primitive; everything else in this file is
 * expressed in terms of it.
 */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundCents: ${value} is not a finite number`);
  }
  const normalised = Number(value.toPrecision(SIGNIFICANT_DIGITS));
  // Math.round is half-UP, not half-away-from-zero: it sends -0.5 to -0.
  // Rounding the magnitude and re-applying the sign keeps the rule symmetric,
  // which matters for a discount line.
  return Math.sign(normalised) * Math.round(Math.abs(normalised));
}

/** Dollars (a model reply, a numeric(10,2) column) → integer cents. */
export function toCents(dollars: number): number {
  return roundCents(dollars * 100);
}

/** Same, but null and undefined pass straight through. */
export function toCentsOrNull(dollars: number | null | undefined): number | null {
  return dollars === null || dollars === undefined ? null : toCents(dollars);
}

/**
 * Integer cents → dollars, for the two places that need them: a numeric(10,2)
 * write and a Venmo `amount=` parameter.
 *
 * cents / 100 for an integer under ten digits always prints as the exact
 * two-decimal value ((1234 / 100).toString() === "12.34"), so the number
 * handed to Postgres or serialised into a URL is the one intended.
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Same, but null and undefined pass straight through. */
export function fromCentsOrNull(cents: number | null | undefined): number | null {
  return cents === null || cents === undefined ? null : fromCents(cents);
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Integer cents → "$12.34", for display. */
export function formatCents(cents: number): string {
  return USD.format(fromCents(cents));
}

/**
 * Integer cents → the string a controlled money <input> shows.
 *
 * Deliberately not toFixed(2): the inputs in the split step re-render from
 * state on every keystroke, and forcing two decimals would rewrite what the
 * user is halfway through typing. String(cents / 100) reproduces exactly what
 * the raw number rendered before money moved to cents — 1234 → "12.34",
 * 1200 → "12" — so the typing behaviour is unchanged.
 */
export function centsInputValue(cents: number): string {
  return String(fromCents(cents));
}

/**
 * A money string typed by a user → integer cents. Returns 0 for anything
 * missing, negative or non-numeric; digits past a second decimal point are
 * discarded, and the cent is rounded by the rule above.
 *
 * The dollar-denominated twin of this lives in src/lib/receiptValidation.ts as
 * parseAmount and is no longer on the money path; this is what the split step
 * uses.
 */
export function parseAmountCents(raw: string): number {
  const noInvalid = raw.replace(/[^\d.]/g, "");
  // Keep only the first decimal point and its following digits.
  const parts = noInvalid.split(".");
  const cleaned = parts.length > 1 ? `${parts[0]}.${parts[1]}` : parts[0];
  if (!cleaned || cleaned === ".") return 0;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return toCents(n);
}

/** Total cents for a line: unit price × quantity. Both are integers already. */
export function lineTotalCents(item: { price: number; quantity: number }): number {
  return item.price * item.quantity;
}

/** Sum of every line, in cents. Exact — integers only, nothing to round. */
export function itemsSubtotalCents(
  items: readonly { price: number; quantity: number }[]
): number {
  return items.reduce((sum, item) => sum + lineTotalCents(item), 0);
}

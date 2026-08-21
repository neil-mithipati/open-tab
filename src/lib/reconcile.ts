import { formatCents, itemsSubtotalCents } from "@/lib/money";

// ===========================================================================
// Does the receipt add up?
//
// Two checks, both on integer cents, both with the same 2¢ tolerance:
//
//   sum(line items)      ≈ subtotal
//   subtotal + tax + tip ≈ total
//
// The tolerance exists because a real receipt can legitimately be a cent or
// two out — a merchant that rounds a per-unit price for display, a tax line
// computed on an un-rounded base. It is NOT there to absorb our own rounding:
// everything here is already integer cents, rounded once at the parse
// boundary (see src/lib/money.ts), so this check never rounds anything itself
// and a receipt that is actually correct always reads as correct.
//
// A failure is not an error. It means one of the numbers the model read off
// the photo is wrong and we cannot tell which, so the user gets sent to the
// edit screen with the suspect fields flagged rather than having a total they
// never saw turned into a Venmo charge.
// ===========================================================================

export const RECONCILE_TOLERANCE_CENTS = 2;

/** The fields an edit screen highlights when a check fails. */
export type ReconcileField = "items" | "subtotal" | "total";

export type ReconcileCheck = "items_vs_subtotal" | "sum_vs_total";

export interface ReconcileIssue {
  check: ReconcileCheck;
  /** What the other numbers on the receipt say this should be, in cents. */
  expectedCents: number;
  /** What the receipt actually reads, in cents. */
  actualCents: number;
  /** actual − expected, in cents. Signed. */
  deltaCents: number;
  fields: ReconcileField[];
  /** Plain-language version, shown to the user. */
  message: string;
}

export interface ReconcileResult {
  ok: boolean;
  issues: ReconcileIssue[];
  /** Union of every failing check's fields, for highlighting. */
  flagged: ReconcileField[];
}

export interface ReconcileInput {
  items: readonly { price: number; quantity: number }[];
  subtotalCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  totalCents: number | null;
}

const OK: ReconcileResult = { ok: true, issues: [], flagged: [] };

function within(deltaCents: number): boolean {
  return Math.abs(deltaCents) <= RECONCILE_TOLERANCE_CENTS;
}

/**
 * Run both checks. A check whose inputs are missing is skipped rather than
 * failed: a receipt with no subtotal on it is incomplete, not wrong, and
 * flagging it would train the user to ignore the flag.
 */
export function reconcileReceipt(input: ReconcileInput): ReconcileResult {
  const { items, subtotalCents, taxCents, tipCents, totalCents } = input;
  const issues: ReconcileIssue[] = [];

  if (subtotalCents !== null && items.length > 0) {
    const summed = itemsSubtotalCents(items);
    const delta = subtotalCents - summed;
    if (!within(delta)) {
      issues.push({
        check: "items_vs_subtotal",
        expectedCents: summed,
        actualCents: subtotalCents,
        deltaCents: delta,
        fields: ["items", "subtotal"],
        message: `The items add up to ${formatCents(summed)}, but the subtotal reads ${formatCents(subtotalCents)}.`,
      });
    }
  }

  if (totalCents !== null && subtotalCents !== null) {
    const summed = subtotalCents + (taxCents ?? 0) + (tipCents ?? 0);
    const delta = totalCents - summed;
    if (!within(delta)) {
      issues.push({
        check: "sum_vs_total",
        expectedCents: summed,
        actualCents: totalCents,
        deltaCents: delta,
        fields: ["subtotal", "total"],
        message: `Subtotal plus tax and tip comes to ${formatCents(summed)}, but the total reads ${formatCents(totalCents)}.`,
      });
    }
  }

  if (issues.length === 0) return OK;

  const flagged = Array.from(new Set(issues.flatMap((issue) => issue.fields)));
  return { ok: false, issues, flagged };
}

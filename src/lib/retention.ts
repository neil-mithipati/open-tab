// How long a receipt photograph is kept after its parse.
//
// The image exists to be read once by a model. After that the line items are
// rows in `receipt_items`, the totals are columns on `receipts`, and the only
// thing left that reads the pixels is a thumbnail nobody needs a month later.
// What is left is a growing pile of card last-fours and cardholder names with
// no remaining product purpose — which is the definition of data that should
// not still be there.
//
// Seven days is the default because it covers the two reasons a photo is
// genuinely wanted after the parse: the payer checking a line the model read
// wrong, and a claimer disputing an item while the tab is still being settled.
// Both happen in the days after a meal, not the months.

export const DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS = 7;

// Deliberately bounded on both sides. Zero or negative would delete images the
// job's own users are still looking at, and a value large enough to be a typo
// (a year expressed in days, say) quietly turns retention off — so both are
// refused in favour of the default rather than honoured.
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * N, from RECEIPT_IMAGE_RETENTION_DAYS, falling back to 7.
 *
 * Fails SAFE rather than open, and the two directions are different here.
 * A rate limiter failing open leaves a limiter inert; a retention job failing
 * open leaves PII on disk forever, which is worse and quieter. So anything
 * unparseable falls back to the default — a job that keeps deleting on the
 * documented schedule — instead of to "no deletion". Every rejected value is
 * logged with what it was, because a silent fallback is how a deliberate
 * override gets ignored for a month without anyone noticing.
 */
export function receiptImageRetentionDays(
  raw: string | undefined = process.env.RECEIPT_IMAGE_RETENTION_DAYS
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    console.error(
      `[retention] RECEIPT_IMAGE_RETENTION_DAYS=${JSON.stringify(raw)} is not a whole number — using the default of ${DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS} days`
    );
    return DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS;
  }
  if (parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) {
    console.error(
      `[retention] RECEIPT_IMAGE_RETENTION_DAYS=${parsed} is outside ${MIN_RETENTION_DAYS}–${MAX_RETENTION_DAYS} — using the default of ${DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS} days`
    );
    return DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS;
  }

  return parsed;
}

/**
 * The instant a photo has to be older than to be deleted. Everything at or
 * after this is kept.
 */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

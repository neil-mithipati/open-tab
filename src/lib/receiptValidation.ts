/**
 * Parses a quantity string. Returns 1 if the value is missing, zero, or non-positive.
 * Only the integer part is used — any decimal portion is ignored.
 */
export function parseQuantity(raw: string): number {
  // Take only what's before the first decimal point, then strip non-digits
  const intPart = raw.split(".")[0].replace(/\D/g, "");
  if (!intPart) return 1;
  const n = parseInt(intPart, 10);
  return isNaN(n) || n <= 0 ? 1 : n;
}

/**
 * Parses a monetary amount string. Returns 0 if the value is missing, negative, or non-numeric.
 * Digits after a second decimal point are discarded. Result is rounded to 2 decimal places.
 */
export function parseAmount(raw: string): number {
  const noInvalid = raw.replace(/[^\d.]/g, "");
  // Keep only the first decimal point and its following digits
  const parts = noInvalid.split(".");
  const cleaned = parts.length > 1 ? `${parts[0]}.${parts[1]}` : parts[0];
  if (!cleaned || cleaned === ".") return 0;
  const n = parseFloat(cleaned);
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

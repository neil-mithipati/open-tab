// Recovers the storage path (e.g. "userId/receiptId.jpg") from a signed
// Supabase storage URL for the receipt-images bucket. Returns null if the
// URL is missing or doesn't match the expected shape.
export function extractStoragePath(url: string | null): string | null {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const marker = "/receipt-images/";
    const idx = pathname.indexOf(marker);
    return idx === -1 ? null : pathname.slice(idx + marker.length);
  } catch {
    return null;
  }
}

// How long a signed URL for a receipt photo stays valid.
//
// A signed URL is a bearer capability: whoever holds the string gets the image,
// with no session and no policy check. That is the point of it, and it is also
// the whole risk — once one escapes into a log line, a Referer header, a
// screenshot of a devtools panel or a pasted link, the only thing between it
// and the card number on that check is the clock. So this number is the blast
// radius of a leak, and it is the shortest value the flows can actually live
// with.
//
// 15 minutes, because that is what the capture flow needs end to end: the user
// photographs the check, waits for the parse, then assigns items to people
// while the preview thumbnail sits beside them. Anything near a minute would
// break a normal split session. The value this replaces was an hour, and the
// server-side one was two.
//
// It does not need to cover a long-lived page, and this is why: nothing in the
// app treats a signed URL as durable state. `receipts.image_url` is read only
// for the storage path inside it (see extractStoragePath below), never
// followed, so the signature on the stored copy is free to be dead — and the
// server re-signs on every render of a receipt page. A stale URL is therefore
// always one navigation away from a fresh one.
export const RECEIPT_IMAGE_URL_TTL_SECONDS = 900;

// The parse route signs a URL and immediately fetches it from the same process,
// server to server. Nothing holds it, nothing renders it, and it is spent
// before the response is written — so it gets a minute rather than the display
// TTL. This is the one path where the URL is a plain implementation detail of
// "download my own object", and it should live exactly that long.
export const RECEIPT_IMAGE_FETCH_TTL_SECONDS = 60;

// The longest a signed URL may be reused out of the server cache.
//
// getReceiptImageUrl caches, and the reason is in its own comment: signing
// afresh on every render makes the URL unique each time, which defeats the
// image optimizer and re-downloads the photo on every paint. Caching means a
// URL minted once is handed out again later, so the cache window is subtracted
// from the TTL — the worst case is a URL served at the last instant before it
// falls out of the cache, with (TTL - window) of validity left.
//
// Holding the window to a third of the TTL leaves at least ten minutes on the
// oldest URL this app can hand anyone, which is far more than a page needs to
// finish loading an image. imageUrlCacheFitsInsideTtl is that invariant, and
// the test suite asserts it — so shortening the TTL without shortening the
// window fails the build rather than shipping already-expired URLs to users.
export const RECEIPT_IMAGE_CACHE_EXPIRE_SECONDS = 300;

// True when a URL served at the very end of its cache window still has real
// life left rather than a hairline. Exported so a test can hold the two
// constants above to each other.
export function imageUrlCacheFitsInsideTtl(
  ttlSeconds: number = RECEIPT_IMAGE_URL_TTL_SECONDS,
  cacheExpireSeconds: number = RECEIPT_IMAGE_CACHE_EXPIRE_SECONDS
): boolean {
  return cacheExpireSeconds * 3 <= ttlSeconds;
}

// Recovers the storage path (e.g. "userId/receiptId.jpg") from a signed
// Supabase storage URL for the receipt-images bucket. Returns null if the
// URL is missing or doesn't match the expected shape.
//
// Callers use this rather than following the stored URL, which is what lets the
// signature on `receipts.image_url` expire harmlessly: the column is a pointer
// to an object, and the live capability is minted fresh from that path each
// time one is actually needed.
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

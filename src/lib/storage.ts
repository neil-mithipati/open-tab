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
//
// NOT EXPORTED, deliberately. The raw path is attacker-controlled — see
// boundStoragePath below — and every consumer outside this module must take
// the bound form instead. Un-exporting is the cheap half of that rule; the
// other half is the source sweep in __tests__/lib/boundStoragePath.test.ts,
// which fails the build if this ever grows an `export` again or if any file
// outside this one calls it.
function extractStoragePath(url: string | null): string | null {
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

// The receipt columns needed to decide which object a row is allowed to name.
// `created_by` is the load-bearing one and is not optional: without it there is
// nothing to bind the path to.
export interface StoredReceiptImage {
  id: string;
  created_by: string | null;
  image_url: string | null;
}

// The storage path of a receipt's own photograph, or null.
//
// `receipts.image_url` is a user-writable column. `receipts_all_creator` is
// `for all using (auth.uid() = created_by)`, so any authenticated user can put
// an arbitrary string in the image_url of a receipt they own, straight from the
// browser — CaptureStep does exactly that on the happy path. The value is
// therefore attacker-controlled text, and extractStoragePath alone will happily
// recover another account's path out of it: it returns whatever follows the
// first `/receipt-images/`.
//
// That matters because every server-side reader signs with the service client,
// which bypasses RLS by design. Storage policies (0026) do not sit in that
// path, so the only thing that can refuse a foreign path is this function.
// The concrete attack it closes: a share link hands an anonymous claimer the
// victim's receipt id and the owner's venmo username, find_profile_by_venmo_
// username turns that username into the owner's user id, and objects are named
// `<user id>/<receipt id>.<ext>` — so an attacker can name the victim's object
// exactly, plant it in their OWN receipt's image_url, and open their own
// receipt page to have it signed for them. The same unbound path in the purge
// job deletes the victim's object on a schedule.
//
// Binding is `<created_by>/<id>.<ext>`, which is the convention CaptureStep
// writes and 0026's policies enforce. Both halves come from the stored row
// rather than from the request: an alternate uuid spelling (uppercase, braces)
// would resolve the same row through Postgres but must not be able to widen
// what this accepts.
//
// Compared segment by segment rather than through a RegExp built by
// interpolation — a pattern assembled from column values is one bad column
// away from being a pattern the attacker wrote. The shape accepted is exactly
// `^<created_by>/<id>\.[A-Za-z0-9]+$`.
//
// Fails CLOSED: anything that does not match returns null, and every caller
// treats null as "no image" rather than falling back to the raw path. Nothing
// about the answer distinguishes "that object belongs to someone else" from
// "there is no image", because the caller never touches storage in either case
// — so it cannot be used to probe whether another account's object exists.
export function boundStoragePath(receipt: StoredReceiptImage): string | null {
  const path = extractStoragePath(receipt.image_url);
  if (!path) return null;
  if (!receipt.created_by || !receipt.id) return null;

  const slash = path.indexOf("/");
  if (slash === -1) return null;
  if (path.slice(0, slash) !== receipt.created_by) return null;

  const rest = path.slice(slash + 1);
  const dot = rest.indexOf(".");
  if (dot === -1) return null;
  if (rest.slice(0, dot) !== receipt.id) return null;

  const ext = rest.slice(dot + 1);
  return /^[A-Za-z0-9]+$/.test(ext) ? path : null;
}

-- A receipt gets one Gemini parse. Until now the only evidence that the parse
-- had happened was the parsed data itself (merchant_name, totals, line items),
-- which the parse route reads to refuse a replay. That evidence only exists
-- when the parse SUCCEEDED. A parse that produced nothing — an all-nulls
-- result from a blank or unreadable image, the EMPTY fallback when Gemini's
-- reply fails JSON.parse, or a thrown error returning 500 — left the row
-- indistinguishable from a fresh one, so one upload bought unbounded paid
-- inference by replaying the same receiptId.
--
-- parsed_at records that the receipt's one parse was CONSUMED, and the route
-- writes it before calling the model, so it marks attempts rather than
-- successes. That is the whole point: the hole was exactly the paths that
-- produce no success.
--
-- Chosen over a parse_count integer: the value this route needs is a
-- claim, not a tally. `parsed_at is null` is a predicate a single conditional
-- update can filter on, which turns claiming into one atomic
-- compare-and-set — the same statement both takes the parse and tells a
-- concurrent request it lost. A counter would need the same guard
-- (`parse_count = 0`) and carry a number that can only ever be 0 or 1, while a
-- timestamp also answers "when" for support and debugging.
--
-- Additive only: no table, column, or row is dropped, and no data is altered.
-- The column is nullable with no default, so every existing row backfills to
-- null. Rows parsed before this ships therefore read as unclaimed — that is
-- deliberate and safe, because the route keeps its original evidence check
-- (parsed data or line items present) alongside this one, and that check is
-- what still covers them.

alter table public.receipts
  add column if not exists parsed_at timestamptz;

-- The claim is a conditional update filtering on (id, created_by, parsed_at is
-- null). id is the primary key, so the lookup is already indexed; this partial
-- index keeps the unclaimed set cheap to scan for the same filter.
create index if not exists idx_receipts_unparsed
  on public.receipts (created_by)
  where parsed_at is null;

comment on column public.receipts.parsed_at is
  'When this receipt''s single Gemini parse was consumed. Written by the parse route BEFORE the model call, so it marks the attempt, not the result. Null means the parse has never been claimed.';

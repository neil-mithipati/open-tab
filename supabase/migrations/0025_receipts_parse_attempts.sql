-- A bounded retry for a receipt whose parse failed for a reason that had
-- nothing to do with the receipt.
--
-- 0020 gave a receipt exactly one parse, claimed before the model call. That
-- ordering is not renegotiated here and must not be: marking after the fact is
-- what let one upload buy unbounded paid inference by replaying a receiptId.
-- The cost of it is that a Gemini 5xx, a dropped connection or a timeout —
-- none of which the user caused — spends the receipt's only parse, and the
-- only remedy is re-uploading the photo, which costs another of the 15 hourly
-- slots.
--
-- ── this contradicts 0020's header, deliberately, and here is why ───────────
--
-- 0020 chose a claim over a tally, and rejected a parse_count on two grounds:
-- that the value the route needs is a predicate a single conditional update
-- can filter on, and that the number could only ever be 0 or 1. The first
-- ground still holds and is preserved below. The second is what changes: the
-- number can now be 0, 1, 2 or 3, because a receipt is allowed up to three
-- model attempts and the count of attempts already spent is the only thing
-- that can bound them.
--
-- So this is a tally ALONGSIDE the claim, not instead of it. parsed_at keeps
-- its exact 0020 meaning — "this receipt's parse is claimed right now" — and
-- stays the compare-and-set that resolves N concurrent requests to one winner.
-- parse_attempts is monotonic: the claim increments it and nothing decrements
-- it, so it survives the release of a claim and is what makes the retry
-- bounded rather than infinite.
--
-- The claim is still one atomic statement. The route reads the row it already
-- has to read for ownership, then issues:
--
--   update receipts
--      set parsed_at = now(), last_parse_attempt_at = now(),
--          parse_attempts = <n+1>
--    where id = ? and created_by = ?
--      and parsed_at is null and parse_attempts = <n>
--
-- Two filters, both compare-and-set: `parsed_at is null` still admits one
-- winner, and `parse_attempts = n` makes a lost update impossible even when
-- the claim has been released between the read and the write. A request whose
-- read is stale matches nothing rather than overwriting a count it never saw,
-- so the tally can never go backwards and the cap can never be exceeded by
-- interleaving. The route caps n at 3 before issuing this, and the check
-- constraint below is the floor under that if the route is ever wrong.
--
-- Only a failure the route classifies as transient — a provider 5xx, a network
-- fault, a timeout — releases the claim (sets parsed_at back to null, filtered
-- on the exact stamp the request itself wrote, so only the holder can release
-- it). A parse that SUCCEEDED and returned nothing useful — all nulls off a
-- blank photo, the EMPTY fallback when the reply fails JSON.parse — releases
-- nothing. That path is precisely the hole 0020 exists to cover and it stays
-- covered.
--
-- ── why the second column ───────────────────────────────────────────────────
--
-- Every attempt is a real paid model call, so every attempt has to cost one of
-- the caller's 15 hourly slots. src/lib/rateLimit.ts counts receipt ROWS
-- created in the last hour as a proxy for attempts, which was exact while a
-- receipt could only ever be attempted once. A retry adds an attempt without
-- adding a row, so that proxy would hand retries out for free.
--
-- last_parse_attempt_at is the clock the route needs to charge them. parsed_at
-- cannot serve: releasing a claim sets it back to null, which is the whole
-- point of it. So the claim writes both, and only the release nulls parsed_at.
-- The route then sums parse_attempts over the caller's receipts whose last
-- attempt falls inside the hour and refuses at 15, which bounds a caller to 15
-- model calls an hour however those calls are spread over receipts. A receipt
-- attempted before the window and again inside it counts its earlier attempts
-- too — over-counting by at most two, which is the direction a spend limiter
-- should fail.
--
-- ── the backfill, which is where the last two migrations to add a column got
-- ── into trouble
--
-- Added bare, then defaulted, in two statements — the same shape 0021 used and
-- for the same reason. `add column ... default 0` would write 0 into every
-- existing row, and `default now()` on the timestamp would write now() into
-- every existing row: every receipt in the account would then read as attempted
-- inside the current hour, and the sum above would refuse every parse for an
-- hour the moment this ships. Adding both bare leaves existing rows null;
-- setting the default afterwards applies only to rows inserted from here on.
-- Nothing is written to existing data.
--
-- Null therefore means "created before this shipped". Such a row reads as zero
-- attempts spent to the claim, so it still gets its full three; it can carry no
-- last_parse_attempt_at, so it never appears in the hourly sum, which
-- under-counts a hypothetical pre-0025 attempt by one and cannot lock anyone
-- out. Its single pre-0025 parse, if it had one, is still refused by parsed_at
-- and by the parsed-data evidence 0020 kept.
--
-- Additive only. No table, column, index or row is dropped. No existing row is
-- rewritten, and the check constraint below is satisfied by null.
--
-- DEPLOYMENT ORDER, same as 0020's: apply this BEFORE deploying the code that
-- reads it. The route selects both columns on the ownership read and its claim
-- writes both, and a claim that errors fails closed — 503 parse_unavailable,
-- no model call — so scanning is down until this is applied. It is backward
-- compatible with the currently deployed code, which never mentions either
-- column.

alter table public.receipts
  add column if not exists parse_attempts smallint;

alter table public.receipts
  alter column parse_attempts set default 0;

alter table public.receipts
  add column if not exists last_parse_attempt_at timestamptz;

-- The floor under the route's cap. The route refuses a fourth attempt before it
-- issues the claim; this makes a fourth unwritable even if that check is ever
-- wrong, and a violated constraint surfaces as a claim error, which the route
-- already fails CLOSED on. Null passes, so no existing row is affected. The 3
-- here and MAX_PARSE_ATTEMPTS in src/app/api/receipts/parse/route.ts are the
-- same number and have to move together.
do $$
begin
  alter table public.receipts
    add constraint receipts_parse_attempts_max
    check (parse_attempts is null or (parse_attempts >= 0 and parse_attempts <= 3));
exception
  when duplicate_object then null;
end $$;

comment on column public.receipts.parse_attempts is
  'How many Gemini parse attempts this receipt has spent. Incremented by the parse route in the same statement that claims parsed_at, never decremented — releasing a claim after a transient provider failure leaves this untouched, which is what bounds the retry at 3. Null means the row predates migration 0025: read as 0 spent attempts.';

comment on column public.receipts.last_parse_attempt_at is
  'When this receipt''s most recent Gemini parse attempt was claimed. Unlike parsed_at it is never cleared, so it survives the release of a claim after a transient provider failure and gives the parse route an hourly window to charge retries against. Null means the receipt has never been attempted, or predates migration 0025.';

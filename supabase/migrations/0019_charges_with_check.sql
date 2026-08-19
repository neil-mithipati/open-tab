-- charges: an explicit `with check`, so a row can only be created on a receipt
-- the caller owns.
--
-- 0008 wrote the creator policy with a `using` clause and nothing else:
--
--   create policy "charges_all_creator" on public.charges
--     for all using (auth.uid() = from_user_id);
--
-- When no `with check` is supplied, Postgres reuses the `using` expression as
-- the INSERT check. That predicate says the row carries the caller's own id
-- and says nothing about which receipt it lands on — so any signed-in user
-- could POST a charge row with `from_user_id` = themselves onto a tab somebody
-- else created, and the owner would see it on their receipt.
--
-- The app's own two writers were never the problem. `save_receipt_state`
-- (0016) stamps the owner it looked up, and `closeClaiming` in claim.ts stamps
-- `receipt.created_by`; the gap was only reachable by issuing requests
-- straight at PostgREST with a user token.
--
-- The new check mirrors the ownership predicate 0016 already enforces
-- (`auth.uid() = receipts.created_by`), reusing the security definer helper
-- 0009 added for exactly this question — it reads `receipts` without going
-- back through that table's own policies, the same way
-- `receipt_participants_access` asks it. `auth.uid() = from_user_id` is kept
-- alongside, so the check is strictly narrower than what shipped: a receipt
-- owner still cannot file a charge under someone else's id.
--
-- The read path is untouched. The `using` expression is re-stated verbatim —
-- it governs SELECT, UPDATE and DELETE for this policy — and
-- `charges_select_participant` (0008) is left alone. Owners still read the
-- charges they issued; participants still read the charges addressed to them.
--
-- Neither writer actually goes through this policy, which is why nothing in
-- the app changes behaviour:
--
--   * `save_receipt_state` is `security definer`, so it runs as its owner.
--     That role owns `charges` and the table is not `force row level
--     security`, so RLS is not applied inside the function at all. Its own
--     `v_owner <> auth.uid()` check is what protects it, and that check is
--     the predicate this policy now copies.
--   * `closeClaiming` uses the service-role client, which bypasses RLS
--     outright.
--
-- So this policy is the floor under direct requests, not the path the app
-- takes.
--
-- One thing to know: `with check` governs UPDATE as well as INSERT, applied to
-- the row as it will be. For a correctly filed charge that changes nothing —
-- the issuer is the receipt's owner, so both halves hold — and nothing in the
-- app updates `charges` with a user token today (claim.ts and deleteAccount.ts
-- both go through the service-role client, which bypasses RLS; ChargeList's
-- "mark paid" uses the browser client but the component is not rendered from
-- any page). What it does newly reject is a legacy misfiled row being updated
-- by the non-owner whose id it carries — the same state this migration exists
-- to stop being created.
--
-- Additive: no table, column or row is touched, and no data is rewritten. The
-- policy is replaced in place under the same name with the same `using`
-- clause, following the shape 0009 and 0015 use for policy changes.

drop policy if exists "charges_all_creator" on public.charges;

create policy "charges_all_creator" on public.charges
  for all
  using (auth.uid() = from_user_id)
  with check (
    auth.uid() = from_user_id
    and public.receipt_creator_id(receipt_id) = auth.uid()
  );

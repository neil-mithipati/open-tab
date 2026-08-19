-- Add indexes on foreign-key columns. Every FK lookup was a sequential scan
-- (grep -c "create index" supabase/migrations/*.sql was zero before this),
-- including the receipt_participants scan on every dashboard load.
--
-- Additive and non-destructive: every statement is `create index if not
-- exists`. Safe to apply to live data.
--
-- A column is skipped here only when it is already the LEADING column of an
-- existing unique constraint/index, since Postgres can use that index's
-- leading-column prefix for an equality lookup on its own. Non-leading
-- columns of the same constraint still get an index below.
--
-- receipts (0002)
create index if not exists idx_receipts_created_by
  on public.receipts (created_by);

-- receipt_items (0003)
create index if not exists idx_receipt_items_receipt_id
  on public.receipt_items (receipt_id);

-- receipt_participants (0004)
-- receipt_id is skipped: 0016's unique index
-- receipt_participants_receipt_username_key (receipt_id, lower(venmo_username))
-- already leads with receipt_id.
create index if not exists idx_receipt_participants_user_id
  on public.receipt_participants (user_id);

-- item_assignments (0005)
-- receipt_item_id is skipped: it is the leading column of the table's own
-- unique (receipt_item_id, participant_id) constraint.
create index if not exists idx_item_assignments_participant_id
  on public.item_assignments (participant_id);

-- friendships (0006)
-- user_id is skipped: it is the leading column of the table's own
-- unique (user_id, friend_id) constraint.
create index if not exists idx_friendships_friend_id
  on public.friendships (friend_id);

-- charges (0007) — no unique constraints on this table, so all three FK
-- columns need an index.
create index if not exists idx_charges_receipt_id
  on public.charges (receipt_id);
create index if not exists idx_charges_from_user_id
  on public.charges (from_user_id);
create index if not exists idx_charges_to_participant_id
  on public.charges (to_participant_id);

-- external_contacts (0010)
-- user_id is skipped: it is the leading column of the table's own
-- unique (user_id, venmo_username) constraint.

-- friend_groups (0014)
-- user_id is skipped: it is the leading column of the table's own
-- unique (user_id, name) constraint.

-- friend_group_members (0014)
-- group_id is skipped: it is the leading column of the table's own
-- unique (group_id, venmo_username) constraint.

-- profiles.id (0001) references auth.users(id) but is itself the table's
-- primary key, already indexed by the PK constraint. No new index needed.

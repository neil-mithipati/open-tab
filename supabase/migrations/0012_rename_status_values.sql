-- Collapse the receipt status vocabulary to three values:
--   draft     → open
--   reviewing → open    (the separate review step is removed)
--   claiming  → shared
--   charging  → shared  (collection now happens within "shared"; the collect
--                        phase is detected by charges existing, not by status)
--   settled   → closed
--
-- New lifecycle:
--   manual:  open → closed
--   shared:  open → shared → closed   (closes when every charge is marked paid)

-- Drop the old default ('draft') and constraint before migrating data.
alter table receipts alter column status drop default;
alter table receipts drop constraint if exists receipts_status_check;

-- Migrate existing rows to the new vocabulary.
update receipts set status = 'open'   where status in ('draft', 'reviewing');
update receipts set status = 'shared' where status in ('claiming', 'charging');
update receipts set status = 'closed' where status = 'settled';

-- Re-add the constraint and default with the new values.
alter table receipts
  add constraint receipts_status_check
  check (status in ('open', 'shared', 'closed'));
alter table receipts alter column status set default 'open';

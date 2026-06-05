-- Shareable "crowd-claim" receipts: a payer shares a link, friends claim items
-- without logging in, then the payer closes claiming and collects via Venmo.

-- An unguessable token that gates public (no-auth) access to a receipt.
-- Null until the owner shares; mirrors profiles.invite_token.
alter table public.receipts
  add column share_token text unique;

-- Add the 'claiming' status: the link is live and friends are claiming items.
-- Lifecycle: draft → reviewing → claiming → charging → settled.
alter table public.receipts
  drop constraint if exists receipts_status_check;
alter table public.receipts
  add constraint receipts_status_check
  check (status in ('draft', 'reviewing', 'claiming', 'charging', 'settled'));

-- Per-claimer progress for the share flow.
-- joined_via_share marks participants who self-joined through the link
-- (vs. participants the owner added manually). claim_done_at null = still
-- claiming (in progress); set = they tapped "done".
alter table public.receipt_participants
  add column joined_via_share boolean not null default false,
  add column claim_done_at    timestamptz;

-- All share-flow reads and writes go through server actions using the service
-- client (bypasses RLS); the browser anon key never touches receipt data, so no
-- new RLS policies are required here.

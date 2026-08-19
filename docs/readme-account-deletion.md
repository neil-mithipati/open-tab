## Account deletion

_Source: ledger/OT-111.md, merged to main (attempt 2, `bcd75f7`)._

### Problem

Open Tab had no way for a user to delete their account. A privacy policy could
not honestly promise deletion while the capability didn't exist, and the
pre-launch review flagged this as a P0 blocker.

### Solution

A "Delete account" section sits at the bottom of the profile page. Deleting
requires typing the word "delete" into a confirmation modal — cancel is a true
no-op. On confirm:

- Receipt photos are removed from storage.
- The profile is deleted, cascading through everything the user owns: tabs
  they created (items, participants, assignments, charges), friendships in
  both directions, external contacts, and friend groups.
- The user's login is removed and they're signed out.
- Rows on tabs *other people* created are kept but unlinked: the account link
  is removed while both the display name and Venmo username stay on the row,
  so the tab owner's totals still reconcile.
- Charge rows on tabs other people created are re-pointed to that tab's owner
  rather than deleted, so the owner doesn't lose charges off their own tab.

Works the same way for anonymous/guest accounts — guests hold data too, and
the same action deletes it.

### Tradeoffs

| Decision | What was considered | What was chosen and why |
|---|---|---|
| Other users' participant rows | Delete outright, or anonymize | Anonymize: null the `user_id` link but keep `display_name` and `venmo_username` (both `NOT NULL` in the schema) so the tab owner's totals keep reconciling after the user is gone |
| Charge rows on receipts the user doesn't own | Delete them with the rest of the user's data | Re-point `from_user_id` to the receipt's owner before deleting the user's own charges — deleting them would have removed charge rows from *another user's* tab, since a non-owner participant can legitimately create a charge row on someone else's receipt |
| Ordering of the delete | Delete profile first, clean up storage after | Storage objects removed first, then the profile (whose cascades and explicit re-pointing satisfy two `NOT NULL` foreign keys — `receipt_participants.user_id` and `charges.from_user_id` — that have no `ON DELETE` action and would otherwise block the profile delete) |
| Confirmation UI | Simple confirm button | Typed confirmation ("delete") in a modal, consistent with the app's existing modal pattern, because this is irreversible |

### Learnings

The first attempt passed every acceptance criterion and every gate, and still
did not merge — the adversarial review pass found two HIGH findings sitting
exactly on the cross-user boundary the acceptance criteria didn't cover:

- A non-owner participant on someone else's tab could reach a full edit view
  and write a charge row stamped with their own id onto that tab. Deleting
  "your own" charge rows on account deletion would have silently deleted rows
  off another user's receipt. Cascades and ownership look similar but aren't:
  verifying "does this cascade correctly" is not the same question as "can
  this row have been planted by someone other than its apparent owner."
- The modal's copy claimed friends' tabs would keep "your name only." The
  anonymization logic actually retains the Venmo username too, and the copy's
  overstatement understated what a payment handle a) is, and b) does — a
  factual claim about data retention on the last screen before an irreversible
  action needs the same scrutiny as the code that implements it.

A related pre-existing gap surfaced during this work — the `charges` RLS
policy has no `WITH CHECK`, so any authenticated user can plant a charge row
on a receipt they don't own via a direct request (not through the app's own
UI). It didn't block this merge because deletion now re-points rather than
deletes such rows, but it's filed separately as OT-120.

| id | title | status | blocked reason |
|---|---|---|---|
| OT-100 | Make main lint-clean — fix pre-existing lint errors blocking the gate | Done | — |
| OT-101 | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production | Done | — |
| OT-102 | Parse route: derive image URL server-side, stop echoing error internals, set maxDuration | Done | — |
| OT-103 | RLS: stop publishing every profile; caller check on add_friendship | Done | — |
| OT-104 | Compress receipt photos client-side before upload; cap size and MIME server-side | Done | — |
| OT-105 | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint | Done | — |
| OT-106 | Allocate rounding remainders so charges sum to the total | Done | — |
| OT-107 | Rate-limit the parse route and share/claim actions | Todo | — |
| OT-108 | Add indexes on all foreign keys | Todo | — |
| OT-109 | Toast system: share/save errors surface, link-copied confirms | Todo | — |
| OT-110 | Privacy policy page | Todo | — |
| OT-111 | Account deletion — user-initiated, complete, confirmed | Todo | — |
| OT-112 | Document NEXT_PUBLIC_APP_URL in .env.example | Todo | — |
| OT-113 | ReceiptEditPage delete-then-reinsert → saveReceiptState | Todo | — |

## Backlog (unscheduled, no ledger task)

These have no corresponding file in `ledger/`. They were previously listed on
the board as OT-113/OT-114/OT-115 with task ids, which put the board ahead of
the ledger. Moved here until a task file exists.

- Friendship request/accept model — reverse friendship row is inserted without
  b's consent (spec-accepted for OT-103, revisit).
- Add drop-if-exists guard to `profiles_select_own` policy creation in
  migration 0015 — manual re-run currently errors (fails closed, not urgent).
- `find_profile_by_venmo_username` should reject empty/whitespace username on
  direct RPC call.

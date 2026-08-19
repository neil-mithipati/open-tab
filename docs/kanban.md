| id | title | status | blocked reason |
|---|---|---|---|
| OT-100 | Make main lint-clean — fix pre-existing lint errors blocking the gate | Done | — |
| OT-101 | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production | Done | — |
| OT-102 | Parse route: derive image URL server-side, stop echoing error internals, set maxDuration | Done | — |
| OT-103 | RLS: stop publishing every profile; caller check on add_friendship | Done | — |
| OT-104 | Compress receipt photos client-side before upload; cap size and MIME server-side | Done | — |
| OT-105 | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint | Done | — |
| OT-106 | Allocate rounding remainders so charges sum to the total | Done | — |
| OT-107 | Rate-limit the parse route and share/claim actions | Blocked | dispatch-blocked (infrastructure, not this task): `.claude/hooks/parallel-cap.sh` denies every builder dispatch. `.claude/state/events.jsonl` holds two orphaned `SubagentStart` records at 2026-08-19T12:26:57Z from the OT-107 builder that died without emitting `SubagentStop`, so the hook computes 2 running against `MAX_PARALLEL=2`. Nothing is actually running. Fix is two reconciling `SubagentStop` lines appended to `events.jsonl`; the orchestrator was denied write access to that file by the sandbox classifier and must not route around it. Owner action required. |
| OT-108 | Add indexes on all foreign keys | Blocked | same dispatch-blocked cause as OT-107 (see that row) |
| OT-109 | Toast system: share/save errors surface, link-copied confirms | Blocked | same dispatch-blocked cause as OT-107 (see that row) |
| OT-110 | Privacy policy page | Blocked | same dispatch-blocked cause as OT-107 (see that row) |
| OT-111 | Account deletion — user-initiated, complete, confirmed | Blocked | same dispatch-blocked cause as OT-107 (see that row) |
| OT-112 | Document NEXT_PUBLIC_APP_URL in .env.example | Blocked | same dispatch-blocked cause as OT-107 (see that row) |
| OT-113 | ReceiptEditPage delete-then-reinsert → saveReceiptState | Blocked | same dispatch-blocked cause as OT-107 (see that row) |

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

| id | title | status | blocked reason |
|---|---|---|---|
| OT-100 | Make main lint-clean — fix pre-existing lint errors blocking the gate | Done | — |
| OT-101 | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production | Done | — |
| OT-102 | Parse route: derive image URL server-side, stop echoing error internals, set maxDuration | Done | — |
| OT-103 | RLS: stop publishing every profile; caller check on add_friendship | Done | — |
| OT-104 | Compress receipt photos client-side before upload; cap size and MIME server-side | Done | — |
| OT-105 | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint | Done | — |
| OT-106 | Allocate rounding remainders so charges sum to the total | Done | — |
| OT-107 | Rate-limit the parse route and share/claim actions | Blocked | review complete and it BLOCKS on one high finding — claim-identity takeover at src/app/actions/claim.ts:151. pass 1 is fully green (all 5 criteria, both carried-over fix sets landed, gates verified independently: lint clean, 201/201 tests, typecheck showing only the two known main failures, scope confined to the 8 declared files). the builder's escalated judgment call 2 was answered NO — its reasoning was factually wrong. remedy is one line in a file already in scope. cannot dispatch attempt 3: builder dispatch is denied by the OT-114 counter drift (count 3 >= MAX_PARALLEL=2). needs the OT-114 deadlock broken, then attempt 3 is a ~2-line fix. do NOT merge 189173e as-is. |
| OT-115 | Rate-limit hardening — fail-open silence, off-by-one parse ceiling, 429 has no UI | Blocked | not yet dispatched. builder dispatch is denied by the OT-114 parallel-cap counter drift (count 3 >= MAX_PARALLEL=2). also depends on OT-107 merging first — it edits the same three files, so dispatching both at once would conflict. sequence after OT-114: OT-107 attempt 3, merge, then this. |
| OT-108 | Add indexes on all foreign keys | Blocked | blocked on OT-114 only. the spend-cap reason previously recorded here is stale: the lane cap is now $20.00 and measured spend reset to ~$0.20, so budget does not block anything. the live blocker is the parallel-cap counter reading 3 (>= MAX_PARALLEL=2), which denies every builder dispatch. verified 2026-08-19T14:25Z by attempting a real builder-light dispatch, refused with "3 builder(s) already running — MAX_PARALLEL=2". no builders are actually running; the count is drift. needs OT-114 applied. |
| OT-109 | Toast system: share/save errors surface, link-copied confirms | Blocked | same dispatch-blocked cause as OT-108 (see that row) |
| OT-110 | Privacy policy page | Blocked | same dispatch-blocked cause as OT-108 (see that row) |
| OT-111 | Account deletion — user-initiated, complete, confirmed | Blocked | same dispatch-blocked cause as OT-108 (see that row) |
| OT-112 | Document NEXT_PUBLIC_APP_URL in .env.example | Blocked | same dispatch-blocked cause as OT-108 (see that row) |
| OT-113 | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState | Blocked | same dispatch-blocked cause as OT-108 (see that row) |
| OT-114 | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring | Blocked | deadlocked; one owner action breaks it. the previous reason was wrong on the key point: .claude/settings.json and .claude/hooks/parallel-cap.sh are both WRITABLE by an agent — verified by write probe 2026-08-19T14:25Z. only .claude/state/ is classifier-blocked, and acceptance criterion 5 already forbids this task from touching it. so the fix is dispatchable as specced. the real blocker is circular: this task is tiered `builder`, and builder dispatch is exactly what the counter bug denies (count 3 >= MAX_PARALLEL=2). break the loop with a one-time relaunch at a raised cap (`MAX_PARALLEL=8 ./bin/lane open-tab`), then dispatch this normally. |

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

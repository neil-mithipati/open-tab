| id | title | status | blocked reason |
|---|---|---|---|
| OT-100 | Make main lint-clean — fix pre-existing lint errors blocking the gate | Done | — |
| OT-101 | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production | Done | — |
| OT-102 | Parse route: derive image URL server-side, stop echoing error internals, set maxDuration | Done | — |
| OT-103 | RLS: stop publishing every profile; caller check on add_friendship | Done | — |
| OT-104 | Compress receipt photos client-side before upload; cap size and MIME server-side | Done | — |
| OT-105 | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint | Done | — |
| OT-106 | Allocate rounding remainders so charges sum to the total | Done | — |
| OT-107 | Rate-limit the parse route and share/claim actions | In Progress | — (attempt 3 is live; a builder is running on it now) |
| OT-108 | Add indexes on all foreign keys | Blocked | work is COMPLETE and committed (93d55ec): migration 0018 written, all four acceptance criteria met, lint clean, tests 187/187. blocked only on the required `typecheck` gate, red on main from two pre-existing test-file errors outside this task's scope. OT-116 fixes exactly those. sequence: merge OT-116, merge main into this branch, re-run gates, review, merge. |
| OT-109 | Toast system: share/save errors surface, link-copied confirms | Blocked | blocked on OT-114 merging. the parallel cap denies all builder dispatch: net count 8 >= MAX_PARALLEL=8. this is now VERIFIED by an actual denial this session (OT-112 attempt 2 was refused with "9 builder(s) already running"), not projected from reading the hook as the earlier false blockers were. only 1 of the 8 is a real builder (OT-107 attempt 3); the rest are stale records from two prematurely-terminated builder-lights that emitted no stop event. no dependency on any other task; dispatchable the moment the cap clears. |
| OT-110 | Privacy policy page | Blocked | blocked on OT-111 only, and that dependency is real: section 5 of this policy states users can delete their account, and publishing that claim before the capability exists would be false. |
| OT-111 | Account deletion — user-initiated, complete, confirmed | Blocked | blocked on OT-114 merging. the parallel cap denies all builder dispatch: net count 8 >= MAX_PARALLEL=8. this is now VERIFIED by an actual denial this session (OT-112 attempt 2 was refused with "9 builder(s) already running"), not projected from reading the hook as the earlier false blockers were. only 1 of the 8 is a real builder (OT-107 attempt 3); the rest are stale records from two prematurely-terminated builder-lights that emitted no stop event. no dependency on any other task; dispatchable the moment the cap clears. |
| OT-112 | Document NEXT_PUBLIC_APP_URL in .env.example | Blocked | attempt 2 dispatch was DENIED by the parallel cap — "9 builder(s) already running - MAX_PARALLEL=8". this is the OT-114 counter drift, and this time it is genuinely binding, not a stale projection. only 2 builders are actually running; 5 of the 9 are stale records. blocked on OT-114 merging, which makes the count self-healing. the partial work in ../wt-OT-112 is intact and safe to build on. attempts stays 1: no attempt 2 ever ran. |
| OT-113 | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState | Blocked | blocked on OT-114 merging. the parallel cap denies all builder dispatch: net count 8 >= MAX_PARALLEL=8. this is now VERIFIED by an actual denial this session (OT-112 attempt 2 was refused with "9 builder(s) already running"), not projected from reading the hook as the earlier false blockers were. only 1 of the 8 is a real builder (OT-107 attempt 3); the rest are stale records from two prematurely-terminated builder-lights that emitted no stop event. no dependency on any other task; dispatchable the moment the cap clears. |
| OT-114 | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring | Blocked | work is COMPLETE and committed (af67ef3): both fixes landed, lint clean, tests 187/187. blocked only on the required `typecheck` gate, which is red on main from two pre-existing errors in test files outside this task's scope. OT-116 fixes exactly those. sequence: merge OT-116, merge main into this branch, re-run gates, review, merge. do not mark done until typecheck is green. |
| OT-115 | Rate-limit hardening — fail-open silence, off-by-one parse ceiling, 429 has no UI | Blocked | blocked on OT-107 only, and that dependency is real: this task edits the same three files OT-107 is rewriting (src/lib/rateLimit.ts, CaptureStep.tsx, api/receipts/parse/route.ts), so dispatching both at once would conflict. sequence: OT-107 lands and merges, then this. |
| OT-116 | Make main typecheck-clean — two pre-existing errors block the required gate for every task | In Progress | — (new card this batch; in review, two errors in test files: src/__tests__/setup.ts and src/__tests__/components/ReceiptSplitStep.test.tsx) |

## Sync notes (2026-08-19, this batch)

**New card.** OT-116 did not exist on the board before this batch. `typecheck`
is a required gate, and main was red on it — every other task's definition of
done was blocked by two errors in test files, neither in any task's own scope.
OT-116 is that fix, currently in-progress/in review.

**Moved to blocked, work already complete.** OT-108 and OT-114 both finished
their actual work and committed it (93d55ec, af67ef3) — all acceptance
criteria met, lint clean, tests green. Both are blocked on nothing but the
required typecheck gate, which OT-116 fixes. Once OT-116 merges and each
branch picks up main, both should clear straight to review/merge with no
further building.

**Moved to blocked, no work done.** OT-112's attempt 2 was denied outright by
the parallel cap before any builder started — attempts stays at 1, the
partial work already in `../wt-OT-112` is untouched and safe to resume.
OT-109, OT-111, and OT-113 move from todo to blocked on the same cap.

**Still running.** OT-107 stays in-progress: attempt 3 is live, a builder is
actually working on it right now.

**The two blocker types on this board are not the same thing, and the board
should not flatten them.** Earlier this session, five cards were recorded as
blocked on the OT-114 counter as a *projection* — inferred by reading the
hook's logic, never tested against a real dispatch. That inference turned out
to be wrong; the cap wasn't binding and those five were cleared. The five
cards now blocked on the cap (OT-109, OT-111, OT-112, OT-113, and OT-114's own
gate wait) are blocked on an *observed* denial: a real dispatch attempt came
back with "9 builder(s) already running — MAX_PARALLEL=8." That is a
materially different kind of evidence and this note exists so the difference
doesn't get lost the next time someone reads this file.

**What's actually jamming the cap.** Of the 8 slots counted as full, only 1
holds a real builder (OT-107, attempt 3). The other slots are held by two
builder-lights that terminated prematurely and never emitted a stop event, so
their slots never freed. The critical path to unjam the whole backlog: merge
OT-116 → OT-114's typecheck gate goes green → OT-114 merges → the counter
drift fix lands and the count becomes self-healing. Nothing else in the
backlog moves until that chain runs.

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

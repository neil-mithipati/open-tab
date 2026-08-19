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
| OT-108 | Add indexes on all foreign keys | Blocked | BLOCKER CLEARED — awaiting review + merge, not blocked on any code. work is complete and committed (93d55ec): migration 0018 written, all four acceptance criteria met, lint clean, tests 187/187. the only blocker was the required `typecheck` gate being red on main; OT-116 fixed exactly that and merged at 8d6c09d, and `npm run typecheck` on main now passes clean (verified this session). remaining sequence: merge main into this branch, re-run gates, review, merge. adds a migration under supabase/, so review: full is mandatory and must not be skipped. |
| OT-109 | Toast system: share/save errors surface, link-copied confirms | Blocked | blocked on OT-114 merging. VERIFIED this session by direct measurement, not projected from reading the hook: the parallel-cap counter reads net=6, but ZERO builders are actually running. root cause confirmed — in .claude/settings.json, SubagentStart is logged TWICE (a wildcard `matcher: "*"` log-event hook PLUS the per-type `^builder$` matcher) while SubagentStop is logged ONCE (per-type only), so every builder start drifts the count +1. evidence: every SubagentStart in .claude/state/events.jsonl appears 2x and every SubagentStop 1x; deduplicated, the real figures are starts=7 stops=8 net=-1. the earlier claim in this field that "only 1 of the 8 is a real builder (OT-107 attempt 3)" was wrong — none are. OT-114's committed fix (af67ef3) removes the duplicate hook and re-derives the count by pairing start to stop on agent_id with a staleness cutoff. no dependency on any other task; dispatchable the moment OT-114 merges. |
| OT-110 | Privacy policy page | Blocked | blocked on OT-111 only, and that dependency is real: section 5 of this policy states users can delete their account, and publishing that claim before the capability exists would be false. see ## Sequencing in the body. the OT-114 half of the previous reason was wrong and is retracted below. |
| OT-111 | Account deletion — user-initiated, complete, confirmed | Blocked | blocked on OT-114 merging. VERIFIED this session by direct measurement, not projected from reading the hook: the parallel-cap counter reads net=6, but ZERO builders are actually running. root cause confirmed — in .claude/settings.json, SubagentStart is logged TWICE (a wildcard `matcher: "*"` log-event hook PLUS the per-type `^builder$` matcher) while SubagentStop is logged ONCE (per-type only), so every builder start drifts the count +1. evidence: every SubagentStart in .claude/state/events.jsonl appears 2x and every SubagentStop 1x; deduplicated, the real figures are starts=7 stops=8 net=-1. the earlier claim in this field that "only 1 of the 8 is a real builder (OT-107 attempt 3)" was wrong — none are. OT-114's committed fix (af67ef3) removes the duplicate hook and re-derives the count by pairing start to stop on agent_id with a staleness cutoff. no dependency on any other task; dispatchable the moment OT-114 merges. |
| OT-112 | Document NEXT_PUBLIC_APP_URL in .env.example | Blocked | blocked on OT-114 merging. VERIFIED this session by direct measurement, not projected from reading the hook: the parallel-cap counter reads net=6, but ZERO builders are actually running. root cause confirmed — in .claude/settings.json, SubagentStart is logged TWICE (a wildcard `matcher: "*"` log-event hook PLUS the per-type `^builder$` matcher) while SubagentStop is logged ONCE (per-type only), so every builder start drifts the count +1. evidence: every SubagentStart in .claude/state/events.jsonl appears 2x and every SubagentStop 1x; deduplicated, the real figures are starts=7 stops=8 net=-1. the earlier claim in this field that "only 1 of the 8 is a real builder (OT-107 attempt 3)" was wrong — none are. OT-114's committed fix (af67ef3) removes the duplicate hook and re-derives the count by pairing start to stop on agent_id with a staleness cutoff. no dependency on any other task; dispatchable the moment OT-114 merges. the partial work in ../wt-OT-112 is intact and safe to build on. attempts stays 1: no attempt 2 ever ran. |
| OT-113 | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState | Blocked | blocked on OT-114 merging. VERIFIED this session by direct measurement, not projected from reading the hook: the parallel-cap counter reads net=6, but ZERO builders are actually running. root cause confirmed — in .claude/settings.json, SubagentStart is logged TWICE (a wildcard `matcher: "*"` log-event hook PLUS the per-type `^builder$` matcher) while SubagentStop is logged ONCE (per-type only), so every builder start drifts the count +1. evidence: every SubagentStart in .claude/state/events.jsonl appears 2x and every SubagentStop 1x; deduplicated, the real figures are starts=7 stops=8 net=-1. the earlier claim in this field that "only 1 of the 8 is a real builder (OT-107 attempt 3)" was wrong — none are. OT-114's committed fix (af67ef3) removes the duplicate hook and re-derives the count by pairing start to stop on agent_id with a staleness cutoff. no dependency on any other task; dispatchable the moment OT-114 merges. |
| OT-114 | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring | Blocked | BLOCKER CLEARED — awaiting review + merge, not blocked on any code. work is complete and committed (af67ef3): both fixes landed, lint clean, tests 187/187. the only blocker was the required `typecheck` gate being red on main; OT-116 fixed exactly that and merged at 8d6c09d, and `npm run typecheck` on main now passes clean (verified this session). remaining sequence: merge main into this branch, re-run gates, review, merge. this is the keystone task — the parallel-cap drift it fixes is what four other tasks (OT-109, OT-111, OT-112, OT-113) are waiting on. touches .claude/, so review: full is mandatory and must not be skipped. |
| OT-115 | Rate-limit hardening — fail-open silence, off-by-one parse ceiling, 429 has no UI | Blocked | blocked on OT-107 only, and that dependency is real: this task edits the same three files OT-107 is rewriting (src/lib/rateLimit.ts, CaptureStep.tsx, api/receipts/parse/route.ts), so dispatching both at once would conflict. sequence: OT-107 lands and merges, then this. the OT-114 half of the previous reason was wrong and is retracted below. |
| OT-116 | Make main typecheck-clean — two pre-existing errors block the required gate for every task | Done | — |

## Sync notes (2026-08-19, correction batch)

**OT-116 moved to Done.** Ledger state is `done` — reviewed (passed), all three
required gates green, merged at 8d6c09d, worktree and branch removed. The prior
sync ran while the reviewer was still in progress and left the card at In
Progress; this corrects it. No other card changed. OT-107 stays In Progress —
its reviewer is still running, per the ledger.

## Sync notes (2026-08-19, this batch)

**Corrected blocked reasons — OT-109, OT-111, OT-112, OT-113.** All four
previously read "8 builders running, only 1 real." That was wrong. Corrected
ledger text (verified this session by direct measurement): the counter reads
net=6 but ZERO builders are actually running. Root cause: `.claude/settings.json`
logs `SubagentStart` twice (a wildcard `matcher: "*"` hook plus the per-type
`^builder$` matcher) while `SubagentStop` logs once, so every start drifts the
count +1. Deduplicated real figures: starts=7, stops=8, net=-1. OT-114's
committed fix (af67ef3) removes the duplicate hook and re-derives the count by
pairing start to stop on agent_id with a staleness cutoff. All four stay
blocked on OT-114 merging.

**Corrected blocked reasons — OT-108, OT-114.** Both previously read blocked
on the `typecheck` gate being red on main. That is no longer true — main is
typecheck-clean as of 8d6c09d (OT-116 merged). Both now read "BLOCKER
CLEARED — awaiting review + merge," with work already complete and committed
(93d55ec, af67ef3) and gates green. Sequence for both: merge main into branch,
re-run gates, review, merge.

**No change.** OT-107 and OT-116 stay In Progress — reviewers are currently
running on both, neither has a result yet, neither moves to Done this batch.
OT-100 through OT-106 stay Done. OT-110 and OT-115 stay Blocked on their real
dependencies (OT-111, OT-107 respectively), unchanged this batch.

**Ledger is authoritative.** All text above was pulled verbatim from
`ledger/*.md` frontmatter and body; nothing paraphrased, nothing carried over
from the prior (incorrect) board text.

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

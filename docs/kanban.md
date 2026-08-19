| id | title | status | blocked reason |
|---|---|---|---|
| OT-100 | Make main lint-clean — fix pre-existing lint errors blocking the gate | Done | — |
| OT-101 | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production | Done | — |
| OT-102 | Parse route: derive image URL server-side, stop echoing error internals, set maxDuration | Done | — |
| OT-103 | RLS: stop publishing every profile; caller check on add_friendship | Done | — |
| OT-104 | Compress receipt photos client-side before upload; cap size and MIME server-side | Done | — |
| OT-105 | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint | Done | — |
| OT-106 | Allocate rounding remainders so charges sum to the total | Done | — |
| OT-107 | Rate-limit the parse route and share/claim actions | Done | — |
| OT-108 | Add indexes on all foreign keys | Done | — |
| OT-109 | Toast system: share/save errors surface, link-copied confirms | Done | — |
| OT-110 | Privacy policy page | Done | — (reviewer-light MERGE, merged; section 5 matches deleteAccount.ts exactly, no "your name only" phrasing) |
| OT-111 | Account deletion — user-initiated, complete, confirmed | Done | — (merged to main, attempt 2, commit bcd75f7; both HIGH review findings closed) |
| OT-112 | Document NEXT_PUBLIC_APP_URL in .env.example | Done | — |
| OT-113 | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState | Done | — |
| OT-114 | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring | Done | — |
| OT-115 | Rate-limit hardening: parse limiter is bypassable by replay (HIGH), plus fail-open silence, off-by-one ceiling, no 429 UI | Done | — (reviewed MERGE, merged; main 272/272, lint and typecheck clean. HIGH materially but NOT fully closed — a blank/unreadable image still yields a replayable empty parse; continued as OT-123) |
| OT-116 | Make main typecheck-clean — two pre-existing errors block the required gate for every task | Done | — |
| OT-117 | parallel-cap hook fails open on a torn events.jsonl line; stale comment misleads | Done | — (reviewed MERGE against fixtures with the old hook as control, merged, then verified live against the exact fixture that produced the jam: now allows dispatch) |
| OT-118 | Save and share failures are still swallowed on three call sites; Done can wedge | Done | — (review passed, merged to main, worktree and branch removed) |
| OT-119 | new/page.tsx — untracked 1.5s timer hijacks navigation; Done still races Share | Done | — (reviewer-light MERGE, merged; commit e7ca92e restored after a worktree reversion, main confirms 249/249) |
| OT-120 | charges RLS has no with-check — anyone can plant a charge row on a tab they don't own | Done | — (reviewed MERGE, merged; main 292/292, lint and typecheck clean. Migration 0019 has NOT been applied to any live database yet — the fix is inert until it is) |
| OT-121 | parallel-cap third fail-open on an unopenable log; remove the wildcard SubagentStart | Done | — (reviewed MERGE against fixtures with HEAD as control, merged; main 304/304. Unreadable log, directory-at-path, and unsearchable `.claude` all now DENY. Wildcard `SubagentStart` confirmed removed — it only ever existed in main's uncommitted working copy, not in committed HEAD. A fifth fail-open, in `deny()` itself, routed to OT-127) |
| OT-122 | read-only agents can still mutate a worktree through Bash git commands | Done | — (reviewed MERGE against 12 fixture repos, merged; main 292/292. Detect-and-repair chosen over a PreToolUse hook; all seven refusal shapes hold, all-or-nothing confirmed. Five findings routed to OT-126) |
| OT-123 | Parse replay is still open on an empty parse — needs a `parsed_at` marker written before the model call | Done | — (reviewed MERGE, merged; main 304/304. HIGH from OT-115 now fully closed — five concurrent requests for one receipt cost one Gemini call. Ships as migration 0020. **Migration 0020 must be applied BEFORE this code deploys** — applied late, every parse errors and scanning is down for every user, since the claim deliberately fails closed. Six findings routed to OT-129) |
| OT-124 | Owner save erases `joined_via_share`, hiding real claimers from the owner's view | In Progress | — (builder result on commit `791d027`, UNREVIEWED: lint/typecheck clean, 317/317. In review. attempts 1) |
| OT-125 | the fleet's own agent cards and tooling are untracked or uncommitted in git | Done | — (reviewed MERGE, merged; main 304/304. `reviewer-light.md` and `bin/doctor` now tracked, executable bit preserved. Merge itself was blocked by the very problem the task fixed — main's untracked copies had to be reconciled by hand, not discarded) |
| OT-126 | detect-and-repair can discard a genuine revert; staged blob not captured in the patch | Done | — (reviewed MERGE against 13 fixture repos, merged; main 304/304. A deliberate revert-to-an-earlier-value now refuses instead of being silently discarded; `MM` paths refuse. Tier-routing lesson: `finish-worktree` changes should route `builder-deep`, since the script performs an irreversible action regardless of diff size. Two residual holes routed to OT-129) |
| OT-127 | a dead agent holds a cap slot for an hour — events.jsonl has no data to detect it | In Progress | — (builder-deep running, attempts 1. Third live occurrence of a turn-exhausted agent wedging a slot, cleared by hand each time. Also carries the fifth fail-open in `deny()` itself) |
| OT-128 | review the unreviewed kit install change by change and commit what survives | In Progress | — (builder running, attempts 1. Reconciling two versions of `reviewer.md` — OT-122's merged read-only paragraph plus the install's separate +6/-1 delta) |
| OT-129 | backlog from the OT-123, OT-124 and OT-126 reviews | Blocked | held at the lane spend cap ($87.57 of $100.00), not by any dependency; filed during wind-down, never dispatched, attempts stays 0. Lowest priority of the four open tasks — nothing here loses data and two of the `finish-worktree` holes are unreachable in this repo's current path set |

## Sync notes (2026-08-19, cycle 9)

Reconciled against `ledger/*.md`, all 30 files read in full. Card-by-card,
matched on id — no cards deleted.

Moves this batch:

- **OT-121** In Progress → **Done**. Attempt 2 (builder-deep) merged; three
  fail-opens closed and verified against fixtures with HEAD as a live control.
  A fifth fail-open, in `deny()`'s own `jq -n` call, was found by the reviewer
  and routed to OT-127 rather than fixed here.
- **OT-122** In Progress → **Done**. Merged; five findings, including the
  `reviewer.md` merge hazard, routed to OT-126.
- **OT-123** Todo → **Done**. Merged. **Deployment-order note carried onto the
  card and into `docs/deployment.md` and the README**: migration 0020 must land
  before this code does, or scanning goes down for everyone.
- **OT-124** Todo → **In Progress**. Builder result landed on commit `791d027`
  but is explicitly marked UNREVIEWED in its own ledger entry — left as In
  Progress, not Done, until a reviewer verdict exists. `files:` grew to include
  `src/lib/rateLimit.ts` and its test; the ledger records this as the filer's own
  frontmatter having been incomplete at dispatch, corrected in the body.
- **OT-125** created and closed within this window: Todo → **Done**. Merged.
- **OT-126** created and closed within this window: Todo → **Done**. Merged.
- **OT-127** created, `in-progress` per frontmatter — dispatched directly to
  builder-deep, no Todo state observed at sync time.
- **OT-128** created, `in-progress` per frontmatter — same, dispatched directly.
- **OT-129** created, `blocked` per frontmatter. Blocked reason carried verbatim
  from the ledger.

Left alone, no drift: OT-100–OT-120 all checked against the ledger and left as
Done — no changes.

No tasks in `ledger/` are missing from this board; nothing to flag as vanished.

### On the lane-cap raise

The owner raised the lane spend cap from $100 to $125, which is recorded as
having unblocked dispatch on OT-124, OT-127, and OT-128. **OT-129 is not among
them** — its own ledger `blocked_reason` states a spend figure ($87.57) already
under the old $100 cap, and gives a different reason for staying blocked: it was
filed during wind-down, was never dispatched, and is explicitly ranked lowest
priority of the four open tasks with instructions to take the other three first.
The ledger's own state is `blocked`, so this board matches it as blocked — that
is the reconciliation, not a judgment call.

### Errors the owner corrected in the ledger this session — recorded, not re-litigated

Three self-corrections were found in the bodies of `ledger/OT-121.md` and
`ledger/OT-124.md`, all already resolved and consistent with current
frontmatter, so no board drift results:

1. **OT-121** — a claim written across several earlier entries that main's
   committed HEAD carried a wildcard `SubagentStart` was wrong; the wildcard
   existed only in main's uncommitted working copy. Corrected in the merge
   writeup.
2. **OT-124** — the task's `files:` frontmatter omitted `src/lib/rateLimit.ts`
   and its test even though the task body mandated editing both; noted in the
   body as "the frontmatter was incomplete — my error" and the frontmatter now
   lists both.
3. **OT-124** (and OT-122 before it) — a `todo → in-progress` edit was missed at
   dispatch time, leaving the ledger reading `todo` while an agent was already
   running against the task. Named in OT-124's body as the third instance this
   session, all three self-attributed.

No unresolved frontmatter/body contradiction found this cycle — every case above
was already caught and fixed by the time this sync ran.

Notion was not reachable this cycle: no `mcp__notion__*` tools are present in
this session, and `.claude/notion.json` has `use_scratch_only: true` with
`kanban_database_id: null`. Per the fallback rule this is expected, not an
error — writing to `docs/kanban.md` is the correct outcome, not a degraded one.

## Sync notes (2026-08-19, cycle 8)

Reconciled against `ledger/*.md`, all 25 files read. Card-by-card, matched on
id — no cards deleted.

Moves this batch:

- **OT-115** In Progress → **Done**. Reviewed MERGE, merged; main 272/272,
  lint and typecheck clean. `attempts: 1`. HIGH finding materially but not
  fully closed — see the doc write-up; residual routed to new task OT-123.
- **OT-120** In Progress → **Done**. Reviewed MERGE, merged; main 292/292,
  lint and typecheck clean. `attempts: 1`. Migration 0019 not applied to any
  live database yet, per the ledger's own "OPEN FOR THE OWNER" note.
- **OT-122** Todo → **In Progress**. Dispatched to `builder-deep` once a
  builder slot freed after OT-120 merged.

New cards:

- **OT-123** created, `todo` per frontmatter, `tier: builder-deep`. Direct
  continuation of OT-115's HIGH — a blank/unreadable image still yields an
  empty parse indistinguishable from unparsed, so it replays forever off one
  upload. Same urgency as OT-115's original finding: unbounded paid Gemini
  spend on a live, reachable endpoint.
- **OT-124** created, `todo` per frontmatter, `tier: builder-deep`. Pre-existing
  defect (an owner save erases `joined_via_share`) made load-bearing by
  OT-115's claim-limiter fix, which now relies on the erasure to avoid
  locking out new joiners.
- **Dependency noted on both cards**: OT-123 and OT-124 both edit
  `src/lib/rateLimit.ts`. Per the ledger's sequencing notes on each file,
  OT-123 must merge before OT-124 dispatches — do not run them in parallel.

No frontmatter/body contradiction found this cycle. OT-115, OT-120, OT-121,
OT-122, OT-123, and OT-124 were all read in full; every body narrative is
consistent with its own frontmatter. (Two cycles back this caught a real
divergence on OT-120; last cycle one on OT-122 slipped through undetected —
this cycle's OT-122 body is now consistent with its `in-progress` frontmatter,
recording the same fix at the same time it happened.)

Left alone, no drift:

- **OT-121** unchanged — still In Progress, `attempts: 1`, `tier: builder-deep`.
  Attempt 1 ran out of turns (not ideas) mid-verification with uncommitted
  work surviving in the worktree; tier raised from `builder` to `builder-deep`
  for turn headroom, which the ledger is explicit is not the escalate-on-retry
  rule and does not indicate the task resisted solution.
- OT-100–OT-109, OT-111–OT-114, OT-116–OT-119 all checked against the ledger
  and left as Done — no changes.

No tasks in `ledger/` are missing from this board; nothing to flag as
vanished.

Notion was not reachable this cycle: no `mcp__notion__*` tools are present in
this session, and `.claude/notion.json` has `use_scratch_only: true` with
`kanban_database_id: null`. Per the fallback rule this is expected, not an
error — writing to `docs/kanban.md` is the correct outcome, not a degraded
one.

## Backlog (unscheduled, no ledger task)

- Friendship request/accept model — reverse friendship row is inserted without
  b's consent (spec-accepted for OT-103, revisit).
- Add drop-if-exists guard to `profiles_select_own` policy creation in
  migration 0015 — manual re-run currently errors (fails closed, not urgent).
- `find_profile_by_venmo_username` should reject empty/whitespace username on
  direct RPC call.
- (from OT-120 review) `deleteAccount.ts`'s storage.list pagination assumes a
  short page means the last page, with no total to check against — worth a
  guard or at least a comment naming the assumption (LOW).
- (from OT-120 review) `deleteAccount.ts`'s charge-scan offset paging can skip
  rows if another writer deletes this user's charges mid-scan (LOW).
- (from OT-120 review) if migration 0019 ever ran outside a transaction and the
  `create policy` step failed, the old policy would be left dropped — fails
  closed, and the Supabase CLI wraps migrations in a transaction anyway, so
  this is a documentation note more than a defect (LOW).

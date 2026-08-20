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
| OT-124 | Owner save erases `joined_via_share`, hiding real claimers from the owner's view | Done | — (reviewed MERGE, merged; commit `791d027` line, main 317/317. `joined_via_share` and `joined_at` now survive an owner save) |
| OT-125 | the fleet's own agent cards and tooling are untracked or uncommitted in git | Done | — (reviewed MERGE, merged; main 304/304. `reviewer-light.md` and `bin/doctor` now tracked, executable bit preserved. Merge itself was blocked by the very problem the task fixed — main's untracked copies had to be reconciled by hand, not discarded) |
| OT-126 | detect-and-repair can discard a genuine revert; staged blob not captured in the patch | Done | — (reviewed MERGE against 13 fixture repos, merged; main 304/304. A deliberate revert-to-an-earlier-value now refuses instead of being silently discarded; `MM` paths refuse. Tier-routing lesson: `finish-worktree` changes should route `builder-deep`, since the script performs an irreversible action regardless of diff size. Two residual holes routed to OT-129) |
| OT-127 | a dead agent holds a cap slot for an hour — events.jsonl has no data to detect it | Blocked | upstream kit work, not blocked on any owner decision. the OT-131 decision was made (option 1, keep the kit) and this branch's two commits were built against the local parallel-cap.sh the kit replaced. .claude/hooks/protect-fleet.sh now blocks every agent in this fleet, orchestrator included, from writing .claude/hooks — so no agent here can fix it regardless of tier or prompt. the bug is still live: an agent killed on maxTurns emits no SubagentStop and holds a cap slot until STALE_AFTER_SECONDS=3600. branch task/OT-127 and its worktree are deliberately preserved as the only working fix that exists anywhere. |
| OT-132 | a parse outage is invisible to the user — no message on any non-429 failure | Done | — (carved out of OT-129 section B, items 1, 3, 5, 6. reviewed clean, merged as `19901ac`, worktree and branch removed) |
| OT-128 | review the unreviewed kit install change by change and commit what survives | Done | — (reviewed MERGE, merged; main 304/304 across 23 files. `reviewer.md`'s two competing versions reconciled by hand — OT-122's merged mutation-guard paragraph verified byte-identical, the install's separate +6/-1 delta applied on top. Two lows routed to OT-129) |
| OT-129 | backlog from the OT-123, OT-124 and OT-126 reviews | Done | — (closed by decline, not by merge — no commit, no branch. B4, the last live item, was declined by the owner: two tabs on one `receiptId`, the 409 loser can save over the winner's parsed data, low, pre-existing. every other item was shipped elsewhere — B1/B3/B5/B6 in OT-132, B2 in OT-134, C1/C2 in OT-137 — or declined, section A permanently, on `bin/finish-worktree` being closed to every agent) |
| OT-130 | an owner save deletes any claimer who joined since the client loaded the page | Done | — (full reviewer passed all six criteria, no high findings; merged to main as `420a8d3`, worktree and branch removed) |
| OT-131 | the kit re-install reverted five merged fleet fixes; installed cap hook miscounts on this repo's own log | Done | — (owner chose option 1, kit adopted, committed as `02a0b6e`) |
| OT-133 | a late claim is destroyed by the item re-mint when the claimer IS in the payload | Done | — (third reviewer dispatch delivered a PASS after two turn-exhausted attempts lost their verdicts; all six criteria checked, mutation-checked non-tautological, merged into main as a merge commit on top of `420a8d3`. two medium findings reviewed and deliberately declined on owner instruction, not fixed — reasoning kept in `ledger/OT-133.md`) |
| OT-134 | a transient gemini outage permanently burns a receipt's only parse — no retry affordance | Done | — (full reviewer passed all nine criteria, no high findings, merged as `5534b5f`. bounded to 3 model attempts per receipt via migration 0025 — renumbered from 0024 after OT-137 took that slot; replay hole confirmed still closed) |
| OT-137 | claim_done_at is reset by every owner save, so a finished claimer reads as still claiming | Done | — (full reviewer passed all seven criteria, no high findings, merged as `070cb49`. carries claim_done_at across the participant delete/re-insert via migration 0024, keyed on lowercased username; deliberately no backfill, keeping OT-124's now() trap in mind) |

## Sync notes (2026-08-20, cycle 19)

Reconciled against `ledger/OT-129.md`. Matched on id — no card created without a
matching ledger file.

- **OT-129** Todo → **Done**. Ledger `state: done`. The last live item, section
  B4 (two tabs on one `receiptId`, the 409 loser can save over the winner's
  parsed data), was explicitly declined by the owner. The task's own acceptance
  criterion allows closure by decline as well as by fix, so this is a completed
  task, not an abandoned one. Nothing merged for OT-129 itself — no commit, no
  branch — it closes as a backlog container whose items were all dispatched
  elsewhere and shipped (B1/B3/B5/B6 in OT-132, B2 in OT-134, C1/C2 in OT-137)
  or declined (section A, permanently; B4, here). The reason column says
  "closed by decline" rather than implying a merge that never happened.

Left alone, no drift: every other card checked against the ledger and matches
already. `ledger/` now has no `todo` and no `in-progress` tasks — OT-127 is the
only open item, and it is `blocked` on fleet infrastructure (`.claude/hooks`)
that no agent in this repo, orchestrator included, can write. Worth flagging:
the backlog is otherwise empty.

No tasks in `ledger/` are missing from this board; nothing to flag as vanished.

Notion was not reachable this cycle: no `mcp__notion__*` tools present in this
session's tool list. Per the fallback rule this is expected, not an error —
writing to `docs/kanban.md` is the correct outcome.

## Sync notes (2026-08-20, cycle 18)

Reconciled against `ledger/OT-137.md`, `ledger/OT-134.md`, `ledger/OT-129.md`,
`ledger/OT-127.md`. Matched on id — no card created without a matching ledger
file.

- **OT-137** In Progress → **Done**. Ledger `state: done`, merged as `070cb49`.
  Moved to Done because the ledger says done, not because of the merge — the
  merge happened to land in the same session.
- **OT-134** In Progress → **Done**. Ledger `state: done`, merged as `5534b5f`.
- **OT-129** left at **Todo**, no change. Ledger body still lists only section
  B4 as remaining — matches the existing note.
- **OT-127** left at **Blocked**, no change. `blocked_reason` in the ledger
  frontmatter is unchanged from last cycle. Two new entries were added to the
  ledger body this session — occurrences 4 and 5 (two more agents killed on
  `maxTurns`, no `SubagentStop`, cleared by hand a third and fourth time) and a
  second, separate bug found while clearing them: untyped stop records
  (`agent_type: ""`) land in their own bucket and never cancel a typed start,
  so the per-type count can ratchet upward with no agent dying at all. Neither
  changes the `state` or `blocked_reason`, so the card is unchanged. Noted here
  because a blocked card that hasn't moved in five sync cycles is exactly the
  kind of thing worth a second look — this one remains blocked for the reason
  already on the card: `.claude/hooks` is closed to every agent, orchestrator
  included, on both the Edit/Write and Bash routes.

Notion was not reachable this cycle: no `mcp__notion__*` tools present in this
session's tool list. Per the fallback rule this is expected, not an error —
writing to `docs/kanban.md` is the correct outcome.

## Correction (2026-08-20)

OT-135 and OT-136, created below in cycle 17, were cut by the owner on cost
grounds before either was dispatched. `ledger/OT-135.md` and
`ledger/OT-136.md` are deleted. Their cards are removed from the table above —
neither ever ran, so there is no work-in-progress to reconcile.

The two `medium` findings that spawned them are not lost. They are recorded
in `ledger/OT-133.md` under "Findings DECLINED 2026-08-20 on owner
instruction": a new but strictly-better concurrency failure introduced by
`0023` (a whole-transaction rollback with an error toast, replacing a prior
silent duplicate-row bug), and a stale comment in `src/lib/receiptShare.ts`
that `0023` made false. Both were judged not to meet the bar of "the app
fails its one job without it" and were declined rather than filed. The OT-133
row above is corrected to say so instead of citing OT-135/OT-136 as
follow-up tasks.

The cycle 17 notes below are left as written — they are the historical record
of what this board looked like at the time, including the since-corrected
claim that OT-135 and OT-136 were filed. Read them as history, not as current
state; the table above is current.

## Sync notes (2026-08-19, cycle 17)

Reconciled against `ledger/OT-133.md`, `ledger/OT-134.md`, `ledger/OT-135.md`,
`ledger/OT-136.md`, `ledger/OT-137.md`, `ledger/OT-129.md`. Matched on id — no
cards deleted.

Moves and creates this batch:

- **OT-133** In Progress → **Done**. Third reviewer dispatch delivered a PASS
  after two prior review attempts died to the turn limit with no verdict
  recorded. All six criteria checked, criterion 1 mutation-checked against a
  reverted model and confirmed non-tautological. Merged into main as a merge
  commit on top of `420a8d3`. Two medium findings from the review carried
  forward as new tasks rather than fixed here: OT-135, OT-136.
- **OT-135** created, **Todo**, `builder` per frontmatter. OT-133 reviewer's
  first medium — two overlapping owner saves can now collide on the
  `receipt_items` primary key and roll back with a `23505`, where random ids
  used to produce silent duplicate rows instead. Framed explicitly as a better
  failure to make tested and distinguishable, not a regression to revert.
- **OT-136** created, **Todo**, `builder-light` per frontmatter. OT-133
  reviewer's second medium — a stale comment in `receiptShare.ts` still claims
  the item swap clears old charges, which `0023` made false. Comment-only fix,
  one file.
- **OT-137** created, **In Progress**, `builder-deep` per frontmatter. Split
  out of OT-129 section C1 now that OT-133 has merged and freed
  `save_receipt_state` to be amended again. Same defect shape OT-124 fixed for
  `joined_via_share`, now for `claim_done_at`. Also folds in what was briefly
  filed as its own task, OT-138 (a stale test assertion in
  `chargesRls.test.ts`) — done separately it would have gone stale on arrival
  again, the same moving-target problem that held it inside OT-129 originally.
  No card exists for OT-138 on this board, so nothing was removed for it.
- **OT-134** left at **In Progress**, no card change beyond confirming it's on
  the board — `attempts: 1` per frontmatter, still building.
- **OT-129** left at **Todo**, note rewritten. Scope shrank to a single
  remaining item, section B4 (two tabs on one `receiptId`, low, pre-existing) —
  section A stays permanently declined, and C1/C2 split out into OT-137 above.

No tasks in `ledger/` are missing from this board; nothing to flag as vanished.

Notion not reachable this cycle: no `mcp__notion__*` tools present in this
session's tool list. Falling back to `docs/kanban.md` per the fallback rule —
this is the expected outcome, not a failure.

## Sync notes (2026-08-19, cycle 16)

Reconciled against `ledger/OT-129.md`, `ledger/OT-127.md`. Matched on id — no
cards deleted.

Two changes this batch:

- **OT-129** Blocked → **Todo**, `blocked_reason` cleared to match frontmatter
  (`null`). Section A was permanently declined — it targets
  `bin/finish-worktree`, which `protect-fleet.sh` denies to every agent, and
  that declination satisfies acceptance criterion 1. Remaining live work is
  B4, C1, C2, none of it blocked on a decision — each is waiting on a
  sequence: C1 and C2 behind OT-133, B4 behind OT-134.
- **OT-127** stays **Blocked**, reason rewritten to match the ledger's current
  wording. Previously cited a pending OT-131 owner decision; that decision was
  made (option 1, kit adopted). The accurate reason now: this is upstream kit
  work — `protect-fleet.sh` blocks every agent including the orchestrator from
  writing `.claude/hooks`, so no agent in this fleet can fix it. The bug is
  still live.

Left alone, no drift: all other cards checked against the ledger and match
the board already.

No tasks in `ledger/` are missing from this board; nothing to flag as
vanished.

Notion not reachable this cycle: no `mcp__notion__*` tools present in this
session's tool list. Falling back to `docs/kanban.md` per the fallback rule —
this is the expected outcome, not a failure.

## Sync notes (2026-08-19, cycle 15)

Reconciled against `ledger/OT-134.md`, `ledger/OT-133.md`, `ledger/OT-129.md`.
Matched on id — no cards deleted.

Three changes this batch:

- **OT-134** created, **In Progress**, `builder-deep` per frontmatter. Split out
  of OT-129 section B item 2 — a transient Gemini outage permanently burns a
  receipt's only parse, no retry affordance. Needs its own reasoning about the
  replay hole OT-123 closed, so it got its own file rather than a grouped
  commit. Explicitly barred from touching `save_receipt_state`, which OT-133
  owns.
- **OT-133** stays **In Progress**, note updated. Ledger records attempt 2 as
  built and gates-green (364/364 tests, migration 0023 verified against real
  Postgres via PGlite) and now under full review — not yet done, no reviewer
  verdict recorded.
- **OT-129** stays **Blocked**, reason rewritten to match current frontmatter
  and body. Section B item 2 no longer sits here — it moved to OT-134. Blocked
  reason now names what's actually still held: section A (undispatchable,
  `protect-fleet.sh` blocks `bin/*`), section B item 4 (low, pre-existing), and
  section C (C1, C2 — both waiting on OT-133).

Notion not reachable this cycle: no `mcp__notion__*` tools present in this
session's tool list, despite `.claude/notion.json` now carrying real
`docs_database_id` and `kanban_database_id` values with
`use_scratch_only: false`. This is a connection problem, not a configuration
problem — the config points at real boards, but the MCP server named `notion`
either isn't attached to this session or its tools aren't granted. Falling
back to `docs/kanban.md` per the fallback rule. Worth flagging to the owner
again since the config now looks fully ready and the only missing piece is the
tool grant.

## Sync notes (2026-08-19, cycle 14)

Reconciled against `ledger/*.md`, all 34 files read. Card-by-card, matched on
id — no cards deleted.

One transition this batch:

- **OT-133** Todo → **In Progress**. `attempts` moved 0 → 1, `tier:
  builder-deep`. Branch `task/OT-133`, worktree `../wt-OT-133`. Recorded as
  `todo` mid-sync last cycle; the ledger now shows it dispatched.

Left alone, no drift: OT-100–OT-132 all checked against the ledger and match
the board already — OT-127 and OT-129 remain Blocked with reasons unchanged
from cycle 13's wording; OT-130, OT-131, OT-132 remain Done.

No tasks in `ledger/` are missing from this board; nothing to flag as
vanished.

**Notion attempted this cycle.** `.claude/notion.json` now sets
`kanban_database_id` and `docs_database_id` and `use_scratch_only: false` —
this looked like a real target. But no `mcp__notion__*` tools are present
anywhere in this session's tool list. That is a connection problem, not a
configuration problem: the config is ready, the MCP server named `notion`
either isn't attached to this session or its tools aren't granted. Falling
back to `docs/kanban.md` per the fallback rule, and flagging this explicitly
so the owner can check the MCP connection rather than the config file.

## Sync notes (2026-08-19, cycle 13)

Reconciled against `ledger/*.md`, all 34 files read. Card-by-card, matched on
id — no cards deleted. This batch was catching up several transitions at once:
the prior sync attempt was denied by the parallel cap, so the board had gone
stale across five task changes.

Moves and creates this batch:

- **OT-130** In Progress → **Done**. Full reviewer passed all six criteria, no
  high findings. Merged to main as `420a8d3`; worktree and branch removed.
- **OT-132** Todo → **Done**. Reviewed clean, merged as `19901ac`; worktree
  and branch removed.
- **OT-131** Blocked → **Done**. Owner answered the decision — option 1, keep
  the kit — and the local fixes were discarded rather than restored. Committed
  as `02a0b6e`.
- **OT-127** stays **Blocked**, reason rewritten. This is now closed as
  discarded, not merely waiting: the OT-131 decision means its branch
  (`0fb3884`, `ca80141`) targets a `parallel-cap.sh` that no longer exists and
  will never merge. Branch and worktree are deliberately preserved per
  `ledger/OT-127.md`'s "Closed" section — they are the only working fix for
  the bug anywhere, kept for whenever it's corrected upstream. Duplicate old
  row for OT-131 (mistakenly left as two rows after cycle 12's edit) removed;
  one row per id, matching the reconcile-don't-append rule.
- **OT-129** stays **Blocked**, reason rewritten for the same decision.
  Section A (`bin/finish-worktree`) is now permanently undispatchable — the
  kit's `protect-fleet.sh` blocks every agent from editing `bin/*`, so no
  builder can pick this up regardless of priority. Section B items 1, 3, 5, 6
  are done via OT-132. Section B item 2 and section C are still open and still
  dispatchable.
- **OT-133** created, **Todo**, `builder-deep` per frontmatter. Filed from the
  OT-130 reviewer's medium finding — a late claim destroyed by the item
  re-mint when the claimer is already in the payload. Reproduced against real
  Postgres; explicitly out of OT-130's own scope.

Left alone, no drift: OT-100–OT-126, OT-128 all checked against the ledger and
match the board already.

No tasks in `ledger/` are missing from this board; nothing to flag as
vanished.

Notion was not reachable this cycle: no `mcp__notion__*` tools are present in
this session, and `.claude/notion.json` has `use_scratch_only: true` with
`kanban_database_id: null`. Per the fallback rule this is expected, not an
error — writing to `docs/kanban.md` is the correct outcome, not a degraded
one.

## Sync notes (2026-08-19, cycle 12)

Reconciled against `ledger/*.md`, all 33 files read. Card-by-card, matched on
id — no cards deleted.

The dispatch that triggered this sync described OT-132 as moving to
`in-progress`. By the time the ledger was read, it had already moved again —
`ledger/OT-132.md` changed on disk mid-sync, after this reconciliation had
started. The ledger's current state, not the dispatch note, is what the board
reflects below; that is the whole point of "the ledger wins."

Moves and confirmed transitions this batch:

- **OT-130** — stays **In Progress**. `attempts` moved 0 → 1. The ledger
  records that attempt 1 died with its orchestrator session, not on the
  problem: uncommitted work survived in `../wt-OT-130`
  (`saveReceipt.ts`, a new test file, migration 0022) and was re-dispatched to
  builder-deep with instructions to read and judge that work rather than
  restart, and to commit on `task/OT-130` before running gates this time.
- **OT-132** In Progress → **Todo**. Attempt 1 (`builder`) exhausted turns
  with no Result block, nothing committed. Escalated to `builder-deep` for
  attempt 2, but that dispatch was DENIED by the parallel cap: OT-130's one
  live `builder-deep` is being counted twice, because the kit re-install's
  restored wildcard `SubagentStart` matcher double-logs each start and the
  cap groups by `agent_type` rather than `agent_id` — the same double-count
  bug OT-114 fixed, now regressed by the kit install and held on OT-131. Four
  files sit uncommitted in `../wt-OT-132`, unattended. Card moved back to
  Todo since nothing is currently running against this task.

Left alone, no drift: OT-100–OT-129, OT-131 all checked against the ledger and
match the board already — OT-127, OT-129, and OT-131 remain Blocked with
reasons unchanged from cycle 11's wording.

No tasks in `ledger/` are missing from this board; nothing to flag as
vanished.

Notion was not reachable this cycle: no `mcp__notion__*` tools are present in
this session, and `.claude/notion.json` has `use_scratch_only: true` with
`kanban_database_id: null`. Per the fallback rule this is expected, not an
error — writing to `docs/kanban.md` is the correct outcome, not a degraded
one.

## Sync notes (2026-08-19, cycle 11)

Reconciled against `ledger/*.md`, all 33 files read. Card-by-card, matched on
id — no cards deleted.

Moves this batch:

- **OT-127** In Progress → **Blocked**. Was mislabelled last cycle — its
  frontmatter reads `state: blocked` and has since the "HELD" note was added.
  The work is built and committed (`0fb3884`, `ca80141`) but unreviewed (its
  reviewer session died mid-review) and now additionally held on the OT-131
  owner decision, since the kit re-install replaced all three of this task's
  files. Blocked reason rewritten to match the ledger's current wording.
- **OT-129** left at Blocked, note updated. `blocked_reason` now records the
  split into OT-132 — section B items 1, 3, 5, 6 carved out and dispatched;
  section A (held on OT-131) and section B item 2 plus section C remain here.
- **OT-132** created, `in-progress` per frontmatter. Carved out of OT-129
  section B, items 1, 3, 5, 6 — unaffected by the OT-131 hold since it touches
  `src/` only. Dispatched to a builder.

Left alone, no drift: OT-100–OT-126, OT-128, OT-130, OT-131 all checked
against the ledger and match the board already.

No tasks in `ledger/` are missing from this board; nothing to flag as
vanished.

Notion was not reachable this cycle: no `mcp__notion__*` tools are present in
this session, and `.claude/notion.json` has `use_scratch_only: true` with
`kanban_database_id: null`. Per the fallback rule this is expected, not an
error — writing to `docs/kanban.md` is the correct outcome, not a degraded
one.

## Sync notes (2026-08-19, cycle 10)

Reconciled against `ledger/*.md`, all 32 files read in full. Card-by-card,
matched on id — no cards deleted.

Moves this batch:

- **OT-124** In Progress → **Done**. Board had drifted — the ledger already
  read `state: done` (reviewed MERGE, main 317/317) while the board still
  showed the prior cycle's unreviewed In Progress note. Reconciled to match
  the ledger.
- **OT-128** In Progress → **Done**. Same drift shape as OT-124 — ledger
  already `state: done` (reviewed MERGE, main 304/304 across 23 files), board
  had not been updated. Reconciled.
- **OT-127** left at In Progress, but its note rewritten. Frontmatter is still
  `in-progress`; the ledger body records the work as built and committed
  (`0fb3884`, `ca80141`) but unreviewed — its reviewer session ended before
  returning findings — and now additionally superseded by the uncommitted kit
  re-install, held pending the OT-131 owner decision. Card status unchanged,
  reason text updated to carry both facts.
- **OT-129** left at Blocked. `blocked_reason` changed in the ledger from a
  spend-cap figure to the OT-131 owner decision — carried onto the card
  verbatim in substance.
- **OT-130** created, `in-progress` per frontmatter. Was `blocked` at the last
  sync (spend wind-down); the ledger records the wind-down as lifted and the
  task dispatched to builder-deep with no scope changes.
- **OT-131** created, `blocked` per frontmatter. New task: the kit re-install
  regressed five merged fleet fixes and needs an owner decision, not a
  builder — `protect-fleet.sh` blocks every agent from touching the files in
  question. Blocked reason carried from the ledger.

Left alone, no drift: OT-100–OT-123, OT-125, OT-126 all checked against the
ledger and left as Done — no changes.

No tasks in `ledger/` are missing from this board; nothing to flag as vanished.

Notion was not reachable this cycle: no `mcp__notion__*` tools are present in
this session, and `.claude/notion.json` has `use_scratch_only: true` with
`kanban_database_id: null`. Per the fallback rule this is expected, not an
error — writing to `docs/kanban.md` is the correct outcome, not a degraded one.

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
- (from OT-130 review) `reopenEditing` disarms the OT-130 join-delete guard:
  `v_claiming` is false at `status='open'`, so a join committing in the gap
  between `joinReceipt` writing `'shared'` and `reopenEditing` writing
  `'open'` is deletable by the next save (LOW).

## Publisher notes (2026-08-20, document mode, cycle 3)

Documented two merges: OT-137 (`070cb49`) and OT-134 (`5534b5f`). Both moved to
Done above, matching their ledger `state: done`. README got two new key
features, two new tradeoff rows, and two new learnings (findings carried
forward on both tasks; two branches independently claiming migration `0024`
and what renumbering actually costs). `docs/features.md` got one row per
feature — these are distinct user-facing behaviors, not extensions of an
existing row, so neither was folded into "Claim-safe owner saves."

Neither task's review findings were filed as new ledger tasks. Both were
reviewed and explicitly declined at the reviewer/owner level, with reasoning
kept in `ledger/OT-137.md` and `ledger/OT-134.md` — not restated here per the
handbook's rule against listing every finding. OT-134's review also confirmed
OT-129's remaining item (B4, two tabs on one `receiptId`) got strictly better
as a side effect, not worse; no ledger change made on that basis, it's a
by-product noted for whoever picks up B4 next.

Notion was not reachable: no `mcp__notion__*` tools present in this session's
tool list. Per the fallback rule this is expected, not an error — writing to
`docs/` is the correct outcome.

## Publisher notes (2026-08-19, document mode, cycle 2)

Documented one merge: OT-133 (merge commit on top of `420a8d3`). Moved to Done
above, matching its ledger `state: done`. README got a new tradeoff row, an
extended key-features line, and two new learnings (mutation-checking a test by
reverting its mechanisms; shipping with findings carried forward rather than
fixed). `docs/features.md`'s existing OT-130 row was extended rather than given
a new row, since OT-133 closes the other half of the same window.

Both medium findings from the OT-133 review were already filed as their own
ledger tasks before this run — OT-135 and OT-136 — so nothing new was filed
here. The two low findings are the task's own documented, non-defect tradeoffs
(no revoke-while-claiming; `new/page.tsx` sending no item ids is weaker than
originally feared, since that page's payload can never name a share-link
joiner) — not filed, per the task's own writeup.

Not documented: OT-134, OT-135, OT-136, OT-137. None has merged.

Notion was not reachable: no `mcp__notion__*` tools present in this session's
tool list. Per the fallback rule this is expected, not an error — writing to
`docs/` is the correct outcome.

## Publisher notes (2026-08-19, document mode)

Documented two merges: OT-132 (`19901ac`) and OT-130 (`420a8d3`). Both moved to
Done above, matching their ledger `state: done`. README tradeoffs and key
features updated, one new learning added (id re-minting vs. row survival),
`docs/features.md` got one row per feature.

OT-130's medium finding was already filed as its own ledger task, OT-133, in
`todo` — not duplicated here. Its two low findings: one (`reopenEditing`
disarms the guard) is genuinely unfiled and added to the backlog list above;
the other (a refused save stranding unsaved edits) is the task's own
sanctioned trade-off, not a defect, so it is not filed.

Notion was not reachable: no `mcp__notion__*` tools present, and
`.claude/notion.json` has `use_scratch_only: true` with both database ids
null. Per the fallback rule this is expected — writing to `docs/` is the
correct outcome, not a degraded one.

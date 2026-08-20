@AGENTS.md

<!-- agent-company:begin -->
# Handbook

Shared context for every agent in this repo. Role-specific instructions live in
`.claude/agents/`, not here. If something in this file only applies to one role,
it belongs in that role's card instead.

---

## What we build

Mini apps. Each one follows the same shape:

> One genuine friction point → one AI step that handles the tedious part → one
> obvious action at the end.

If a feature does not serve that shape, it is scope creep. The bar for adding
anything is not "would this be nice" but "does the app fail its one job without
it."

## Taste

These are judgment calls, not rules. When they conflict with an explicit
instruction in a task, the task wins.

- **Progressive disclosure.** The core interaction works with zero input. Depth
  is optional layering, never a prerequisite. If a user has to configure
  something before the app does its job, the design is wrong.
- **One hero interaction.** Every app has a single obvious thing to do. It gets
  the visual weight. Everything else recedes.
- **Strong visual direction early.** A bare functional baseline invites feedback
  about aesthetics instead of flow. Commit to a palette and a feel in the first
  pass, not the fifth.
- **Mobile-first unless stated otherwise.** Thumb reach, one-handed use, native
  feel.
- **Intelligence vs logic.** Before reaching for a model, ask whether the input
  is structured and deterministic. Star ratings and line items are code. Freeform
  sentiment and messy receipts are models. Paying for a model to do arithmetic is
  a defect, not a shortcut.

## Stack defaults

Detected automatically from this repo at install time — not the generator's own
defaults. Anything marked "not detected" was not confidently identifiable; ask the
owner before assuming a stack for it rather than defaulting to Next.js/Supabase.

| Layer | Detected |
|---|---|
| Framework | Next.js |
| Language | TypeScript |
| UI | Tailwind CSS |
| Data / auth / storage | Supabase |
| Tests | Vitest |
| Hosting | not detected |

## Definition of done

A task is done when all of these hold. No exceptions, no partial credit.

1. Every gate listed as `required` in `.claude/gates.json` reports `pass`.
2. The acceptance criteria in the task file are each satisfiable by inspection.
3. The change is confined to the worktree named in the task.
4. Nothing outside the task's declared file scope was modified.

"It should work" is not done. Green gates are done.

`.claude/GATES.md` explains which gates exist and which are pending. **`n/a` is
never acceptable for a required gate.** If you cannot run one, report
`STATUS: blocked` with the reason — do not report it as not applicable. Gates
listed as `pending` have no script yet; report those `n/a` honestly, and the
reviewer runs the underlying tool directly instead.

## Worktrees

One task, one worktree — an isolated checkout, separate from every other task's.
This is what makes parallel dispatch safe: two builders never touch the same
files on disk at once, because they're never in the same directory.

Never create or remove a worktree by hand. Two scripts do it:

- **`bin/new-worktree <task-id> [base-branch]`** — creates `../wt-<id>` on branch
  `task/<id>`, prints the path on the last line of stdout. Record that path in
  the task's `worktree:` field. It also shares `node_modules` via a symlink when
  the lockfile matches main's, rather than reinstalling per task — and it
  guards against a real git gotcha where a symlinked `node_modules` can slip
  past a `.gitignore` written with a trailing slash and get committed by
  accident. Use the script; don't reimplement this by hand.
- **`bin/finish-worktree <task-id>`** — merges `task/<id>` into the trunk branch, then
  removes the worktree and deletes the branch. Run only from the main checkout,
  never from inside a worktree. Refuses rather than forcing through anything
  unsafe: uncommitted changes, or a merge that doesn't apply clean. On refusal
  it leaves everything exactly as it was — nothing is deleted until the merge
  has actually succeeded.

A builder, reviewer, or publisher operating on a task works **inside that
task's worktree directory**, not in the main checkout — `cd` there first. The
ledger itself stays in the main checkout only; it is never edited from inside a
worktree.

Independent tasks can run in parallel — dispatch as many as the backlog
supports. Two tasks are independent if neither depends on the other's result.
If one genuinely needs the other merged first, dispatch them in sequence.

## Reversibility

Autonomy here is bought with reversibility, not trust. Anything reversible
proceeds without asking. The following are never performed by any agent, in any
role, for any stated reason:

- Force-push, history rewrite, or branch deletion on `main`
- Destructive or non-additive migrations against live data
- Reading, printing, or moving secrets and credentials
- Sending real messages, emails, or posts to real recipients
- Publishing publicly under the owner's name
- Anything involving payment

These are denials, not approval requests. Do not ask for permission to do them;
find another route or mark the task blocked.

## The ledger

`ledger/` is the source of truth for work state. One file per task,
`ledger/<id>.md`, with frontmatter:

This is also why a context compaction mid-session is not the problem it would
be in a system that only remembers what's in the conversation. The ledger is
on disk, not in context — it survives compaction intact. If your own memory of
a task feels thin after one, re-read the file rather than guessing.

```yaml
---
id: TB-004
app: toast-builder
title: Shuffle button randomizes without repeats
state: todo          # todo | in-progress | done | blocked
tier: builder        # builder-light | builder | builder-deep
review: full         # full | skip
attempts: 0
branch: task/TB-004
worktree: ../wt-TB-004
files:
  - src/components/Shuffle.tsx
blocked_reason: null
---
```

The body holds acceptance criteria and any advice or findings accumulated during
the task. Notion boards and the dashboard are read-only projections of this
directory. When they disagree with `ledger/`, `ledger/` is right.

Acceptance criteria are a markdown checklist, one criterion per line:

```
- [ ] shuffle deals a toast without repeating the last one shown
- [x] toast fades out after 2s
```

Unchecked at creation. The orchestrator checks a box only once a reviewer has
reported that specific criterion passing — never earlier, never on the
builder's own say-so. This is what a Stop hook or `bin/audit` reads to show
what's actually still outstanding on a task, rather than just its title.

### `review: skip` — the fast path

`review: skip` bypasses the reviewer entirely so trivial changes ship at speed.
It does **not** bypass the gates: lint, typecheck, and tests still run and still
block, enforced by a hook rather than by anyone's judgment. What gets skipped is
the reviewer agent, not correctness.

Only the orchestrator sets this, only at dispatch, and only when **all** of these
hold:

- The change is presentational only — CSS, Tailwind classes, spacing, colour,
  copy text, a static asset swap
- It touches no more than three files, all under `src/`
- No logic changes: no new conditionals, no state, no props added or removed, no
  data fetching, no new imports beyond a stylesheet or an icon

Never `skip`, regardless of how small the diff looks:

- Anything under `supabase/`, or any migration
- Auth, session, cookies, middleware
- `package.json`, lockfiles, config, CI, `.env.example`
- Anything in `.claude/` or the agent cards themselves
- Anything the handbook's reversibility list touches

A builder that discovers mid-task that the change is not presentational must say
so and stop rather than proceeding on the fast path. A hook independently checks
the changed file paths and forces review if the diff escapes this boundary — so
mislabelling a task does not actually buy speed, it just costs a round trip.

## Screenshots and images

Read an image once, extract what you need into text, then work from the text.

When you open a screenshot, immediately write down what you took from it — the
error string verbatim, the layout described in words, the values in the table. Put
that in your notes or the task file. From then on, reason from your transcription
and do not re-open the file.

Re-reading the same image on later turns is the waste this prevents. An image costs
far more context than the sentence describing what it showed, and most turns after
the first do not need the pixels at all — they need the error text you already read
out of it.

Two limits worth knowing. You cannot evict an image from your context once it is
there; this rule stops you from adding it *again*, which is the part you control.
And transcription is lossy — if a later turn genuinely needs visual detail you did
not record (a spacing problem, a color, something subtle in a rendering bug), open
it again rather than guessing from your notes. Guessing at pixels you did not
transcribe is worse than the re-read.

## Handoffs

Agents hand each other **artifacts, never transcripts.**

- Pass file paths, not file contents.
- Everything an agent learns that matters later goes into the task file. Anything
  left only in a reply is lost.
- Never assume another agent saw your reasoning. It did not.

## Worker output contract

Every worker ends its final message with exactly this block and nothing after it:

```
## Result
STATUS: done | blocked | failed
FILES: <paths changed, one per line, or "none">
GATES: typecheck <pass|fail> · lint <pass|fail> · tests <pass|fail|n/a>
UNFINISHED: <what remains, or "nothing">
NOTES: <anything the next agent needs; one or two lines>
```

The orchestrator parses this. Prose above it is fine. Prose below it breaks
parsing.

## Asking questions

Nobody in this fleet asks questions through a tool. There is no question-asking
tool available to any agent here, including the orchestrator — do not look for
one, and do not try to call one. Naming a specific tool used to appear in this
handbook, and the effect was that the orchestrator tried to call it and errored
out instead of simply asking.

The orchestrator asks the owner a question by writing it in its reply, as plain
prose, and then stopping to wait. That is the whole mechanism.

Workers cannot reach the owner at all — they run in a separate context with no
one watching. If a task is ambiguous, do not guess. Report `STATUS: blocked` with
the specific ambiguity in `NOTES`. A blocked task with a clear question is a good
outcome. A guessed answer that looks finished is the expensive failure.

## Voice

When writing anything a human reads — commit messages, READMEs, Notion docs —
write plainly. No filler, no hedging, no emoji. Short sentences. Say what
happened and what it cost.

Commit messages are lowercase, full stop — subject and body. This is enforced by
a `commit-msg` git hook, not just requested here, so do not spend effort trying to
get capitalization "right." Lowercase everything including proper nouns; the hook
does the same and cannot tell `Supabase` from `supabase`.
<!-- agent-company:end -->

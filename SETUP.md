# Setup

## Quickstart

```bash
./build-app ~/toasty
```

One command: creates a Next.js + TypeScript + Tailwind v4 + Supabase + Vitest app
at `~/toasty`, then installs the agent fleet on top of it. Takes a few minutes,
most of it `npm install`.

If the path already exists, only the fleet is installed — that is how you add the
agents to a repo you already have.

| Flag | Effect |
|---|---|
| `--lane NAME` | Lane name for the spend cap (default: directory name) |
| `--fleet-only` | Never scaffold, even if the path is empty |
| `--no-install` | Skip `npm install`; run it yourself before the first task |

### What you still do yourself

The generator creates everything local. Remote resources need your accounts and
are deliberately left to you:

```bash
cd ~/toasty
gh repo create toasty --private --source=. --push   # GitHub
npx supabase link                                    # Supabase project
npx vercel                                           # Vercel project
cp .env.example .env.local                           # then fill in the keys
```

Requires `jq` and `curl` on `PATH`. Hooks call `jq`; a missing binary makes them
fail open, which silently disables the caps.

## First run

```bash
chmod +x .claude/hooks/*.sh bin/lane   # executable bits do not survive all copies
./.claude/hooks/spend-poll.sh &        # one per machine, not per lane
./bin/lane toast-builder               # starts the orchestrator for one lane
```

Then talk to the orchestrator. It handles everything else.

## Two processes, on purpose

The spend cap needs a number and hooks cannot fetch one — `OTEL_*` variables are
stripped from every subprocess Claude Code spawns, and an HTTP call on every tool
call would be too slow. So:

- `spend-poll.sh` scrapes the local metrics endpoint and writes
  `.claude/state/spend.json`
- `spend-cap.sh` reads that file on each tool call and denies when over budget

The poller must be running before the cap means anything. `bin/lane` warns if it
is not.

## Budgets

`.claude/budget.json`, in dollars:

```json
{ "default": 5.00, "lanes": { "toast-builder": 10.00 } }
```

A lane with no budget refuses to run. Deny at 100%, warn into the orchestrator's
context at 80% so it can wind down instead of hitting a wall mid-task.

## Known soft edges

- **Metrics lag.** Export interval is set to 10s, so the cap can overshoot by
  roughly one interval of spend. It is a circuit breaker, not an accountant.
- **Cost figures are approximations.** Official billing comes from the Console.
- **Lane attribution comes from `OTEL_RESOURCE_ATTRIBUTES`,** not the `agent.name`
  attribute — user-defined subagent names are redacted to `custom` on the metrics
  stream, so per-role slicing there is not possible. Per-lane works.
- **Deny patterns are string matches.** They stop the obvious forms. The
  `permissions.deny` list in `settings.json` is the harder wall; the hook backs it
  up because hook `if` filters fail open. Verify both with `/permissions` and a
  live attempt before trusting either.

## What is not built yet

The dashboard. Its two data sources now exist and are populated:
`.claude/state/events.jsonl` for agent status, and the metrics endpoint for tokens
and cost.

---

## Status page

`status-page.sh` renders `STATUS.md` from local state and pushes it to a `status`
branch, where GitHub renders it. View it at:

```
https://github.com/<you>/<repo>/blob/status/STATUS.md
```

Nothing to enable — it runs on every subagent stop and task completion, debounced
to one commit per minute.

Three things worth knowing:

- **"Live" means "pushed from your machine."** GitHub cannot pull spend or event
  data itself; both live in `.claude/state/` on your laptop. The page is as fresh
  as your last run.
- **It never touches your working tree.** The commit is built with git plumbing, so
  `STATUS.md` exists only on the `status` branch and never appears in your main
  branch's tree or your `git status`.
- **Make the repo private if the lane names, task titles, or spend figures
  shouldn't be public.** This page publishes all three.

Tuning:

```bash
STATUS_BRANCH=agent-status   # different branch name
STATUS_DEBOUNCE=300          # at most one commit per 5 min
```

## Starting everything at once

```bash
./bin/start
```

Starts the dev server, the live dashboard, and the spend tracker together. Uses
tmux if you have it (one session, two windows); on macOS without tmux it opens a
new Terminal/iTerm tab for the dev server; anywhere else it backgrounds the dev
server to `.claude/state/dev.log` and runs the dashboard in your current tab.

Does not start the orchestrator — that's an interactive session, so start it
yourself in whichever tab you want to actually work in: `./bin/lane <lane>`.

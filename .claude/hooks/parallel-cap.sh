#!/bin/bash
# parallel-cap.sh — PreToolUse hook on Agent dispatch. Denies a new subagent
# dispatch once too many are already running.
#
# Worktrees make true parallel dispatch possible, which is a wall-clock win —
# but it does not change total tokens spent on a backlog, it changes the RATE
# they're spent at. Against a capped pool (subscription usage limits, or a
# monthly programmatic credit with no rollover), burning faster empties the
# cap faster in less time. This hook is the rate limiter for that, independent
# of the dollar-based spend-cap.sh, which only limits total spend, not pace.
#
# Two caps, both enforced against the SAME paired live count:
#   MAX_PARALLEL_BUILDERS / MAX_PARALLEL (default 2) — concurrent builder-tier
#   MAX_PARALLEL_TOTAL                   (default 6) — concurrent subagents, any type
#
# Why a total cap and not just builders: capping builder dispatch only assumes
# reviewers and publishers are 1:1 follow-ons to a builder finishing and so
# cannot outnumber them. That is wrong under parallel dispatch — every builder
# that finishes spawns its own reviewer, and the orchestrator syncs the
# publisher on every task state change, so both accumulate independently of the
# builder cap. This repo reached ten concurrent reviewers while only two
# builders ran.
#
# ---------------------------------------------------------------------------
# COUNTING: pair by agent_id, NEVER group by agent_type.
#
# The harness emits two structurally different SubagentStop records:
#   (a) well-formed  — agent_type populated, agent_id equal to its SubagentStart
#   (b) degenerate   — agent_type "" (empty string, not null), logged once per
#                      registered matcher, with an agent_id that matches no
#                      SubagentStart in the log at all
#
# An earlier version did group_by(.agent_type). Every (b) record therefore
# landed in the "" bucket where it could never cancel a start in the "reviewer"
# or "builder" bucket, so the per-type count only ever ROSE. The cap wedged
# permanently with zero agents running and had to be cleared by hand-rotating
# events.jsonl, three sessions running. Note that a `.agent_type != null` guard
# does NOT help: the field is present and empty, not null, so it passes.
#
# Pairing on agent_id is immune to all of that — it never reads a field the
# harness leaves empty. Consequently:
#   - an agent's TYPE is resolved from its SubagentStart record only. agent_type
#     is never read off a stop record for any purpose.
#   - a start whose own agent_type is "" or absent is unreadable, so it counts
#     toward the TOTAL cap but not the builder cap. Fail closed, same as absent.
#   - starts logged twice for one agent_id are one agent, and any stop for that
#     agent_id retires it.
# ---------------------------------------------------------------------------

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
EVENTS="$ROOT/.claude/state/events.jsonl"

# MAX_PARALLEL_BUILDERS wins over MAX_PARALLEL. The specific name beats the
# general one; MAX_PARALLEL is kept only for back-compat with existing exports
# and with the deny message operators already recognise.
MAX_BUILDERS="${MAX_PARALLEL_BUILDERS:-${MAX_PARALLEL:-2}}"
MAX_TOTAL="${MAX_PARALLEL_TOTAL:-6}"

input=$(cat 2>/dev/null)
command -v jq >/dev/null 2>&1 || exit 0

deny() {
  jq -n --arg msg "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $msg
    }
  }'
  exit 0
}

# A non-numeric or non-positive limit must never resolve to an allow. The
# finding permitted "deny or use a safe default"; denying is chosen because a
# safe default still allows the dispatch whenever the count happens to be under
# it, which is exactly the silent fail-open this hook exists to prevent.
is_positive_int() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) [ "$1" -gt 0 ] ;;
  esac
}
is_positive_int "$MAX_BUILDERS" || deny "parallel-cap: builder limit is not a positive integer (got '$MAX_BUILDERS'). Refusing to dispatch rather than run uncapped. Fix MAX_PARALLEL_BUILDERS or MAX_PARALLEL."
is_positive_int "$MAX_TOTAL"    || deny "parallel-cap: MAX_PARALLEL_TOTAL is not a positive integer (got '$MAX_TOTAL'). Refusing to dispatch rather than run uncapped."

[ -s "$EVENTS" ] || exit 0

# A builder cannot legitimately run for an hour, so only count a start as
# "running" if it has no matching stop AND it is younger than this cutoff. An
# unpaired start older than the cutoff is a crash artifact (the agent died
# without emitting a stop), not a running agent, so it is excluded. This is
# what stops a crashed agent wedging the cap forever.
STALE_AFTER_SECONDS=3600
cutoff_epoch=$(( $(date -u +%s) - STALE_AFTER_SECONDS ))

# Read the log LINE BY LINE and drop unparseable lines, rather than `jq -s`
# slurping it as a JSON stream. Parallel agents append to this file
# concurrently and async, so a torn or interleaved line is plausible rather
# than theoretical. Under a slurp, one bad byte anywhere fails the whole parse,
# `running` falls back to 0, and the cap fails OPEN — unbounded parallel
# dispatch, which costs real money. Reading with -R makes the file itself
# always parseable (it is just text) and confines the damage of a torn line to
# that one event.
counts=$(jq -Rsr --argjson cutoff "$cutoff_epoch" '
  # Keep two tallies: how many lines held actual content, and how many of those
  # parsed as JSON objects. If content lines exist but NONE parsed, the file is
  # wholly corrupt rather than merely torn, and the count below would be a
  # meaningless 0 that silently allows. That case is denied further down.
  ( [ split("\n")[] | select(. != "" and (test("^[[:space:]]*$") | not)) ] | length ) as $content_lines
  | ( [ split("\n")[] | (fromjson? // empty) | select(type == "object") ] ) as $records
  | ( $records
      | map(select(.event == "SubagentStart" or .event == "SubagentStop"))
      | map(select(.agent_id != null and .agent_id != ""))
    )
  | group_by(.agent_id)
  | [ .[]
      | (map(select(.event == "SubagentStart")) | sort_by(.ts // "")) as $starts
      | (map(select(.event == "SubagentStop"))) as $stops
      # An agent is live only if it started and has no stop of any kind. Stops
      # are matched purely on agent_id, so a stop carrying agent_type "" still
      # retires the agent it belongs to. Orphan stops (no start for that id)
      # are not live agents and contribute nothing.
      | select(($starts | length) > 0 and ($stops | length) == 0)
      | ($starts[0].ts // null) as $start_ts
      | (if $start_ts == null then null
         else ($start_ts | try fromdateiso8601 catch null) end) as $start_epoch
      # Fail-safe: a start with no usable timestamp (missing/null/unparseable)
      # is treated as stale, not running. Counting it as running forever would
      # let one bad record jam the cap permanently with no way to age out;
      # treating it as stale instead means the cap can never get permanently
      # stuck, at the cost of (rarely) undercounting a genuinely running agent
      # whose start record lacks a usable ts.
      | select(if $start_epoch == null then false else $start_epoch >= $cutoff end)
      # Type comes from the START record only, never from a stop.
      | { t: ($starts[0].agent_type // "") }
    ]
  | { total: length,
      builders: ( [ .[] | select(.t == "builder-light" or .t == "builder" or .t == "builder-deep") ] | length ) }
  | "\(.total) \(.builders) \($content_lines) \($records | length)"
' "$EVENTS" 2>/dev/null)

# Whole-file read/parse failure (unreadable file, jq internal error). Fail
# closed: deny rather than allow. An allow here is the fail-open that motivated
# this task; a deny is merely a retry.
if [ -z "$counts" ]; then
  deny "parallel-cap: could not read $EVENTS to count running subagents. Refusing to dispatch rather than run uncapped."
fi

set -- $counts
total="${1:-}"
builders="${2:-}"
content_lines="${3:-}"
parsed_records="${4:-}"

# Non-empty file in which nothing at all parsed: treat as whole-file corruption
# and fail closed. A genuinely empty log is already handled by the -s test
# above and still allows, so routine log rotation does not jam dispatch.
if [ "${content_lines:-0}" -gt 0 ] 2>/dev/null && [ "${parsed_records:-0}" -eq 0 ] 2>/dev/null; then
  deny "parallel-cap: $EVENTS has $content_lines line(s) but none parsed as JSON. Refusing to dispatch rather than run uncapped."
fi
# Coercing an unreadable count to 0 would ALLOW, which is the same fail-open as
# a failed slurp. Deny instead: if the counter cannot be trusted, neither can
# the cap.
is_count() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
if ! is_count "$total" || ! is_count "$builders"; then
  deny "parallel-cap: could not parse the running-subagent count (got '$counts'). Refusing to dispatch rather than run uncapped."
fi

# The total cap applies to every dispatch regardless of type, so it holds even
# when the agent type cannot be read out of the payload at all.
if [ "$total" -ge "$MAX_TOTAL" ]; then
  deny "$total subagents already running — MAX_PARALLEL_TOTAL=$MAX_TOTAL. Wait for some to finish. Raise it by exporting MAX_PARALLEL_TOTAL before ./bin/lane."
fi

# Try the plausible keys rather than betting on one — the key moved with the
# Task -> Agent tool rename. An empty result is NOT treated as "not a builder"
# and does not allow: it falls through to the total cap already checked above.
subagent=$(printf '%s' "$input" | jq -r '
  .tool_input.subagent_type
  // .tool_input.agent_type
  // .tool_input.agent
  // .tool_input.type
  // empty' 2>/dev/null)

case "$subagent" in
  builder-light|builder|builder-deep)
    if [ "$builders" -ge "$MAX_BUILDERS" ]; then
      deny "$builders builder(s) already running — MAX_PARALLEL=$MAX_BUILDERS. Wait for one to finish before dispatching another. Override by exporting MAX_PARALLEL before ./bin/lane if you want more concurrent burn."
    fi
    ;;
esac

exit 0

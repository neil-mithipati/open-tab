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

# jq is load-bearing for every check below. Allowing when it is absent would be
# the same fail-open this hook exists to prevent: unbounded parallel dispatch,
# just triggered by a missing binary instead of a bad log line. Deny instead,
# and build the JSON by hand since deny() itself needs jq and cannot be used
# here.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"parallel-cap: jq is not installed, so this hook cannot count running subagents. Refusing to dispatch rather than run uncapped. Install jq to restore parallel-dispatch limits."}}'
  exit 0
fi

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

# `[ -e ]` reports "absent" both when the log genuinely does not exist and when
# a directory on the way to it denies search — a chmod 000 on .claude/state is
# enough. Reproduced with two live builders: the hook allowed, cap unenforced.
# That is the same fail-open as an unreadable log one level down, so check the
# ancestors first. Order matters: each -e test is only meaningful because every
# earlier directory already passed -x.
for dir in "$ROOT" "$ROOT/.claude" "$ROOT/.claude/state"; do
  if [ -e "$dir" ] && [ ! -x "$dir" ]; then
    deny "parallel-cap: $dir exists but is not searchable, so $EVENTS cannot be read to count running subagents. Refusing to dispatch rather than run uncapped."
  fi
done

# No log yet is the ordinary "nothing has run" state, not a failure — allow so
# a fresh checkout or a rotated-away file doesn't jam the very first dispatch.
# Reached only once the path to it is known to be traversable, so "absent" here
# really means absent.
[ -e "$EVENTS" ] || exit 0

# EVENTS must be a regular, readable file before jq ever touches it. `jq -Rsr`
# on a path it cannot open (permission-denied, or a directory sitting where the
# log should be) does not fail usefully: measured, it prints a full line of
# zeros ("0 0 0 0 0 0 ") to stdout and exits 2. That output is NON-EMPTY, so
# `[ -z "$counts" ]` never fires, and content_lines reads as 0, which SKIPS the
# corruption guard too. Against HEAD's hook this was a silent ALLOW with two
# live builders — reproduced, both for chmod 000 and for a directory in place
# of the log. So: this check is what covers the "unreadable file" case, the
# corruption guard below does not, and the jq exit-status guard below is the
# second line of defence rather than the first.
if [ ! -f "$EVENTS" ] || [ ! -r "$EVENTS" ]; then
  deny "parallel-cap: $EVENTS exists but is not a readable regular file (permission denied, or a directory in its place). Refusing to dispatch rather than run uncapped."
fi

[ -s "$EVENTS" ] || exit 0

# A builder cannot legitimately run for an hour, so only count a start as
# "running" if it has no matching stop AND it is younger than this cutoff. An
# unpaired start older than the cutoff is a crash artifact (the agent died
# without emitting a stop), not a running agent, so it is excluded. This is
# what stops a crashed agent wedging the cap forever.
STALE_AFTER_SECONDS=3600
now_epoch=$(date -u +%s)
cutoff_epoch=$(( now_epoch - STALE_AFTER_SECONDS ))

# Read the log LINE BY LINE and drop unparseable lines, rather than `jq -s`
# slurping it as a JSON stream. Parallel agents append to this file
# concurrently and async, so a torn or interleaved line is plausible rather
# than theoretical. Under a slurp, one bad byte anywhere fails the whole parse,
# `running` falls back to 0, and the cap fails OPEN — unbounded parallel
# dispatch, which costs real money. Reading with -R makes the file itself
# always parseable (it is just text) and confines the damage of a torn line to
# that one event.
counts=$(jq -Rsr --argjson cutoff "$cutoff_epoch" --argjson now "$now_epoch" '
  # Keep two tallies: how many lines held actual content, and how many of those
  # parsed as JSON objects. If content lines exist but NONE parsed, the file is
  # wholly corrupt rather than merely torn, and the count below would be a
  # meaningless 0 that silently allows. That case is denied further down.
  ( [ split("\n")[] | select(. != "" and (test("^[[:space:]]*$") | not)) ] | length ) as $content_lines
  | ( [ split("\n")[] | (fromjson? // empty) | select(type == "object") ] ) as $records
  # Visibility, not enforcement: a SubagentStart missing agent_id is dropped
  # before pairing (it cannot be matched to anything) and one missing ts is
  # excluded later as stale (see the fail-safe below). Both used to be silent.
  # Neither count changes the cap decision; they are surfaced so a maintainer
  # can see agents going uncounted instead of discovering it as a mystery gap.
  | ( $records | map(select(.event == "SubagentStart"))
      | map(select(.agent_id == null or .agent_id == "")) | length
    ) as $missing_agent_id_starts
  | ( $records | map(select(.event == "SubagentStart"))
      | map(select(.agent_id != null and .agent_id != "" and (.ts == null or .ts == "")))
      | length
    ) as $missing_ts_starts
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
      | { id: $starts[0].agent_id, t: ($starts[0].agent_type // ""), age: ($now - $start_epoch) }
    ]
  | { total: length,
      builders: ( [ .[] | select(.t == "builder-light" or .t == "builder" or .t == "builder-deep") ] | length ),
      # Diagnostic only, never read for a decision. Emitted as one space-free
      # token so the shell word-split below stays positional.
      inventory: ( [ .[] | "\(.id):\(.t // "?"):\(.age | floor)s" ] | join(",") ) }
  | "\(.total) \(.builders) \($content_lines) \($records | length) \($missing_agent_id_starts) \($missing_ts_starts) \(.inventory)"
' "$EVENTS" 2>/dev/null)
jq_rc=$?

# The unreadable-file / directory-in-place-of-the-log case is caught earlier, by
# the explicit -f/-r check, and does not rely on this guard: jq's stdout there is
# the non-empty "0 0 0 0 0 0 ", which would sail past `[ -z "$counts" ]` and read
# as "0 running", i.e. ALLOW. Its exit status of 2 does reach here, so this is a
# genuine backstop for that case, but a backstop only — do not delete the -f/-r
# check on the strength of it. What this primarily guards is any OTHER
# whole-invocation jq failure (an internal error, a program bug): same class,
# different cause. Fail closed on either a non-zero exit or empty output. An
# allow here is the fail-open that motivated this task; a deny is merely a retry.
if [ "$jq_rc" -ne 0 ] || [ -z "$counts" ]; then
  deny "parallel-cap: could not read $EVENTS to count running subagents (jq exit $jq_rc). Refusing to dispatch rather than run uncapped."
fi

set -- $counts
total="${1:-}"
builders="${2:-}"
content_lines="${3:-}"
parsed_records="${4:-}"
missing_agent_id_starts="${5:-0}"
missing_ts_starts="${6:-0}"
live_inventory="${7:-}"

# Log, don't silently drop. Neither of these changes the cap decision — see
# the jq comments above for why each is excluded — but a maintainer should be
# able to see agents going uncounted instead of finding it as a mystery gap.
case "$missing_agent_id_starts" in
  ''|*[!0-9]*) : ;;
  0) : ;;
  *) echo "parallel-cap: warning: $missing_agent_id_starts SubagentStart record(s) in $EVENTS are missing agent_id and cannot be paired or counted toward any cap." >&2 ;;
esac
case "$missing_ts_starts" in
  ''|*[!0-9]*) : ;;
  0) : ;;
  *) echo "parallel-cap: warning: $missing_ts_starts SubagentStart record(s) in $EVENTS are missing ts; if unpaired by a stop, they are treated as stale rather than running." >&2 ;;
esac

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

# Say WHICH agents are being counted whenever a cap denies. An agent killed by
# a turn limit emits no SubagentStop, so its start stays unpaired and holds a
# slot until the staleness cutoff ages it out — a denial that looks identical to
# the counter-drift bug that cost three sessions. This does not change the
# decision or the deny message; it just means the next reader can tell a phantom
# from a genuinely running agent by its age instead of re-diagnosing the hook.
# Not a fix for the phantom itself: nothing in the log distinguishes a dead
# agent from a live one, so that needs its own task.
warn_live_inventory() {
  [ -n "$live_inventory" ] || return 0
  echo "parallel-cap: counted as running (agent_id:type:age-since-start). Each of these has a SubagentStart and no SubagentStop; if one has not actually been running that long, it died without logging a stop and holds a slot until the ${STALE_AFTER_SECONDS}s cutoff:" >&2
  printf '%s\n' "$live_inventory" | tr ',' '\n' | sed 's/^/parallel-cap:   /' >&2
}

# The total cap applies to every dispatch regardless of type, so it holds even
# when the agent type cannot be read out of the payload at all.
if [ "$total" -ge "$MAX_TOTAL" ]; then
  warn_live_inventory
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
      warn_live_inventory
      deny "$builders builder(s) already running — MAX_PARALLEL=$MAX_BUILDERS. Wait for one to finish before dispatching another. Override by exporting MAX_PARALLEL before ./bin/lane if you want more concurrent burn."
    fi
    ;;
esac

exit 0

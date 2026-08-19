#!/bin/bash
# parallel-cap.sh — PreToolUse hook on Agent dispatch. Denies a new builder-tier
# dispatch once MAX_PARALLEL are already running.
#
# Worktrees make true parallel dispatch possible, which is a wall-clock win —
# but it does not change total tokens spent on a backlog, it changes the RATE
# they're spent at. Against a capped pool (subscription usage limits, or a
# monthly programmatic credit with no rollover), burning faster empties the
# cap faster in less time. This hook is the rate limiter for that, independent
# of the dollar-based spend-cap.sh, which only limits total spend, not pace.
#
# Only counts builder-light/builder/builder-deep — reviewer and publisher are
# 1:1 follow-ons to a builder finishing, not the thing driving parallelism.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
EVENTS="$ROOT/.claude/state/events.jsonl"
MAX_PARALLEL="${MAX_PARALLEL:-2}"

input=$(cat 2>/dev/null)
command -v jq >/dev/null 2>&1 || exit 0

subagent=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)
case "$subagent" in
  builder-light|builder|builder-deep) ;;
  *) exit 0 ;;   # not a builder dispatch — reviewer, publisher, etc. are uncapped here
esac

[ -s "$EVENTS" ] || exit 0

# A builder cannot legitimately run for an hour, so pair SubagentStart to
# SubagentStop by agent_id and only count a start as "running" if it has no
# matching stop AND it is younger than this cutoff. An unpaired start older
# than the cutoff is a crash artifact (the agent died without emitting a
# stop), not a running builder, so it is excluded from the count.
STALE_AFTER_SECONDS=3600
cutoff_epoch=$(( $(date -u +%s) - STALE_AFTER_SECONDS ))

running=$(jq -rs --argjson cutoff "$cutoff_epoch" '
  map(select(.event == "SubagentStart" or .event == "SubagentStop")
      | select(.agent_type == "builder-light" or .agent_type == "builder" or .agent_type == "builder-deep"))
  | group_by(.agent_id)
  | [ .[] |
      (map(select(.event == "SubagentStart")) | sort_by(.ts)) as $starts
      | (map(select(.event == "SubagentStop"))) as $stops
      # only unpaired agent_ids (a start with no matching stop) are candidates
      | select(($starts | length) > 0 and ($stops | length) == 0)
      | ($starts[0].ts // null) as $start_ts
      | (if $start_ts == null then null
         else ($start_ts | try fromdateiso8601 catch null) end) as $start_epoch
      # Fail-safe: a start with no usable timestamp (missing/null/unparseable)
      # is treated as stale, not running. Counting it as running forever would
      # let one bad record jam the cap permanently with no way to age out;
      # treating it as stale instead means the cap can never get permanently
      # stuck, at the cost of (rarely) undercounting a genuinely running
      # builder whose start record lacks a usable ts.
      | select(if $start_epoch == null then false else $start_epoch >= $cutoff end)
    ]
  | length
' "$EVENTS" 2>/dev/null)
case "$running" in ''|*[!0-9-]*) running=0 ;; esac
[ "$running" -lt 0 ] && running=0

if [ "$running" -ge "$MAX_PARALLEL" ]; then
  jq -n --arg r "$running" --arg m "$MAX_PARALLEL" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("\($r) builder(s) already running — MAX_PARALLEL=\($m). Wait for one to finish before dispatching another. Override by exporting MAX_PARALLEL before ./bin/lane if you want more concurrent burn.")
    }
  }'
  exit 0
fi

exit 0

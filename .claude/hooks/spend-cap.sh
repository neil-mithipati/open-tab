#!/bin/bash
# PreToolUse:Agent|Bash|Edit|Write — the only gate the owner asked for.
#
# Reads a rolling total written by spend-poll.sh. It cannot query the metrics
# endpoint directly: OTEL_* variables are stripped from hook subprocesses, and an
# HTTP round trip on every tool call would be too slow.

set -u
STATE="${CLAUDE_PROJECT_DIR}/.claude/state/spend.json"
BUDGET="${CLAUDE_PROJECT_DIR}/.claude/budget.json"
LANE="${LANE:-default}"

# Fail open on a missing total, fail closed on a missing budget. A lane with no
# declared budget should not be running unsupervised.
[ -f "$STATE" ] || exit 0

if [ ! -f "$BUDGET" ]; then
  echo "No budget declared at .claude/budget.json. Refusing to proceed uncapped." >&2
  exit 2
fi

cap=$(jq -r --arg l "$LANE" '.lanes[$l] // .default // 0' "$BUDGET")
spent=$(jq -r --arg l "$LANE" '.lanes[$l] // 0' "$STATE")

over=$(awk -v s="$spent" -v c="$cap" 'BEGIN { print (c > 0 && s >= c) ? 1 : 0 }')

if [ "$over" = "1" ]; then
  jq -n --arg reason "Spend cap reached for lane '$LANE': \$$spent of \$$cap. Raise the cap in .claude/budget.json or close out the task." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

# Warn at 80% so the orchestrator can wind down rather than hit a wall mid-task.
warn=$(awk -v s="$spent" -v c="$cap" 'BEGIN { print (c > 0 && s >= c*0.8) ? 1 : 0 }')
if [ "$warn" = "1" ]; then
  jq -n --arg msg "Lane '$LANE' at \$$spent of \$$cap. Wind down: finish the current task, do not start another." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: $msg
    }
  }'
fi

exit 0

#!/bin/bash
# parallel-cap.sh — PreToolUse hook on Agent dispatch. Denies a new subagent
# dispatch once too many are already running.
#
# Two caps, both enforced:
#   MAX_PARALLEL_BUILDERS (default 2) — concurrent builder-tier agents
#   MAX_PARALLEL_TOTAL    (default 6) — concurrent subagents of any type
#
# Why a total cap and not just builders: the earlier version capped builder
# dispatch only, on the theory that reviewers and publishers are 1:1 follow-ons
# to a builder finishing and so cannot outnumber them. That theory is wrong
# under parallel dispatch — every builder that finishes spawns its own reviewer,
# and the orchestrator syncs the publisher on every task state change, so both
# accumulate independently of the builder cap. A real repo reached ten
# concurrent reviewers and ten publishers while only two builders ran.
#
# FIELD NAME ROBUSTNESS: the agent type arrives inside tool_input, but the exact
# key has changed with the Task -> Agent tool rename and is not something to
# guess at. Several candidates are tried, and — critically — if none matches,
# this hook falls back to the TOTAL cap rather than allowing the dispatch. The
# previous version read one guessed key and silently allowed everything when it
# was absent, which is a cap that looks present and does nothing. Fail closed.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
EVENTS="$ROOT/.claude/state/events.jsonl"
MAX_BUILDERS="${MAX_PARALLEL_BUILDERS:-2}"
MAX_TOTAL="${MAX_PARALLEL_TOTAL:-6}"

input=$(cat 2>/dev/null)
command -v jq >/dev/null 2>&1 || exit 0
[ -s "$EVENTS" ] || exit 0

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

deny() {
  local reason="$1" out
  # Captured, not streamed — see deny-irreversible.sh for why this matters.
  # A broken jq here means this cap silently allows everything instead of
  # denying, which is the opposite of what a cap is for.
  out=$(jq -n --arg msg "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $msg
    }
  }' 2>/dev/null)
  if [ -z "$out" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' \
      "$(json_escape "$reason")"
  else
    printf '%s\n' "$out"
  fi
  exit 0
}

# How many subagents of each kind are live right now, from the event log.
#
# A start older than STALE_SECS with no matching stop is EXCLUDED from the
# count, not just "old". This matters because of a real gap in Claude Code
# itself: an agent that hits its own maxTurns limit is killed without ever
# firing SubagentStop. That is not a hook bug on either side — there is
# nothing to catch, because the event that would normally fire simply does
# not happen for that termination path. Without an expiry, one turn-limited
# agent permanently occupies a slot against MAX_PARALLEL_TOTAL for the rest
# of the session. The default window is generous (1 hour) because a real
# builder-deep task can legitimately run long; this is a backstop against a
# permanent leak, not a tight timeout.
STALE_SECS="${STALE_SECS:-3600}"

# LIVENESS IS SHARED. The pairing rule, heartbeat death detection, and stale
# backstop live in liveness.sh, sourced by this hook and every display
# surface (dashboard, statusline, status page). When enforcement and display
# used separate copies of this logic, they drifted: the cap freed a dead
# agent's slot while the dashboard showed it running for another hour.
. "${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks/liveness.sh" 2>/dev/null || {
  # FAIL CLOSED. Without the shared liveness rule the cap cannot count, and
  # an uncountable fleet must not become an uncapped one. This fires only on
  # a broken install — liveness.sh ships in add-fleet's sync list.
  deny "parallel-cap cannot load .claude/hooks/liveness.sh — the install is incomplete. Re-run add-fleet and ./bin/doctor before dispatching agents."
}
fleet_live_json "$EVENTS"
counts=$(printf '%s' "$LIVE_JSON" | jq -c 'map({ t: .type, n: .running })' 2>/dev/null)
[ -z "$counts" ] && exit 0

total=$(printf '%s' "$counts" | jq -r 'map(.n) | add // 0')
builders=$(printf '%s' "$counts" | jq -r '
  map(select(.t == "builder-light" or .t == "builder" or .t == "builder-deep"))
  | map(.n) | add // 0')
case "$total"    in ''|*[!0-9]*) total=0 ;; esac
case "$builders" in ''|*[!0-9]*) builders=0 ;; esac

# Total cap applies to every dispatch regardless of type, so it holds even when
# the agent type cannot be read out of the payload at all.
if [ "$total" -ge "$MAX_TOTAL" ]; then
  deny "$total subagents already running — MAX_PARALLEL_TOTAL=$MAX_TOTAL. Wait for some to finish. Raise it by exporting MAX_PARALLEL_TOTAL before ./bin/lane."
fi

# Try the plausible keys rather than betting on one. An empty result is not
# treated as "not a builder" — it falls through to the total cap above, which
# has already been checked.
subagent=$(printf '%s' "$input" | jq -r '
  .tool_input.subagent_type
  // .tool_input.agent_type
  // .tool_input.agent
  // .tool_input.type
  // empty' 2>/dev/null)

case "$subagent" in
  builder-light|builder|builder-deep)
    if [ "$builders" -ge "$MAX_BUILDERS" ]; then
      deny "$builders builder(s) already running — MAX_PARALLEL_BUILDERS=$MAX_BUILDERS. Wait for one to finish. Raise it by exporting MAX_PARALLEL_BUILDERS before ./bin/lane."
    fi
    ;;
esac

exit 0

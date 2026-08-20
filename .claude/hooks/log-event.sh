#!/bin/bash
# SubagentStart | SubagentStop | TaskCreated | TaskCompleted — append-only event log.
# Runs async so it never adds latency. This file is the status page's source; spend
# comes from the metrics endpoint separately.
#
# $1 (optional) — the agent type name, supplied by the hook matcher.
#
# Why the argument exists: SubagentStart and SubagentStop fire in the MAIN session,
# not inside the subagent. Only events running inside a subagent carry agent_id and
# agent_type, so both fields arrive null on these two events. The matcher is the
# only thing that knows which agent stopped, so settings.json registers one group
# per agent name and passes that name in here.

LOG="${CLAUDE_PROJECT_DIR}/.claude/state/events.jsonl"
input=$(cat)

jq -c \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg lane "${LANE:-default}" \
  --arg atype "${1:-}" '{
  ts: $ts,
  lane: $lane,
  event: .hook_event_name,
  session: .session_id,
  agent_id: (.agent_id // null),
  agent_type: (.agent_type // (if $atype == "" then null else $atype end)),
  cwd: .cwd
}' <<<"$input" >> "$LOG" 2>/dev/null

exit 0

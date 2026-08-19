#!/bin/bash
# SubagentStart | SubagentStop | TaskCreated | TaskCompleted — append-only event log.
# Runs async so it never adds latency. This file is the status page's source; spend
# comes from the metrics endpoint separately.
#
# $1 (optional) — the agent type name, supplied by the hook matcher.
#
# Why the argument exists: SubagentStart and SubagentStop fire in the MAIN session,
# not inside the subagent, so agent_TYPE is unreliable on them. It arrives populated
# on SubagentStart, but on SubagentStop it is frequently the empty string "". The
# matcher is the only thing that reliably knows which agent it was, so settings.json
# registers one group per agent name and passes that name in here as $1.
#
# agent_ID, by contrast, DOES arrive populated on both events — an older version of
# this comment claimed it "arrives null", which is false. Do not "clean up" the
# agent_id field on the strength of that: parallel-cap.sh pairs SubagentStart to
# SubagentStop *by agent_id* to decide how many subagents are live, precisely
# because agent_type cannot be trusted on a stop record. Dropping or blanking
# agent_id silently breaks the parallel cap — starts would never be cancelled and
# the count would rise forever, wedging all dispatch.
#
# Note also that jq's `//` treats "" as truthy, so a payload agent_type of ""
# short-circuits and $1 is NOT substituted. That is why some stop records land with
# agent_type "". parallel-cap.sh treats "" as unreadable and never reads a type off
# a stop record at all, so this does not affect the cap.

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

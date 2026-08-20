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

#
# ---------------------------------------------------------------------------
# HEARTBEAT MODE (`--heartbeat` as $1), registered on PostToolUse.
#
# An agent killed by its turn limit emits NO SubagentStop. Verified in the
# harness binary (2.1.236): the query loop returns {reason:"max_turns"} without
# invoking the Stop/SubagentStop executor, and runAgent's finally-block fallback
# is guarded by a flag that the max-turns break has already set, so it declines
# to fire one. There is no other terminal event either — the full registrable
# hook list contains no turn-limit event, and StopFailure fires only for
# api_error / prompt_too_long / malformed_tool_use_exhausted, not max_turns.
#
# So the start stays unpaired and parallel-cap.sh counts the dead agent as live
# for the full hour of its staleness cutoff. Three occurrences, each cleared by
# hand-appending a stop. The log could not distinguish live from dead because it
# holds only starts and stops: no activity record, and `session` is the shared
# parent id, identical for both.
#
# This mode emits that missing signal. Every tool call an agent completes
# refreshes a one-line file at .claude/state/heartbeats/<agent_id>, so "no
# activity for N minutes" becomes answerable. Notes on the shape:
#
#   - One file per agent, OVERWRITTEN, not an append-only log. Constant size
#     regardless of how many tool calls run, and it keeps events.jsonl itself
#     untouched, so dashboard/status-page/audit see no new records at all.
#   - Throttled to one write per agent per minute, not per tool call.
#   - Written to a temp file and renamed, so a reader never sees a torn line.
#   - Skipped entirely when agent_id is absent, which is the main session. Only
#     subagents can hold a cap slot, so only subagents need a heartbeat.
#   - agent_id is used as a filename, so anything outside [A-Za-z0-9_-] is
#     refused rather than sanitised. A refused id simply produces no heartbeat,
#     which parallel-cap.sh reads as "no data" and falls back to its existing
#     behaviour. Every failure here degrades to what the hook did before.
#
# The file is removed when the agent logs a real SubagentStop, and files left by
# agents that never did are pruned after a day.
# ---------------------------------------------------------------------------

LOG="${CLAUDE_PROJECT_DIR}/.claude/state/events.jsonl"
HB_DIR="${CLAUDE_PROJECT_DIR}/.claude/state/heartbeats"
HB_MIN_INTERVAL_SECONDS=60

if [ "${1:-}" = "--heartbeat" ]; then
  agent_id=$(jq -r '.agent_id // ""' 2>/dev/null <<<"$(cat)")
  case "$agent_id" in
    ''|*[!A-Za-z0-9_-]*) exit 0 ;;
  esac
  now=$(date -u +%s)
  hb="$HB_DIR/$agent_id"
  if [ -f "$hb" ]; then
    last=""
    read -r _ _ last <"$hb" 2>/dev/null
    case "$last" in
      ''|*[!0-9]*) last=0 ;;
    esac
    [ "$(( now - last ))" -ge "$HB_MIN_INTERVAL_SECONDS" ] || exit 0
  fi
  mkdir -p "$HB_DIR" 2>/dev/null
  tmp="$HB_DIR/.tmp.$$"
  if printf '%s %s %s\n' "$agent_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$now" >"$tmp" 2>/dev/null; then
    mv -f "$tmp" "$hb" 2>/dev/null || rm -f "$tmp" 2>/dev/null
  fi
  exit 0
fi

input=$(cat)

record=$(jq -c \
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
}' 2>/dev/null <<<"$input")

[ -n "$record" ] || exit 0
printf '%s\n' "$record" >> "$LOG" 2>/dev/null

# An agent that stopped properly has no use for a heartbeat: it is paired in the
# log and can never be counted live again. Drop its file, and opportunistically
# prune the ones left behind by agents that never stopped.
case "$record" in
  *'"event":"SubagentStop"'*)
    stopped_id=$(jq -r '.agent_id // ""' 2>/dev/null <<<"$record")
    case "$stopped_id" in
      ''|*[!A-Za-z0-9_-]*) : ;;
      *) rm -f "$HB_DIR/$stopped_id" 2>/dev/null ;;
    esac
    find "$HB_DIR" -type f -mtime +1 -delete 2>/dev/null
    ;;
esac

exit 0

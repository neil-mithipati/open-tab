#!/bin/bash
# liveness.sh — the single definition of "which agents are live right now."
#
# Sourced by parallel-cap.sh (enforcement), bin/dashboard, statusline.sh, and
# status-page.sh (display). One rule, four surfaces: when these disagreed, the
# dashboard showed a builder running while the orchestrator sat idle waiting
# for input. Any change to liveness happens here or it happens nowhere.
#
# An unpaired SubagentStart (no SubagentStop sharing its agent_id) is live
# unless one of these proves it dead:
#
#   1. STALE HEARTBEAT — its heartbeat file is older than HB_DEAD_SECS (15m
#      default). The agent stopped making tool calls long ago.
#   2. MISSING HEARTBEAT after HB_GRACE (180s default), and only when the
#      heartbeat mechanism is provably enabled (.enabled stamp — see
#      log-event.sh). Covers the lost-stop case: the stop event never logged
#      but the heartbeat file was already cleaned up, which used to leave a
#      ghost "running" for the full stale window. Gating on the stamp means
#      a broken heartbeat pipeline cannot fake an empty fleet.
#   3. STALE TIMESTAMP — the start is older than STALE_SECS (1h default) with
#      no heartbeat evidence either way. Backstop for starts with no
#      agent_id, which can never be paired.
#
# A FRESH heartbeat proves life and overrides rule 3 — a builder-deep past
# the 1-hour window with a live heartbeat is running, not stale.
#
# fleet_live_json EVENTS_FILE
#   sets LIVE_JSON to a compact array of {type, lane, started, running},
#   one entry per agent type with running > 0. "[]" on any failure.

fleet_live_json() {
  LIVE_JSON="[]"
  local events="$1"
  [ -s "$events" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local root="${CLAUDE_PROJECT_DIR:-$PWD}"
  local hb_dir="$root/.claude/state/heartbeats"
  local hb_dead="${HB_DEAD_SECS:-900}"
  local hb_grace="${HB_GRACE:-180}"
  local stale="${STALE_SECS:-3600}"
  local now; now=$(date -u +%s)

  local hb_active=0
  [ -f "$hb_dir/.enabled" ] && hb_active=1

  local dead_list="" alive_list="" f id epoch
  if [ -d "$hb_dir" ]; then
    for f in "$hb_dir"/*; do
      [ -f "$f" ] || continue
      id=""; epoch=""
      read -r id _ epoch <"$f" 2>/dev/null
      case "$id" in ''|*[!A-Za-z0-9_-]*) continue ;; esac
      case "$epoch" in ''|*[!0-9]*) continue ;; esac
      if [ $(( now - epoch )) -ge "$hb_dead" ]; then
        dead_list="$dead_list$id
"
      else
        alive_list="$alive_list$id
"
      fi
    done
  fi
  local dead_ids alive_ids
  dead_ids=$(printf '%s' "$dead_list"  | jq -R . 2>/dev/null | jq -sc 'map(select(length > 0))' 2>/dev/null)
  alive_ids=$(printf '%s' "$alive_list" | jq -R . 2>/dev/null | jq -sc 'map(select(length > 0))' 2>/dev/null)
  case "$dead_ids"  in \[*\]) : ;; *) dead_ids="[]"  ;; esac
  case "$alive_ids" in \[*\]) : ;; *) alive_ids="[]" ;; esac

  LIVE_JSON=$(jq -rsc \
    --arg now "$now" --arg stale "$stale" \
    --arg hb_active "$hb_active" --arg grace "$hb_grace" \
    --argjson dead "$dead_ids" --argjson alive "$alive_ids" '
    ($now | tonumber) as $now
    | ($stale | tonumber) as $stale
    | ($grace | tonumber) as $grace
    | ($hb_active == "1") as $hb
    | def to_epoch: try (strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) catch 0;
    map(select(.event == "SubagentStart" or .event == "SubagentStop"))
    # Pair starts to stops by agent_id; type comes from the start record,
    # where it is reliable (stops frequently land with agent_type "").
    | (map(select(.event == "SubagentStop") | .agent_id)
       | map(select(. != null and . != "")) | unique) as $stopped
    | map(select(.event == "SubagentStart"))
    | map(select((.agent_id // "") as $aid
        | ($aid == "" or (($stopped | index($aid)) | not))))
    | map(select(
        (.agent_id // "") as $aid
        | ((.ts // "" | to_epoch)) as $e
        | (if $e == 0 then -1 else ($now - $e) end) as $age
        | if $aid != "" and (($alive | index($aid)) != null) then
            true                       # fresh heartbeat proves life
          elif $aid != "" and (($dead | index($aid)) != null) then
            false                      # stale heartbeat proves death
          elif $aid != "" and $hb and $age >= 0 and $age > $grace then
            false                      # heartbeats enabled, none for this id
          else
            $age < 0 or $age < $stale  # no evidence: stale-window backstop
          end
      ))
    | group_by(.agent_type // "unknown")
    | map({
        type:    (.[0].agent_type // "unknown"),
        lane:    (map(.lane) | last),
        started: (map(.ts) | last),
        running: length
      })
    | map(select(.running > 0))
  ' "$events" 2>/dev/null)
  case "$LIVE_JSON" in \[*) : ;; *) LIVE_JSON="[]" ;; esac
  return 0
}

# yaml_field KEY FILE — emit a frontmatter field's value, following >- and |
# block scalars onto their indented continuation lines (joined with spaces).
# The naive `sed -n 's/^key: //p'` used to return the literal ">-" for block
# scalars, which then rendered in the statusline and dashboard as the ask.
yaml_field() {
  awk -v k="$1" '
    BEGIN { fm=0; blk=0; out="" }
    /^---[[:space:]]*$/ { fm++; if (fm>1) exit; next }
    fm==1 {
      if (blk) {
        if ($0 ~ /^[[:space:]]+[^[:space:]]/) { line=$0; sub(/^[[:space:]]+/,"",line); out=out (out?" ":"") line; next }
        else { exit }
      }
      if (index($0, k ":") == 1) {
        val=$0; sub("^" k ":[[:space:]]*", "", val)
        if (val ~ /^[>|][+-]?[[:space:]]*$/) { blk=1; next }
        out=val; exit
      }
    }
    END { print out }
  ' "$2" 2>/dev/null
}

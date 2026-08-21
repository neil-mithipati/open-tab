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
#   2. MISSING HEARTBEAT for longer than both HB_GRACE (180s default) and
#      HB_DEAD_SECS, and only when the heartbeat mechanism is provably enabled
#      (.enabled stamp — see log-event.sh). Covers the lost-stop case: the stop
#      event never logged but the heartbeat file was already cleaned up, which
#      used to leave a ghost "running" for the full stale window. Gating on the
#      stamp means a broken heartbeat pipeline cannot fake an empty fleet.
#      HB_GRACE alone was too short: the first heartbeat is written on the
#      first PostToolUse, so an agent whose first tool call is a test suite has
#      NO heartbeat file at all for as long as that call runs, and was measured
#      dropping out of the count at 200s while very much alive. An agent that
#      has never heartbeated is now given the same silence allowance as one
#      whose heartbeat went stale, which is the fail-closed direction: the cost
#      of holding a dead agent's slot a few minutes longer is a delayed
#      dispatch, and the cost of dropping a live one is an uncapped fleet.
#   3. STALE TIMESTAMP — the start is older than STALE_SECS (1h default) with
#      no heartbeat evidence either way. Backstop for starts with no
#      agent_id, which can never be paired.
#
# A FRESH heartbeat proves life and overrides rule 3 — a builder-deep past
# the 1-hour window with a live heartbeat is running, not stale.
#
# PAIRING IS ORDERED. A SubagentStop only cancels a start it could actually
# belong to: one whose timestamp is at or after the start's. agent_ids are
# reused often enough in practice (short ids, restarted sessions) that a stale
# stop from an earlier agent with the same id used to retire a start that had
# not finished — one uncounted live agent, one slot given away. See the
# pairing block in the jq program for the two directions this can fail and why
# each resolves the way it does.
#
# fleet_live_json EVENTS_FILE [LOG_CONTENT]
#   sets LIVE_JSON to a compact array of {type, lane, started, running},
#   one entry per agent type with running > 0,
#   and LIVE_STATUS to "ok" or "unknown".
#
#   LOG_CONTENT is optional and exists for ONE caller: parallel-cap.sh, which
#   must tally corruption and count live agents from the SAME bytes. When it is
#   supplied, the file is not read here at all. Two reads of a file that
#   parallel agents append to (and that anything may rotate) could disagree,
#   and the disagreement was silent in the dangerous direction: a rotation
#   between the tally and this count produced an empty fleet with status ok,
#   i.e. an allow, while agents were live. Display callers pass one argument
#   and read the file as before.
#
# TWO OUTPUTS, BECAUSE "[]" CANNOT MEAN BOTH THINGS. This used to return "[]"
# on any failure, which is the same value an idle fleet produces. Enforcement
# could not tell "nobody is running" from "I could not tell", so a single
# unparseable line in the log turned parallel-cap.sh off entirely: measured, 2
# live builders plus one torn line ALLOWED. LIVE_STATUS is the distinction.
#
#   ok      — the count is real. An absent, empty or all-parsed log is ok, so
#             a fresh checkout still reports an idle fleet and allows.
#   unknown — jq is missing, jq failed, the result is not the promised shape,
#             or a timing knob is out of range (see liveness_knob_error).
#             LIVE_JSON is still a usable array so display surfaces keep
#             working, but parallel-cap.sh denies on it rather than reading it
#             as idle.
#
# Display surfaces (dashboard, statusline, status page) may ignore LIVE_STATUS.
# Anything that ENFORCES on the count must check it.

# THE TIMING KNOBS GET THE SAME TREATMENT AS THE CAPS. STALE_SECS, HB_DEAD_SECS
# and HB_GRACE decide how long an agent stays counted, so a small value drops
# live agents out of the count exactly as effectively as a broken parse does —
# STALE_SECS=1 empties the fleet and allows, silently. Non-numeric values were
# already survivable (jq's tonumber fails and the whole count reports unknown),
# but valid-but-tiny ones were not caught anywhere. Bounds, not just types:
#
#   STALE_SECS    300..86400  — the backstop for starts that can never be
#                               paired. Under 5 minutes it retires agents that
#                               are plainly still working; over a day it is not
#                               a backstop against a leaked slot at all.
#   HB_DEAD_SECS   60..86400  — silence that proves death. Under a minute, one
#                               long tool call (a test suite) reads as dead.
#   HB_GRACE       30..86400  — allowance before a missing heartbeat counts
#                               against an agent that may not have made its
#                               first tool call yet.
#
# Out of range is a configuration error, not a licence to guess: the count is
# computed with the DEFAULTS so display surfaces keep showing something true-
# ish, and LIVE_STATUS is forced to unknown so enforcement denies instead of
# undercounting. parallel-cap.sh calls liveness_knob_error directly to say
# which knob is wrong.
_liveness_in_range() { # value min max
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  # stderr silenced on the comparison only: a value too large for bash's
  # integers is an error whose exit status already fails the test, but the raw
  # "value too great for base" leaks into the hook's stderr and reads like a
  # crash. The decision is unchanged, only the noise.
  { [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]; } 2>/dev/null
}

# liveness_knob_error — prints nothing and returns 0 when every timing knob is
# usable; prints one line naming the offender and returns 1 otherwise.
liveness_knob_error() {
  if ! _liveness_in_range "${STALE_SECS:-3600}" 300 86400; then
    printf 'STALE_SECS must be a whole number of seconds between 300 and 86400 (got "%s")' "${STALE_SECS:-}"
    return 1
  fi
  if ! _liveness_in_range "${HB_DEAD_SECS:-900}" 60 86400; then
    printf 'HB_DEAD_SECS must be a whole number of seconds between 60 and 86400 (got "%s")' "${HB_DEAD_SECS:-}"
    return 1
  fi
  if ! _liveness_in_range "${HB_GRACE:-180}" 30 86400; then
    printf 'HB_GRACE must be a whole number of seconds between 30 and 86400 (got "%s")' "${HB_GRACE:-}"
    return 1
  fi
  return 0
}

fleet_live_json() {
  LIVE_JSON="[]"
  LIVE_STATUS="unknown"
  local events="${1:-}"
  local have_content=0 content=""
  if [ "$#" -ge 2 ]; then have_content=1; content="$2"; fi

  # A knob out of range never yields "ok", whatever the log says.
  local knob_err=""
  knob_err=$(liveness_knob_error) || :

  if [ "$have_content" -eq 0 ]; then
    # Absent or empty is a real answer — nothing has run — not a failure.
    if [ ! -e "$events" ] || [ ! -s "$events" ]; then
      [ -z "$knob_err" ] && LIVE_STATUS="ok"
      return 0
    fi
  elif [ -z "${content//[[:space:]]/}" ]; then
    # Caller already read the log; blank bytes mean the same thing.
    [ -z "$knob_err" ] && LIVE_STATUS="ok"
    return 0
  fi
  command -v jq >/dev/null 2>&1 || return 0

  local root="${CLAUDE_PROJECT_DIR:-$PWD}"
  local hb_dir="$root/.claude/state/heartbeats"
  local hb_dead hb_grace stale
  if [ -n "$knob_err" ]; then
    hb_dead=900; hb_grace=180; stale=3600
  else
    hb_dead="${HB_DEAD_SECS:-900}"
    hb_grace="${HB_GRACE:-180}"
    stale="${STALE_SECS:-3600}"
  fi
  local now; now=$(date -u +%s)

  local hb_active=0
  [ -f "$hb_dir/.enabled" ] && hb_active=1

  # The two id arrays are assembled as JSON text directly rather than through
  # jq. An id that fails the [A-Za-z0-9_-] test in the loop is skipped, so what lands
  # here can never need escaping — and the previous jq round-trip had a quiet
  # fail-open in it: if the jq that built alive_ids failed, it was coerced to
  # "[]", fresh heartbeats stopped proving life, and live agents dropped out of
  # the count. No jq, no coercion, no lost evidence.
  local dead_items="" alive_items="" f id epoch
  if [ -d "$hb_dir" ]; then
    for f in "$hb_dir"/*; do
      [ -f "$f" ] || continue
      id=""; epoch=""
      read -r id _ epoch <"$f" 2>/dev/null
      case "$id" in ''|*[!A-Za-z0-9_-]*) continue ;; esac
      case "$epoch" in ''|*[!0-9]*) continue ;; esac
      if [ $(( now - epoch )) -ge "$hb_dead" ]; then
        dead_items="$dead_items${dead_items:+,}\"$id\""
      else
        alive_items="$alive_items${alive_items:+,}\"$id\""
      fi
    done
  fi
  local dead_ids="[$dead_items]" alive_ids="[$alive_items]"

  # -R, not bare -s: read the log LINE BY LINE and drop only the lines that
  # fail to parse. Slurping the whole file as JSON (`jq -rsc`) meant one torn
  # line — the ordinary case in a file that parallel agents append to
  # concurrently and async — failed the entire parse and reported an empty
  # fleet. Per-line parsing keeps the damage inside the damaged record.
  # Detecting that damage at all is the caller's job: liveness.sh reports who
  # is live, parallel-cap.sh decides whether the log was intact enough to
  # trust the answer.
  #
  # Held in a variable so the file and the pre-read-content paths run the
  # IDENTICAL program. Single-quoted: it must contain no single quote.
  local prog='
    ($now | tonumber) as $now
    | ($stale | tonumber) as $stale
    | ($grace | tonumber) as $grace
    | ($hb_active == "1") as $hb
    | ($hb_dead | tonumber) as $hb_dead
    | def to_epoch: try (strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) catch 0;
    [ split("\n")[] | (fromjson? // empty) | select(type == "object") ]
    | map(select(.event == "SubagentStart" or .event == "SubagentStop"))
    # Pair starts to stops by agent_id; type comes from the start record,
    # where it is reliable (stops frequently land with agent_type "").
    # The value kept per id is the LATEST stop time seen for it, so an old
    # stop cannot retire a newer start of the same id.
    | ( map(select(.event == "SubagentStop"))
        | map(select((.agent_id // "") != ""))
        | map({ key: (.agent_id | tostring), value: ((.ts // "" | to_epoch)) })
        | group_by(.key)
        | map({ key: .[0].key, value: (map(.value) | max) })
        | from_entries ) as $stopped
    | map(select(.event == "SubagentStart"))
    # DEDUP BY agent_id, keeping the first start in log order. The same start
    # has been observed in the log twice with an identical agent_id and ts, and
    # each copy was counted: 3 live reviewers tallied as 6, which wedges
    # dispatch against MAX_PARALLEL_TOTAL. log-event.sh was checked and is not
    # the duplicator — it appends once per invocation, with anchored,
    # non-overlapping matchers — so the source is upstream of this repo and
    # this is a defensive dedup, not a fix at the cause. One agent_id is one
    # agent no matter how many times its start was written. Starts with no
    # agent_id cannot be told apart and so are all kept, as before.
    | reduce .[] as $s ({seen: {}, out: []};
        (($s.agent_id // "")) as $aid
        | if $aid != "" and (.seen[$aid] // false) then .
          else .seen[$aid] = true | .out += [$s] end)
    | .out
    # A stop retires a start only if it could be the stop belonging to it. Both
    # unresolvable directions were chosen for the fail-closed side:
    #   start ts unreadable -> fall back to id-only pairing and retire it. It
    #     has no readable age either, so the stale backstop can never reach it;
    #     keeping it would hold a slot forever on one malformed record.
    #   stop ts unreadable (epoch 0) -> does NOT retire a start with a readable
    #     ts. The start stays counted, and STALE_SECS still ages it out, so the
    #     cost is bounded by the same window as a lost stop event.
    | map(select(
        (.agent_id // "") as $aid
        | if $aid == "" then true
          else
            ($stopped[($aid | tostring)]) as $stop_e
            | if $stop_e == null then true
              else ((.ts // "" | to_epoch)) as $start_e
                | if $start_e == 0 then false
                  elif $stop_e >= $start_e then false
                  else true
                  end
              end
          end))
    | map(select(
        (.agent_id // "") as $aid
        | ((.ts // "" | to_epoch)) as $e
        | (if $e == 0 then -1 else ($now - $e) end) as $age
        | if $aid != "" and (($alive | index($aid)) != null) then
            true                       # fresh heartbeat proves life
          elif $aid != "" and (($dead | index($aid)) != null) then
            false                      # stale heartbeat proves death
          elif $aid != "" and $hb and $age >= 0
               and $age > ([$grace, $hb_dead] | max) then
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
  '

  local out rc
  if [ "$have_content" -eq 1 ]; then
    out=$(printf '%s\n' "$content" | jq -Rsc \
      --arg now "$now" --arg stale "$stale" \
      --arg hb_active "$hb_active" --arg grace "$hb_grace" \
      --arg hb_dead "$hb_dead" \
      --argjson dead "$dead_ids" --argjson alive "$alive_ids" "$prog" 2>/dev/null)
    rc=$?
  else
    out=$(jq -Rsc \
      --arg now "$now" --arg stale "$stale" \
      --arg hb_active "$hb_active" --arg grace "$hb_grace" \
      --arg hb_dead "$hb_dead" \
      --argjson dead "$dead_ids" --argjson alive "$alive_ids" "$prog" "$events" 2>/dev/null)
    rc=$?
  fi

  # A jq that exits non-zero has told us nothing, and a jq that exits zero
  # after printing something that is not an array has told us nothing either —
  # note that a non-zero exit AFTER a partial document leaves output that is
  # non-empty and still worthless. Both are "unknown", never "[]-means-idle".
  if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
    return 0
  fi
  case "$out" in
    \[*\]) LIVE_JSON="$out"; [ -z "$knob_err" ] && LIVE_STATUS="ok" ;;
    *)     return 0 ;;
  esac
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

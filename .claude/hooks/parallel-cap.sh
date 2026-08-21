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
#
# FAILING CLOSED IS THE WHOLE POINT, and every guard below turns on one
# distinction: "zero agents are running" is real information and allows, while
# "the count is unknown" denies. A cap that allows on an unknown count is not a
# cap. The failure is also silent — nothing on stdout is read by the harness as
# no decision, i.e. allow — so it does not announce itself. Every fail-open ever
# found in this file was found by EXECUTING it against fixtures, never by
# reading it. Change it the same way.
#
# KNOWN BOUNDS. Two gaps are left open deliberately; both are recorded here
# because a later reader will otherwise re-derive them from scratch, or "fix"
# one by weakening a guard that is load-bearing.
#
#   1. TWO DISPATCHES DECIDED BEFORE EITHER LOGS ITS START BOTH ALLOW, and the
#      fleet ends up one over the cap. This hook counts from an append-only
#      log, and the start of the agent it is deciding about is not written
#      until after the decision, so the window between the count and the log
#      write is genuinely unguarded. Closing it needs a claim the hook writes
#      itself — a lock file or a pending-dispatch record — plus an expiry for
#      claims whose agent never starts, plus cleanup on every abort path. That
#      is a different mechanism, not a patch to this one, and it introduces its
#      own wedge: a stale claim nobody removes denies every dispatch until a
#      human clears it. Measured cost of leaving it: at most one extra agent
#      per simultaneous decision, and dispatches are issued sequentially by one
#      orchestrator, so simultaneity requires two orchestrators or a retry
#      racing its own original. Bounded overshoot beat an unbounded wedge.
#
#   2. A LOG ROTATED AWAY BEFORE THE READ BELOW LOOKS EXACTLY LIKE A FRESH
#      CHECKOUT, and allows. This is deliberate and unchanged: an empty or
#      absent log is the one state that genuinely means "nothing has run", and
#      denying on it would jam the first dispatch in every new checkout. What
#      is NOT tolerated is the count and the corruption tally disagreeing about
#      which bytes they read — see the single read below.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
EVENTS="$ROOT/.claude/state/events.jsonl"
MAX_BUILDERS="${MAX_PARALLEL_BUILDERS:-2}"
MAX_TOTAL="${MAX_PARALLEL_TOTAL:-6}"

# Windows the counting rule uses. Read here only so the stderr inventory can
# explain how long a counted agent will be held; liveness.sh owns their effect
# and validates their range.
STALE_SECS="${STALE_SECS:-3600}"
HB_DEAD_SECS="${HB_DEAD_SECS:-900}"

# Set before the first possible deny. warn_live_inventory runs ahead of each cap
# deny, but the readability denies below fire long before the jq that populates
# this, and under `set -u` an unset reference would abort the hook mid-deny —
# turning a deny into no output at all, which is an allow.
live_inventory=""

input=$(cat 2>/dev/null)

# jq is load-bearing for every check below, and for liveness.sh's counting.
# Allowing when it is absent would be the same fail-open this hook exists to
# prevent: unbounded parallel dispatch, just triggered by a missing binary
# instead of a bad log line. This is NOT the same as the no-log short-circuit
# further down. An empty log genuinely means zero agents are running, so
# allowing there is correct; a missing jq means the count is unknown. Deny, and
# build the JSON by hand, since deny() itself needs jq and cannot be used here.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"parallel-cap: jq is not installed, so this hook cannot count running subagents. Refusing to dispatch rather than run uncapped. Install jq to restore parallel-dispatch limits."}}'
  exit 0
fi

# Escape a shell string into a JSON string body, without jq. Covers the only
# things JSON forbids raw: backslash, double quote, and control characters. A
# NUL cannot be held in a shell variable, so the range starts at \x01. Used only
# on the fallback path below, where jq is by definition not usable.
json_escape() {
  local s="$1" LC_ALL=C
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  s="${s//[$'\x01'-$'\x1f']/ }"
  printf '%s' "$s"
}

# deny() must not depend on jq SUCCEEDING. `command -v jq` above only proves the
# binary EXISTS; a jq that is present but broken — too old for --argjson, or
# failing outright — exits non-zero here. Testing only `[ -z "$out" ]` is not
# enough: a jq that exits non-zero AFTER printing a partial document leaves
# output that is non-empty but invalid, which the harness reads as no decision,
# i.e. ALLOW. Check the exit status as well, and rebuild by hand on either.
# Output is captured rather than streamed — see deny-irreversible.sh for why —
# so a broken jq cannot dribble a partial document onto stdout ahead of the
# fallback.
deny() {
  local out rc
  out=$(jq -n --arg msg "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $msg
    }
  }' 2>/dev/null)
  rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
    out=$(printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$(json_escape "$1")")
  fi
  printf '%s\n' "$out"
  exit 0
}

# Coercing an unreadable number to 0 would ALLOW, which is the fail-open this
# file exists to prevent. Used on the limits and on every tally below: if a
# number cannot be trusted, neither can the cap.
is_count() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
# stderr is silenced on the comparison only: a limit too large for bash's
# integers ("value too great for base") is already handled — the test fails and
# the caller denies — but the raw bash error used to leak into the hook's stderr
# and read like a crash. The decision is unchanged, only the noise.
is_positive_int() { is_count "$1" && { [ "$1" -gt 0 ]; } 2>/dev/null; }

# A non-numeric or non-positive limit must never resolve to an allow: `[ 2 -ge
# abc ]` is a bash error that evaluates false, so the cap simply stops capping.
# Denying beats a safe default, which would still allow whenever the count
# happened to fall under it.
is_positive_int "$MAX_BUILDERS" || deny "parallel-cap: MAX_PARALLEL_BUILDERS is not a positive integer (got '$MAX_BUILDERS'). Refusing to dispatch rather than run uncapped."
is_positive_int "$MAX_TOTAL"    || deny "parallel-cap: MAX_PARALLEL_TOTAL is not a positive integer (got '$MAX_TOTAL'). Refusing to dispatch rather than run uncapped."

# `[ -s ]` reports "absent or empty" both when the log genuinely is not there
# and when a directory on the way to it denies search — a chmod 000 on
# .claude/state is enough. Reproduced with two live builders: the hook allowed,
# cap entirely unenforced. Check the ancestors first. Order matters: each -e
# test is only meaningful because every earlier directory already passed -x.
for dir in "$ROOT" "$ROOT/.claude" "$ROOT/.claude/state"; do
  if [ -e "$dir" ] && [ ! -x "$dir" ]; then
    deny "parallel-cap: $dir exists but is not searchable, so $EVENTS cannot be read to count running subagents. Refusing to dispatch rather than run uncapped."
  fi
done

# ABSENT ONLY MEANS "NOTHING HAS RUN" AT A ROOT THAT IS ACTUALLY THE PROJECT.
# ROOT falls back to $PWD when CLAUDE_PROJECT_DIR is unset, and a hook invoked
# from anywhere outside the checkout then looks for the log under a directory
# that has no .claude at all, finds nothing, and reads "nothing has run" — the
# fresh-checkout allowance doubling as an off switch for the cap, triggered by
# an unset variable rather than by anything about the fleet. Require evidence
# that ROOT is a fleet checkout before trusting an absent log: the hooks
# directory this very script ships in. A real project root always has it; a cwd
# that merely happens to be somewhere else does not.
#
# Checked here, ahead of the source below, only so the message names the actual
# problem. Sourcing liveness.sh from a non-root fails too, but "the install is
# incomplete" would send the reader off repairing a fleet that is fine.
if [ ! -e "$EVENTS" ] && [ ! -f "$ROOT/.claude/hooks/parallel-cap.sh" ]; then
  deny "parallel-cap: no event log at $EVENTS, and $ROOT does not look like the project root (no .claude/hooks/parallel-cap.sh under it). CLAUDE_PROJECT_DIR is '${CLAUDE_PROJECT_DIR:-unset}', so running subagents cannot be counted — an absent log here means the wrong directory, not an idle fleet. Refusing to dispatch rather than run uncapped. Set CLAUDE_PROJECT_DIR to the checkout root."
fi

# LIVENESS IS SHARED. The pairing rule, heartbeat death detection, and stale
# backstop live in liveness.sh, sourced by this hook and every display
# surface (dashboard, statusline, status page). When enforcement and display
# used separate copies of this logic, they drifted: the cap freed a dead
# agent's slot while the dashboard showed it running for another hour.
#
# Loaded here, well before the count is needed, because the timing-knob bounds
# it defines have to be checked on EVERY path — including the ones that
# short-circuit to an allow on an absent or empty log. It is loaded after the
# searchability tests above only so a chmod 000 on the root reports the
# permission problem rather than a bogus "incomplete install".
#
# Seeded before the source, because under `set -u` a liveness.sh that loads but
# never sets LIVE_JSON would abort this script on the first reference — and an
# aborted hook prints nothing, which the harness reads as ALLOW. Every failure
# on this path has to end at deny(), not at a shell error.
LIVE_JSON=""
LIVE_STATUS="unknown"
. "$ROOT/.claude/hooks/liveness.sh" 2>/dev/null || {
  # FAIL CLOSED. Without the shared liveness rule the cap cannot count, and
  # an uncountable fleet must not become an uncapped one. This fires only on
  # a broken install — liveness.sh ships in add-fleet's sync list.
  deny "parallel-cap cannot load .claude/hooks/liveness.sh — the install is incomplete. Re-run add-fleet and ./bin/doctor before dispatching agents."
}
# Sourcing a liveness.sh too old to define the counter succeeds, and the call
# below would then be a "command not found" that `set -u` turns into a silent
# allow two lines later. Check for the function itself, not just the file.
command -v fleet_live_json >/dev/null 2>&1 || deny "parallel-cap: .claude/hooks/liveness.sh loaded but defines no fleet_live_json, so running subagents cannot be counted. Re-run add-fleet and ./bin/doctor before dispatching agents."
command -v liveness_knob_error >/dev/null 2>&1 || deny "parallel-cap: .claude/hooks/liveness.sh loaded but defines no liveness_knob_error, so the STALE_SECS / HB_DEAD_SECS / HB_GRACE windows cannot be checked. Re-run add-fleet and ./bin/doctor before dispatching agents."

# THE TIMING KNOBS ARE A CAP TOO, just an indirect one: they decide how long a
# started agent keeps counting. STALE_SECS=1 or HB_DEAD_SECS=0 empties the
# fleet on paper and every dispatch sails through — the same class of hole as
# an unvalidated MAX_PARALLEL_*, and invisible in exactly the same way, since
# an undercount looks like an idle fleet. Non-numeric values already failed
# closed through jq's tonumber; valid-but-tiny ones did not. Bounds and
# reasoning live in liveness.sh, next to the code they govern.
knob_err=$(liveness_knob_error) || :
if [ -n "$knob_err" ]; then
  deny "parallel-cap: $knob_err. That window decides how long a running subagent stays counted, so an out-of-range value silently empties the fleet and uncaps dispatch. Refusing to dispatch until it is corrected or unset."
fi

# No log yet is the ordinary "nothing has run" state, not a failure — allow, so
# a fresh checkout or a rotated-away file does not jam the very first dispatch.
# Reached only once the path to it is known traversable AND the root is known
# to be the project's, so "absent" here really means absent.
[ -e "$EVENTS" ] || exit 0

# EVENTS must be a regular, readable file before jq ever touches it. `jq -Rsr`
# on a path it cannot open (permission denied, or a directory sitting where the
# log should be) does not fail usefully: measured, it prints a line of zeros to
# stdout and exits 2. That output is NON-EMPTY, so an emptiness test on the
# result never fires, and the tallies below read as 0, which skips the
# corruption guard too. liveness.sh is quieter still on this path — it swallows
# the failure and reports an empty fleet, which allows. So this check is what
# covers the unreadable-file case; the jq exit-status guards below are a
# backstop for it, not a replacement. Do not delete one for the other.
if [ ! -f "$EVENTS" ] || [ ! -r "$EVENTS" ]; then
  deny "parallel-cap: $EVENTS exists but is not a readable regular file (permission denied, or a directory in its place). Refusing to dispatch rather than run uncapped."
fi

# An empty log is a real answer — nothing has run — so it allows.
[ -s "$EVENTS" ] || exit 0

# ONE READ, AND EVERYTHING DOWNSTREAM WORKS FROM THESE BYTES. The corruption
# tally and the live count used to open the log separately. Between the two,
# the log can be rotated or truncated — by ./bin/lane, by a log roll, by an
# agent clearing a wedge — and the failure was silent in the worst direction:
# the tally saw an intact file and passed, then the count saw an empty one and
# reported an idle fleet with status ok, which ALLOWS while agents are live.
# Neither read was wrong on its own; the disagreement was the bug. Both now
# consume $log_content, so the tally can only ever describe the same bytes the
# count was taken from.
#
# stderr is redirected on the assignment as well as inside it: a NUL byte in a
# torn line makes bash itself warn "ignored null byte in input" from the
# command substitution, which is noise on a path that has already decided
# nothing. The line holding the NUL still fails to parse and still trips the
# lost-line deny below.
log_content=$(cat -- "$EVENTS" 2>/dev/null) 2>/dev/null
read_rc=$?
if [ "$read_rc" -ne 0 ]; then
  deny "parallel-cap: $EVENTS could not be read (exit $read_rc), so running subagents cannot be counted. Refusing to dispatch rather than run uncapped."
fi

# The file was non-empty a moment ago and reads as blank now: it was rotated or
# truncated between the two. That is the fresh-log state, not a corrupt one —
# see KNOWN BOUNDS 2 at the top. Allowing here is the same decision the -s test
# above would have made half a millisecond earlier.
if [ -z "${log_content//[[:space:]]/}" ]; then
  exit 0
fi

# CORRUPTION TALLY, and it is not optional. liveness.sh reads the log line by
# line (`jq -Rsc`, then `fromjson?` per line) and drops the lines that fail to
# parse, which is right for a file that parallel agents append to concurrently
# and async: a torn or interleaved line damages only its own record instead of
# failing the whole parse. But dropping a line silently is exactly how a count
# goes low without anyone noticing, and a LOW count allows. So liveness.sh
# tolerates the damage and this hook measures it: content_lines counts lines
# holding anything at all, parsed_records how many of them became JSON objects.
tally=$(printf '%s\n' "$log_content" | jq -Rsr '
  ( [ split("\n")[] | select(. != "" and (test("^[[:space:]]*$") | not)) ] | length ) as $content_lines
  | ( [ split("\n")[] | select(. != "" and (test("^[[:space:]]*$") | not))
        | (fromjson? // empty) | select(type == "object") ] | length ) as $parsed_records
  | "\($content_lines) \($parsed_records)"
' 2>/dev/null)
tally_rc=$?

# Any whole-invocation jq failure — a jq present but broken, an internal error,
# a program bug — leaves the count unknown. Fail closed; a deny is a retry, an
# allow is the fail-open that motivated this work.
if [ "$tally_rc" -ne 0 ] || [ -z "$tally" ]; then
  deny "parallel-cap: could not read $EVENTS to count running subagents (jq exit $tally_rc). Refusing to dispatch rather than run uncapped."
fi

# `read`, not `set --`: `set --` word-splits AND glob-expands unquoted.
read -r content_lines parsed_records _ <<<"$tally"
if ! is_count "${content_lines:-}" || ! is_count "${parsed_records:-}"; then
  deny "parallel-cap: could not parse the log tally of $EVENTS (got '$tally'). Refusing to dispatch rather than run uncapped."
fi

# Non-empty file in which nothing at all parsed: whole-file corruption rather
# than a single torn line, where the count would be a meaningless 0 that
# silently allows. A genuinely empty log is handled by the -s test above and
# still allows, so routine rotation does not jam dispatch.
if [ "$content_lines" -gt 0 ] && [ "$parsed_records" -eq 0 ]; then
  deny "parallel-cap: $EVENTS has $content_lines line(s) but none parsed as JSON. Refusing to dispatch rather than run uncapped."
fi

# ANY LOST LINE DENIES. The zero-parsed test above is not enough on its own,
# and both of its holes were measured:
#
#   4 content lines, 1 record, 3 live builders -> counted 1 -> ALLOW
#   {"event":"Heartbeat","note":"unrelated"} + 3 garbage lines -> ALLOW
#
# A single intact object — any object, not even an agent record — was enough to
# disarm a guard that only fires at exactly zero. Partial loss is the dangerous
# case precisely because it looks like a normal count: every dropped line can
# be a SubagentStart, and every dropped start is a slot the cap gives away.
# There is no safe ratio here, because one lost line is one uncounted agent, so
# the threshold is one. The cost is asymmetric and that is the whole argument:
# a false deny costs a retry, a false allow costs an uncapped fleet.
#
# Note what this does NOT do: it does not require agent records to be present.
# A log holding nothing but valid TaskCreated lines is a repo where no subagent
# has run, which is real information, and it allows.
if [ "$parsed_records" -lt "$content_lines" ]; then
  bad_lines=$(printf '%s\n' "$log_content" | jq -Rsr '
    [ split("\n") | to_entries[]
      | select(.value != "" and (.value | test("^[[:space:]]*$") | not))
      | select((((.value | fromjson? | select(type == "object") | true) // false) | not))
      | .key + 1 ] | .[0:5] | join(", ")' 2>/dev/null)
  case "$bad_lines" in *[!\ ]*) bad_lines=" First unparseable line(s): $bad_lines." ;; *) bad_lines="" ;; esac
  deny "parallel-cap: $EVENTS has $content_lines line(s) but only $parsed_records parsed as JSON objects, so an unknown number of running subagents is missing from the count. Refusing to dispatch rather than undercount.$bad_lines Repair or rotate the log to restore dispatch."
fi

# How many subagents of each kind are live right now, from the bytes already
# read above — the second argument is what keeps this off a second read.
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
fleet_live_json "$EVENTS" "$log_content"

# THE COUNT MUST SAY WHETHER IT IS A COUNT. liveness.sh used to answer every
# failure — jq missing, jq broken, a result that was not an array — with "[]",
# the identical value an idle fleet produces, and this hook read that as
# "nobody is running, allow". Measured before the fix: 2 live builders plus one
# torn log line ALLOWED, and so did 6 live reviewers plus one torn line. The
# cap was off. LIVE_STATUS is the missing distinction, and it is checked before
# LIVE_JSON is read for anything. Seeded "unknown" above, so a liveness.sh too
# old to set it denies rather than being trusted by default.
if [ "${LIVE_STATUS:-}" != "ok" ]; then
  deny "parallel-cap: liveness.sh could not determine which subagents are running (status '${LIVE_STATUS:-unset}'), so the count is unknown rather than zero. Refusing to dispatch rather than run uncapped."
fi

# Strict on shape, not just on emptiness. liveness.sh promises an array of
# objects with a numeric `running`, and anything else means the count is
# unknown — a bare object, say, would `map` over its values and total a
# very confident 0. jq errors out on each of those, and a non-zero exit here
# denies.
counts=$(printf '%s' "$LIVE_JSON" | jq -c '
  if type != "array" then error("live set is not an array") else . end
  | map( if type != "object" then error("live entry is not an object") else . end
         | { t: (.type // ""), n: .running }
         | if (.n | type) != "number" then error("running is not a number") else . end
         | .n = (.n | floor) )' 2>/dev/null)
counts_rc=$?
# This used to `exit 0` — allow — whenever the reshape came back empty, which is
# precisely the "count is unknown" case: LIVE_JSON unset, truncated, or not an
# array. An idle fleet does NOT land here. It produces the literal "[]", which
# reshapes to "[]" and falls through to a total of 0, so zero agents still
# allows.
if [ "$counts_rc" -ne 0 ] || [ -z "$counts" ]; then
  deny "parallel-cap: could not read the live-agent set from $EVENTS (jq exit $counts_rc). Refusing to dispatch rather than run uncapped."
fi

total=$(printf '%s' "$counts" | jq -r 'map(.n) | add // 0' 2>/dev/null)
builders=$(printf '%s' "$counts" | jq -r '
  map(select(.t == "builder-light" or .t == "builder" or .t == "builder-deep"))
  | map(.n) | add // 0' 2>/dev/null)

# These two used to be coerced to 0 on anything non-numeric, which turns an
# unparseable count into an allow — the same fail-open as a failed parse, just
# quieter. Deny instead: if the counter cannot be trusted, neither can the cap.
if ! is_count "$total" || ! is_count "$builders"; then
  deny "parallel-cap: could not parse the running-subagent count (got total='$total' builders='$builders'). Refusing to dispatch rather than run uncapped."
fi

# Diagnostic only, never read for a decision: one token per live agent type,
# carrying the age of the most recent start in that type. A failure here leaves
# it empty and the cap decides exactly as it would have anyway.
live_inventory=$(printf '%s' "$LIVE_JSON" | jq -r --arg now "$(date -u +%s)" '
  ($now | tonumber) as $now
  | def to_epoch: try (strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) catch 0;
  map( ((.started // "" | to_epoch)) as $e
       | "\(if (.type // "") == "" then "?" else .type end)"
         + ":n=\(.running)"
         + ":newest-start=\(if $e == 0 then "unknown-age" else "\($now - $e | floor)s" end)"
         + ":lane=\(if (.lane // "") == "" then "?" else .lane end)" )
  | join(",")' 2>/dev/null)
case "$live_inventory" in *[!\ ]*) : ;; *) live_inventory="" ;; esac

# Say WHICH agents are being counted whenever a cap denies. An agent killed by a
# turn limit emits no SubagentStop, so its start stays unpaired and holds a slot
# until its heartbeat goes stale or the start ages out — a denial that looks
# identical to the counter-drift bug that cost three sessions. This changes
# neither the decision nor the deny message; it just means the next reader can
# tell a phantom from a genuinely running agent by its age, instead of
# re-deriving the whole diagnosis by hand from events.jsonl. Goes to stderr, so
# it can never corrupt the JSON decision on stdout.
warn_live_inventory() {
  [ -n "$live_inventory" ] || return 0
  echo "parallel-cap: counted as running (type:n=count:newest-start=age:lane). Each has a SubagentStart and no SubagentStop. One with no heartbeat is held until the ${STALE_SECS}s start cutoff; one with a heartbeat is held until it goes quiet for ${HB_DEAD_SECS}s. Per-agent detail: ./bin/dashboard." >&2
  printf '%s\n' "$live_inventory" | tr ',' '\n' | sed 's/^/parallel-cap:   /' >&2
}

# Total cap applies to every dispatch regardless of type, so it holds even when
# the agent type cannot be read out of the payload at all.
if [ "$total" -ge "$MAX_TOTAL" ]; then
  warn_live_inventory
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
      warn_live_inventory
      deny "$builders builder(s) already running — MAX_PARALLEL_BUILDERS=$MAX_BUILDERS. Wait for one to finish. Raise it by exporting MAX_PARALLEL_BUILDERS before ./bin/lane."
    fi
    ;;
esac

exit 0

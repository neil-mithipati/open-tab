#!/bin/bash
# loop-until-done.sh — Stop hook. Refuses to let the orchestrator end its turn
# while the ledger still has unfinished work, and tells it what is left.
#
# This is the enforcement layer for orchestrator rules 5-7 (escalate on retry,
# always dispatch the reviewer, publish after merge). Those rules were already in
# the card as prose, and prose did not hold: the orchestrator ended a session with
# the ledger untouched and everything built inline. A Stop hook cannot be reasoned
# past — it runs on the way out, every time.
#
# HOW IT BLOCKS: exit 2 with a message on stderr. For a Stop hook that means "do
# not stop", and the stderr text is fed back as the reason. Exit 0 lets the turn
# end normally.
#
# WHY A HARD BOUND: a Stop hook that always blocks will loop until the session
# dies — this is a real, reported failure mode, not a theoretical one
# (anthropics/claude-code#55754, a hook that burned ~50 minutes of session).
# Two independent brakes here:
#
#   1. A per-session counter, capped at LOOP_MAX (default 3). Once spent, this
#      hook stops blocking for the rest of the session, full stop.
#   2. stop_hook_active — if the harness reports it is already in a forced
#      continuation, that consumes a count rather than being ignored.
#
# WHEN IT DELIBERATELY DOES NOT BLOCK:
#   - Spend cap at or over 100%. Forcing more work while over budget is the
#     opposite of what a circuit breaker is for.
#   - Tasks that are `blocked`. Blocked means it needs the owner's judgment;
#     nagging the orchestrator cannot resolve it.
#   - No ledger directory at all, or no unfinished tasks.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE="$ROOT/.claude/state"
LEDGER="$ROOT/ledger"
LOOP_MAX="${LOOP_MAX:-3}"

input=$(cat 2>/dev/null)

# Any failure below should let the turn end, never trap it.
command -v jq >/dev/null 2>&1 || exit 0
mkdir -p "$STATE" 2>/dev/null || exit 0

session=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null)
active=$(printf '%s' "$input"  | jq -r '.stop_hook_active // false' 2>/dev/null)

counter="$STATE/.loop-${session}.count"
count=0
[ -f "$counter" ] && count=$(cat "$counter" 2>/dev/null)
case "$count" in ''|*[!0-9]*) count=0 ;; esac

# ── brake 1: the hard cap ────────────────────────────────────────────────────
if [ "$count" -ge "$LOOP_MAX" ]; then
  rm -f "$counter" 2>/dev/null
  exit 0
fi

# ── brake 2: already in a forced continuation ────────────────────────────────
# Spend a count rather than ignoring it, so the two brakes cannot disagree.
if [ "$active" = "true" ]; then
  count=$((count + 1))
  echo "$count" > "$counter" 2>/dev/null
fi

# ── never force work while over budget ───────────────────────────────────────
spend="$STATE/spend.json"
budget="$ROOT/.claude/budget.json"
if [ -s "$spend" ] && [ -s "$budget" ]; then
  over=$(jq -rs --arg lane "${LANE:-default}" '
    (.[0] // {}) as $s | (.[1] // {}) as $b
    | ($b.lanes[$lane] // $b.default // 0) as $cap
    | ($s.lanes[$lane] // 0) as $spent
    | if $cap > 0 and $spent >= $cap then "yes" else "no" end
  ' "$spend" "$budget" 2>/dev/null)
  if [ "$over" = "yes" ]; then
    rm -f "$counter" 2>/dev/null
    exit 0
  fi
fi

# ── what is actually unfinished? ─────────────────────────────────────────────
[ -d "$LEDGER" ] || exit 0

unfinished=""
n=0
for f in "$LEDGER"/*.md; do
  [ -e "$f" ] || continue
  st=$(sed -n 's/^state:[[:space:]]*//p' "$f" | head -1)
  case "$st" in
    todo|in-progress) ;;
    *) continue ;;
  esac
  id=$(sed -n 's/^id:[[:space:]]*//p'    "$f" | head -1)
  ti=$(sed -n 's/^title:[[:space:]]*//p' "$f" | head -1)

  # Unchecked criteria from the body, if the task uses the checklist format.
  # Body = everything after the second frontmatter delimiter; a naive
  # sed-range deletes the body along with the frontmatter, so this counts
  # delimiters explicitly instead — the same fix bin/audit needed for the
  # same reason.
  pending=$(awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n>=2{print}' "$f" \
    | sed -n 's/^[[:space:]]*-[[:space:]]*\[ \][[:space:]]*//p')

  unfinished="$unfinished
  ${id:-?} [$st] ${ti:-untitled}"
  if [ -n "$pending" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && unfinished="$unfinished
      - $line"
    done <<< "$pending"
  fi
  n=$((n + 1))
done

# Nothing outstanding — let it stop, and clear the counter for the next task.
if [ "$n" -eq 0 ]; then
  rm -f "$counter" 2>/dev/null
  exit 0
fi

# ── block ────────────────────────────────────────────────────────────────────
count=$((count + 1))
echo "$count" > "$counter" 2>/dev/null

remaining=$((LOOP_MAX - count))

cat >&2 <<EOF
Unfinished in ledger ($n):
$unfinished
EOF

exit 2

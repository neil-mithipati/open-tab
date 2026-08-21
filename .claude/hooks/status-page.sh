#!/bin/bash
# Renders STATUS.md from local state and pushes it to the `status` branch, where
# GitHub renders it as a live page.
#
# Three properties matter here:
#
#   1. It never blocks the pipeline. Every path exits 0. A status page that can
#      break a build is worse than no status page.
#   2. It never touches your working tree or index. The commit is assembled with
#      git plumbing (hash-object/mktree/commit-tree), so STATUS.md exists only on
#      the status branch and never appears in your main branch's tree.
#   3. It never force-pushes. Each commit parents on the previous status commit,
#      so the push is a fast-forward and does not trip the deny list.
#
# Wired to SubagentStop and TaskCompleted. Debounced so a burst of events produces
# one commit, not twenty.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE="$ROOT/.claude/state"
OUT="$STATE/STATUS.md"
STAMP="$STATE/.status-last-push"
BRANCH="${STATUS_BRANCH:-status}"
DEBOUNCE="${STATUS_DEBOUNCE:-60}"

command -v jq  >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0
mkdir -p "$STATE" 2>/dev/null || exit 0

cd "$ROOT" 2>/dev/null || exit 0

# Shared lib: liveness + yaml_field. Sourced up top because the ledger
# sections need yaml_field even when there are no events yet.
. "$ROOT/.claude/hooks/liveness.sh" 2>/dev/null || true

now=$(date -u +%s)

# ---------- render ----------

ts=$(date -u +"%Y-%m-%d %H:%M UTC")
events="$STATE/events.jsonl"
spend="$STATE/spend.json"
budget="$ROOT/.claude/budget.json"

{
  echo "# Agent status"
  echo
  echo "Updated $ts · regenerated on every task completion."
  echo

  # --- spend ---
  echo "## Spend"
  echo
  if [ -s "$spend" ] && [ -s "$budget" ]; then
    echo "| Lane | Spent | Cap | Used |"
    echo "|---|---|---|---|"
    jq -r --slurpfile b "$budget" '
      ($b[0].lanes // {}) as $caps
      | ($b[0].default // 0) as $fallback
      | (.lanes // {}) | to_entries[]
      | . as $e
      | ($caps[$e.key] // $fallback) as $cap
      | (if $cap > 0 then (($e.value / $cap) * 100) else 0 end) as $pct
      | (($pct / 10) | floor | if . > 10 then 10 else . end) as $filled
      | "| \($e.key) | $\($e.value | . * 100 | round / 100) | $\($cap) | "
        + ("█" * $filled) + ("░" * (10 - $filled))
        + " \($pct | floor)% |"
    ' "$spend" 2>/dev/null
  else
    echo "No spend data. The poller may not be running:"
    echo
    echo '```'
    echo './.claude/hooks/spend-poll.sh &'
    echo 'curl -s localhost:9464/metrics | head   # must return output'
    echo '```'
  fi
  echo

  # --- active agents ---
  echo "## Agents"
  echo
  if [ -s "$events" ]; then
    # Live agents come from the shared rule in liveness.sh — the same one
    # the cap enforces and the dashboard renders.
    active=""
    if . "$ROOT/.claude/hooks/liveness.sh" 2>/dev/null; then
      fleet_live_json "$events"
      active=$(printf '%s' "$LIVE_JSON" | jq -r '
        sort_by(.started) | .[]
        | "| 🟢 \(.type) | \(.lane) | \(.started) | \(.running) |"
      ' 2>/dev/null)
    fi

    if [ -n "$active" ]; then
      echo "| Role | Lane | Started | Running |"
      echo "|---|---|---|---|"
      printf '%s\n' "$active"
    else
      echo "Idle — no agents currently running."
    fi
  else
    echo "No events recorded yet."
  fi
  echo

  # --- blocked — needs the owner ---
  # Rendered before the ledger so asks are the first thing after agents.
  # GitHub renders [!CAUTION] blocks in red, matching the terminal treatment.
  if [ -d "$ROOT/ledger" ]; then
    b_lines=""
    for f in "$ROOT"/ledger/*.md; do
      [ -e "$f" ] || continue
      st=$(sed -n 's/^state:[[:space:]]*//p' "$f" | head -1)
      [ "$st" = "blocked" ] || continue
      bid=$(sed -n 's/^id:[[:space:]]*//p' "$f" | head -1)
      br=$(yaml_field blocked_reason "$f" 2>/dev/null)
      b_lines="${b_lines}> 🔴 **Blocked \`${bid:-?}\`** — ${br:-no blocked_reason recorded}
"
    done
    if [ -n "$b_lines" ]; then
      echo "## Blocked — needs your input"
      echo
      echo "> [!CAUTION]"
      printf '%s' "$b_lines"
      echo
    fi
  fi

  # --- ledger ---
  # One line per task; everything else collapses behind <details>, which
  # GitHub renders as an expandable arrow. The summary carries id, state,
  # title, and criteria progress — enough to decide whether to expand.
  if [ -d "$ROOT/ledger" ]; then
    echo "## Tasks"
    echo
    any=""
    for f in "$ROOT"/ledger/*.md; do
      [ -e "$f" ] || continue
      any=1
      id=$(sed -n 's/^id:[[:space:]]*//p'      "$f" | head -1)
      st=$(sed -n 's/^state:[[:space:]]*//p'   "$f" | head -1)
      ti=$(sed -n 's/^title:[[:space:]]*//p'   "$f" | head -1)
      br=$(yaml_field blocked_reason "$f" 2>/dev/null)
      body=$(awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n>=2{print}' "$f")
      n_open=$(printf '%s\n' "$body" | grep -c '^[[:space:]]*- \[ \]' || true)
      n_done=$(printf '%s\n' "$body" | grep -c '^[[:space:]]*- \[[xX]\]' || true)
      n_all=$((n_open + n_done))
      prog=""
      [ "$n_all" -gt 0 ] && prog=" · $n_done/$n_all criteria"
      case "$st" in
        done)        icon="✅" ;;
        in-progress) icon="🟢" ;;
        blocked)     icon="🔴" ;;
        *)           icon="⚪" ;;
      esac
      summary="$icon <code>${id:-?}</code> ${st:-todo} — ${ti:-untitled}${prog}"
      [ "$st" = "blocked" ] && summary="$summary — ${br:-no blocked_reason}"
      echo "<details><summary>$summary</summary>"
      echo
      # Frontmatter detail minus what the summary already shows.
      awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n==1{print}' "$f" \
        | grep -Ev '^(id|title|state):' | sed 's/^/- /'
      echo
      printf '%s\n' "$body"
      echo
      echo "</details>"
    done
    [ -n "$any" ] || echo "Ledger is empty."
    echo
  fi

  # --- recent activity ---
  if [ -s "$events" ]; then
    echo "## Recent activity"
    echo
    echo '```'
    tail -n 200 "$events" | jq -r '
      "\(.ts)  \(.lane)  \(.event)\(if .agent_type then "  " + .agent_type else "" end)"
    ' 2>/dev/null | tail -n 20
    echo '```'
    echo
  fi

  echo "---"
  echo
  echo "Generated locally and pushed to the \`$BRANCH\` branch. Freshness depends on"
  echo "this machine having run and pushed — GitHub cannot pull this data itself."
} > "$OUT.tmp" 2>/dev/null

[ -s "$OUT.tmp" ] || exit 0
mv "$OUT.tmp" "$OUT" 2>/dev/null || exit 0

# ---------- push ----------

# Debounce: a burst of subagent stops should produce one commit.
if [ -f "$STAMP" ]; then
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  [ $(( now - last )) -lt "$DEBOUNCE" ] && exit 0
fi

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0   # no remote, local render only

# Assemble the commit without touching the working tree or index.
blob=$(git hash-object -w "$OUT" 2>/dev/null) || exit 0
tree=$(printf '100644 blob %s\tSTATUS.md\n' "$blob" | git mktree 2>/dev/null) || exit 0

# Parent on the remote tip so the push fast-forwards. No force, ever.
git fetch -q origin "$BRANCH" 2>/dev/null
parent=$(git rev-parse -q --verify "refs/remotes/origin/$BRANCH" 2>/dev/null \
      || git rev-parse -q --verify "refs/heads/$BRANCH" 2>/dev/null || true)

# Nothing changed since the last commit — skip the empty commit.
if [ -n "$parent" ]; then
  prev_tree=$(git rev-parse -q --verify "$parent^{tree}" 2>/dev/null || true)
  [ "$prev_tree" = "$tree" ] && { echo "$now" > "$STAMP"; exit 0; }
fi

# git commit-tree is plumbing and never triggers the commit-msg hook, so this
# message is lowercased by hand to match every other commit in the repo.
commit_msg=$(printf 'status: %s' "$ts" | tr '[:upper:]' '[:lower:]')

if [ -n "$parent" ]; then
  commit=$(git commit-tree "$tree" -p "$parent" -m "$commit_msg" 2>/dev/null) || exit 0
else
  commit=$(git commit-tree "$tree" -m "$commit_msg" 2>/dev/null) || exit 0
fi

git update-ref "refs/heads/$BRANCH" "$commit" 2>/dev/null || exit 0
git push -q origin "refs/heads/$BRANCH:refs/heads/$BRANCH" 2>/dev/null || true

echo "$now" > "$STAMP" 2>/dev/null
exit 0

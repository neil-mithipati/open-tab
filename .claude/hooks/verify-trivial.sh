#!/bin/bash
# verify-trivial.sh — SubagentStop hook. Checks that any task marked `review: skip`
# actually stayed inside the presentational boundary, and forces review if it did
# not.
#
# Why this exists: `review: skip` is the one place in the system where work reaches
# main without a second reader. That makes "is this task really trivial?" a
# security-relevant judgment, and every other judgment in this system that was left
# to a prompt has eventually been ignored. So the claim is checked against the
# actual diff rather than trusted.
#
# It does not decide whether the change is *good* — it decides whether the change
# is *eligible* for the fast path. On violation it exits 2, which rejects the
# builder's completion, and the orchestrator must re-dispatch with `review: full`.
#
# Deliberately conservative: anything it cannot classify counts as a violation.
# A false positive costs one review. A false negative ships unreviewed logic.
#
# WORKTREES: a task's actual changes live in its own worktree directory, not in
# the main checkout this hook runs from. Checking $ROOT alone would see an empty
# diff for every worktree-based task and silently approve everything — the
# opposite of what this hook exists to do. So this loops over every task
# currently claiming the fast path and checks each one inside its own recorded
# `worktree:` path, falling back to $ROOT only for a task with no worktree field
# (branches-only mode, if that's ever used again).

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
LEDGER="$ROOT/ledger"

command -v git >/dev/null 2>&1 || exit 0
[ -d "$LEDGER" ] || exit 0

# Runs the same check as before, but rooted at $1 (a task's worktree, or $ROOT
# as a fallback) instead of always assuming the main checkout.
check_task() {
  local id="$1" dir="$2"
  local changed count violations path added

  cd "$dir" 2>/dev/null || {
    printf '  %s — worktree %s does not exist; cannot verify, treating as violation\n' "$id" "$dir"
    return 1
  }
  command -v git >/dev/null 2>&1 || return 1
  git rev-parse --git-dir >/dev/null 2>&1 || {
    printf '  %s — %s is not a git checkout; cannot verify\n' "$id" "$dir"
    return 1
  }

  changed=$( { git diff --name-only 2>/dev/null
               git diff --name-only --cached 2>/dev/null
               git ls-files --others --exclude-standard 2>/dev/null
               git diff --name-only "$(git merge-base HEAD origin/HEAD 2>/dev/null || echo HEAD)"..HEAD 2>/dev/null
             } | sort -u | grep -v '^$' )

  [ -z "$changed" ] && return 0

  violations=""
  count=0
  for path in $changed; do
    count=$((count + 1))
    case "$path" in
      supabase/*|*/migrations/*|*migration*) violations="$violations
    $path — database schema" ;;
      package.json|package-lock.json|*.lock|pnpm-lock.yaml|yarn.lock)
        violations="$violations
    $path — dependencies" ;;
      .env*|*.pem|*.key) violations="$violations
    $path — secrets" ;;
      .claude/*|*/.claude/*) violations="$violations
    $path — agent configuration" ;;
      *middleware*|*auth*|*session*|*cookie*) violations="$violations
    $path — auth or session" ;;
      *.config.*|.github/*|Dockerfile*|*.yml|*.yaml) violations="$violations
    $path — build or CI configuration" ;;
      src/*.css|src/**/*.css|*.css|*.scss) ;;
      public/*|src/*.svg|src/**/*.svg|*.png|*.jpg|*.jpeg|*.webp|*.ico) ;;
      src/*) ;;
      *) violations="$violations
    $path — outside src/" ;;
    esac
  done

  if [ "$count" -gt 3 ]; then
    violations="$violations
    $count files changed — the fast path allows at most 3"
  fi

  for path in $changed; do
    case "$path" in
      *.ts|*.tsx|*.js|*.jsx) ;;
      *) continue ;;
    esac
    [ -f "$path" ] || continue
    # A brand-new file is untracked, and `git diff` shows nothing for a path
    # that has never been in the index — not "no changes", just nothing to
    # compare against. Diffing against /dev/null treats the whole file as
    # added, which is what a new file actually is.
    if git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
      added=$(git diff -U0 -- "$path" 2>/dev/null | grep '^+' | grep -v '^+++')
      [ -z "$added" ] && added=$(git diff -U0 --cached -- "$path" 2>/dev/null | grep '^+' | grep -v '^+++')
    else
      added=$(git diff --no-index -- /dev/null "$path" 2>/dev/null | grep '^+' | grep -v '^+++')
    fi
    [ -z "$added" ] && continue
    if printf '%s' "$added" | grep -qE '\b(useState|useEffect|useReducer|useMemo|useCallback|fetch|await|async|createClient|supabase)\b|=>[[:space:]]*\{|\bif[[:space:]]*\(|\breturn[[:space:]]+.*\?'; then
      violations="$violations
    $path — added logic (hooks, control flow, or data access), not presentation"
    fi
  done

  [ -z "$violations" ] && return 0

  printf '  %s (in %s):%s\n' "$id" "$dir" "$violations"
  return 1
}

any_violation=0
report=""

for f in "$LEDGER"/*.md; do
  [ -e "$f" ] || continue
  rv=$(sed -n 's/^review:[[:space:]]*//p' "$f" | head -1)
  st=$(sed -n 's/^state:[[:space:]]*//p'  "$f" | head -1)
  case "$rv" in skip|Skip|SKIP) ;; *) continue ;; esac
  case "$st" in in-progress|done) ;; *) continue ;; esac

  id=$(sed -n 's/^id:[[:space:]]*//p' "$f" | head -1)
  id="${id:-unknown}"
  wt=$(sed -n 's/^worktree:[[:space:]]*//p' "$f" | head -1)

  if [ -n "$wt" ]; then
    case "$wt" in
      /*) task_dir="$wt" ;;
      *)  task_dir="$ROOT/$wt" ;;
    esac
  else
    task_dir="$ROOT"
  fi

  out=$(check_task "$id" "$task_dir" 2>&1)
  rc=$?
  cd "$ROOT" 2>/dev/null
  if [ "$rc" -ne 0 ]; then
    any_violation=1
    report="$report
$out"
  fi
done

[ "$any_violation" -eq 0 ] && exit 0

cat >&2 <<EOF
Task(s) marked \`review: skip\` are not presentational:
$report

The fast path is for CSS, Tailwind classes, spacing, colour, copy, and asset
swaps — at most three files, no logic. This change is outside that boundary.

Set \`review: full\` on the task and dispatch the reviewer. Do not narrow the diff
to fit the fast path; if the work genuinely needs doing, it genuinely needs review.
EOF

exit 2

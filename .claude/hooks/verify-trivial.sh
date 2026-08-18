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

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
LEDGER="$ROOT/ledger"

command -v git >/dev/null 2>&1 || exit 0
cd "$ROOT" 2>/dev/null || exit 0
[ -d "$LEDGER" ] || exit 0

# Which tasks are currently claiming the fast path?
skipping=""
for f in "$LEDGER"/*.md; do
  [ -e "$f" ] || continue
  rv=$(sed -n 's/^review:[[:space:]]*//p' "$f" | head -1)
  st=$(sed -n 's/^state:[[:space:]]*//p'  "$f" | head -1)
  case "$rv" in skip|Skip|SKIP) ;; *) continue ;; esac
  case "$st" in in-progress|done) ;; *) continue ;; esac
  id=$(sed -n 's/^id:[[:space:]]*//p' "$f" | head -1)
  skipping="$skipping ${id:-unknown}"
done

[ -z "$skipping" ] && exit 0

# What actually changed? Uncommitted, staged, committed-since-origin, AND
# untracked. Untracked matters more than it looks: `git diff` does not list files
# that have never been added, so a builder creating a brand new migration or config
# file would otherwise pass this check with an empty diff.
changed=$( { git diff --name-only 2>/dev/null
             git diff --name-only --cached 2>/dev/null
             git ls-files --others --exclude-standard 2>/dev/null
             git diff --name-only "$(git merge-base HEAD origin/HEAD 2>/dev/null || echo HEAD)"..HEAD 2>/dev/null
           } | sort -u | grep -v '^$' )

[ -z "$changed" ] && exit 0

violations=""
count=0
for path in $changed; do
  count=$((count + 1))
  case "$path" in
    # Hard denials first — these are never presentational regardless of extension.
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

    # Allowed: stylesheets and static assets, unconditionally presentational.
    src/*.css|src/**/*.css|*.css|*.scss) ;;
    public/*|src/*.svg|src/**/*.svg|*.png|*.jpg|*.jpeg|*.webp|*.ico) ;;

    # Component files are allowed but not assumed — see the logic check below.
    src/*) ;;

    *) violations="$violations
  $path — outside src/" ;;
  esac
done

# File-count ceiling from the handbook.
if [ "$count" -gt 3 ]; then
  violations="$violations
  $count files changed — the fast path allows at most 3"
fi

# A .tsx/.ts file can be presentational (class names, copy) or not (logic). Look
# at the added lines for logic constructs rather than trusting the file extension.
for path in $changed; do
  case "$path" in
    *.ts|*.tsx|*.js|*.jsx) ;;
    *) continue ;;
  esac
  [ -f "$path" ] || continue
  added=$(git diff -U0 -- "$path" 2>/dev/null | grep '^+' | grep -v '^+++')
  [ -z "$added" ] && added=$(git diff -U0 --cached -- "$path" 2>/dev/null | grep '^+' | grep -v '^+++')
  [ -z "$added" ] && continue
  if printf '%s' "$added" | grep -qE '\b(useState|useEffect|useReducer|useMemo|useCallback|fetch|await|async|createClient|supabase)\b|=>[[:space:]]*\{|\bif[[:space:]]*\(|\breturn[[:space:]]+.*\?'; then
    violations="$violations
  $path — added logic (hooks, control flow, or data access), not presentation"
  fi
done

[ -z "$violations" ] && exit 0

cat >&2 <<EOF
Task(s)$skipping are marked \`review: skip\`, but the diff is not presentational:
$violations

The fast path is for CSS, Tailwind classes, spacing, colour, copy, and asset
swaps — at most three files, no logic. This change is outside that boundary.

Set \`review: full\` on the task and dispatch the reviewer. Do not narrow the diff
to fit the fast path; if the work genuinely needs doing, it genuinely needs review.
EOF

exit 2

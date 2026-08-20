#!/bin/bash
# PreToolUse:Bash — denies commands from the handbook's reversibility list.
# Backs up the permissions deny rules; hook `if` filters fail open, so this
# inspects the whole command string itself.

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null)
# If jq is missing or broken, cmd extracts empty and every deny below would
# silently allow — the input-side twin of the output bug fixed in deny(). Fall
# back to matching against the raw JSON payload: patterns still hit inside the
# encoded string, and an occasional false deny in this degraded state is the
# right failure direction for a deny hook.
if [ -z "$cmd" ] && [ -n "$input" ]; then
  cmd="$input"
fi

# Pure-bash JSON string escape — used by deny() below so a deny decision can
# still reach stdout even if jq itself fails.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

deny() {
  local reason="$1" out
  # jq's output is CAPTURED, not streamed — a prior version piped jq -n
  # straight to stdout with no check. If jq fails for any reason (missing
  # feature on an old version, OOM, killed), it prints nothing and the
  # function still exited 0. Empty stdout with exit 0 reads to the harness
  # as "no decision", which for a deny hook means silent allow — the exact
  # opposite of what it was trying to do. Found via a live report of the
  # same bug in parallel-cap.sh; fixed here too since this file has the
  # identical pattern.
  out=$(jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }' 2>/dev/null)
  if [ -z "$out" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' \
      "$(json_escape "$reason")"
  else
    printf '%s\n' "$out"
  fi
  exit 0
}

# Bash-based mutation of the fleet's own control surface. protect-fleet.sh
# covers the Edit/Write/MultiEdit tools; it has no visibility into Bash, and
# git can rewrite any of these files without ever touching those tools —
# `git checkout -- <path>`, `git apply`, `git stash pop`, a redirect, sed -i,
# cp, mv. This was not theoretical: an orchestrator used exactly this route
# to test a patch against parallel-cap.sh, sidestepping protect-fleet.sh
# entirely, and disclosed it afterward rather than being caught by anything
# here. This does not claim to catch every possible way Bash could mutate a
# file — that is not a closeable set — but it closes the obvious, common
# ones rather than leaving Bash as a completely unguarded path.
# MAINTENANCE OVERRIDE. Fleet-tooling tasks (fixing a hook, patching bin/) are
# by definition writes to the protected surface, which made them undispatchable
# by any agent. The owner grants an exception per task by listing the task id
# in the MAIN checkout's .claude/gates.json:
#
#   { "maintenance": ["OT-129A"] }
#
# The override holds only when this session's project dir is that task's
# worktree (wt-<ID>). gates.json is read from the main checkout — resolved via
# git-common-dir — so the flag is set once, uncommitted, and honoured in every
# worktree, and an agent cannot grant itself the flag by writing a gates.json
# into its own worktree. gates.json itself and the two guard hooks stay denied
# even under the override, so a maintenance agent cannot widen its own grant.
maint_active() {
  local base id common main gates
  base=$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")
  case "$base" in wt-*) id="${base#wt-}" ;; *) return 1 ;; esac
  common=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --git-common-dir 2>/dev/null) || return 1
  case "$common" in
    '') return 1 ;;
    /*) : ;;
    *) common="${CLAUDE_PROJECT_DIR:-$PWD}/$common" ;;
  esac
  main="${common%/.git}"; main="${main%/}"
  gates="$main/.claude/gates.json"
  [ -s "$gates" ] || return 1
  jq -e --arg id "$id" '(.maintenance // []) | index($id) != null' "$gates" >/dev/null 2>&1
}

# Bash-based mutation of the fleet's control surface. Deny on WRITE INTENT, not
# mere mention: the previous version denied any command containing a protected
# path plus any ">", which caught stderr redirects like `2>/dev/null` and made
# read-only `cat .claude/hooks/x.sh 2>/dev/null` collateral. Reads must pass —
# agents need to read the hooks to understand the rules that bind them.
FLEET_PATHS='(\.claude/(hooks|agents)(/|[^a-zA-Z]|$)|\.claude/settings\.json|\.claude/gates\.json|CLAUDE\.md|(^|[[:space:]"'\''=;&|(])(\./)?bin/)'
if echo "$cmd" | grep -Eq "$FLEET_PATHS"; then
  fleet_write=""
  # 1. A redirect whose TARGET is a protected path. `[^0-9&<>]` before the `>`
  #    exempts fd redirects (2>, &>) unless their target is protected, which
  #    the target match still catches.
  if echo "$cmd" | grep -Eq '>>?[[:space:]]*["'\'']?[^[:space:]|;&]*(\.claude/(hooks|agents)/|\.claude/settings\.json|\.claude/gates\.json|CLAUDE\.md|bin/)'; then
    fleet_write=1
  # 2. A mutating verb anywhere in a command that mentions a protected path.
  elif echo "$cmd" | grep -Eq '(^|[;&|[:space:]])(rm|mv|cp|tee|chmod|chown|truncate|ln|rsync|install)[[:space:]]'; then
    fleet_write=1
  # 3. In-place editors.
  elif echo "$cmd" | grep -Eq 'sed[[:space:]]+(-[^-[:space:]]*[[:space:]]+)*(-i|--in-place)|perl[[:space:]]+(-[a-zA-Z]*i[a-zA-Z]*([[:space:]]|$)|.*--in-place)'; then
    fleet_write=1
  # 4. Git operations that rewrite working-tree files without Edit/Write.
  elif echo "$cmd" | grep -Eq 'git[[:space:]]+(checkout|restore|apply|cherry-pick)|git[[:space:]]+stash[[:space:]]+(pop|apply)'; then
    fleet_write=1
  fi

  if [ -n "$fleet_write" ]; then
    # Never overridable: the grant file and the guards that read it.
    if echo "$cmd" | grep -Eq '\.claude/gates\.json|deny-irreversible\.sh|protect-fleet\.sh'; then
      deny "Writes to gates.json, deny-irreversible.sh, and protect-fleet.sh are denied unconditionally — the maintenance override does not extend to the grant file or the guards that enforce it."
    fi
    if ! maint_active; then
      deny "Bash-based writes to fleet infrastructure (hooks, agent cards, settings, CLAUDE.md, bin/) are denied — same boundary as protect-fleet.sh, enforced here because git and shell redirection don't go through the Edit or Write tools. For a sanctioned fleet-tooling task, the owner lists the task id under \"maintenance\" in the main checkout's .claude/gates.json; otherwise ask the owner to make this change upstream and re-run add-fleet."
    fi
  fi
fi

# Irreversible git history operations
case "$cmd" in
  *"push --force"*|*"push -f "*)   deny "Force-push is denied. Open a branch and let the merge queue handle it." ;;
  *"filter-branch"*|*"filter-repo"*) deny "History rewrite is denied." ;;
  *"reset --hard"*)                deny "Hard reset is denied. Stash or branch instead." ;;
  *"branch -D main"*|*"push origin --delete"*) deny "Branch deletion is denied." ;;
esac

# Destructive filesystem
case "$cmd" in
  *"rm -rf /"*|*"rm -rf ~"*|*"rm -fr /"*) deny "Recursive delete outside the worktree is denied." ;;
esac

# Destructive or non-additive migrations
case "$cmd" in
  *"DROP TABLE"*|*"DROP DATABASE"*|*"TRUNCATE "*|*"drop table"*) \
    deny "Destructive migration is denied. Additive migrations only." ;;
  *"supabase db reset"*|*"prisma migrate reset"*) \
    deny "Database reset is denied against any non-local target." ;;
esac

# Real messages, publishing, payment
case "$cmd" in
  *"vercel --prod"*|*"vercel deploy --prod"*) \
    deny "Production deploy is denied. Preview deploys only." ;;
  *"npm publish"*|*"gh release create"*) \
    deny "Publishing is denied." ;;
  *"stripe "*) \
    deny "Payment operations are denied." ;;
esac

exit 0

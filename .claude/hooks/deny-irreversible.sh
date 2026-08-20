#!/bin/bash
# PreToolUse:Bash — denies commands from the handbook's reversibility list.
# Backs up the permissions deny rules; hook `if` filters fail open, so this
# inspects the whole command string itself.

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")

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
case "$cmd" in
  *".claude/hooks/"*|*".claude/agents/"*|*".claude/settings.json"*|*".claude/gates.json"*|*"CLAUDE.md"*|*" bin/"*|*"./bin/"*)
    case "$cmd" in
      *"git checkout"*|*"git restore"*|*"git apply"*|*"git stash pop"*|*"git stash apply"*|*"git cherry-pick"*|*"sed -i"*|*"sed --in-place"*|*"cp "*|*"mv "*|*"tee "*|*">"*|*"perl -i"*)
        deny "Bash-based writes to fleet infrastructure (hooks, agent cards, settings, CLAUDE.md, bin/) are denied — same boundary as protect-fleet.sh, enforced here because git and shell redirection don't go through the Edit or Write tools. Ask the owner to make this change upstream and re-run add-fleet."
        ;;
    esac
    ;;
esac

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

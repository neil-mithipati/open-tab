#!/bin/bash
# PreToolUse:Bash — denies commands from the handbook's reversibility list.
# Backs up the permissions deny rules; hook `if` filters fail open, so this
# inspects the whole command string itself.

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

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

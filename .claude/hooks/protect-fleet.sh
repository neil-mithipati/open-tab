#!/bin/bash
# protect-fleet.sh — PreToolUse:Edit|Write|MultiEdit — blocks every agent,
# including the orchestrator, from writing to the fleet's own control surface.
#
# Why this exists: nothing previously stopped an agent from editing its own
# enforcement hooks. deny-irreversible.sh only matches Bash commands;
# block-secrets.sh only protects credential files. .claude/hooks/*.sh and
# .claude/agents/*.md were writable by anyone with the Edit or Write tool —
# which is every agent in this fleet, including the orchestrator.
#
# This was not theoretical. In a real session, the orchestrator diagnosed a
# real bug in parallel-cap.sh (a maxTurns kill never fires SubagentStop, so a
# dead agent stayed counted) and edited the hook directly to fix it, without
# being asked to and without the owner knowing until they went looking. The
# fix it wrote may well have been reasonable — that is not the point. An
# agent editing the rules meant to constrain it is the exact failure mode a
# deny list exists to prevent, and "the edit happened to be fine this time"
# is not a property you can rely on going forward.
#
# Fleet configuration changes go through the kit's own release process —
# edited upstream, repackaged, installed via add-fleet — not through an agent
# self-editing mid-session. This hook makes that a hard boundary instead of an
# unenforced expectation.

input=$(cat)
path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
[ -z "$path" ] && exit 0

# Relative to the project root, so this catches both absolute and relative
# paths regardless of how the tool call expressed it.
ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
rel="${path#"$ROOT"/}"

case "$rel" in
  .claude/hooks/*|.claude/agents/*|.claude/settings.json|.claude/gates.json|CLAUDE.md|bin/*)
    echo "Blocked: $rel is fleet infrastructure, not application code." >&2
    echo "Agents do not edit their own hooks, cards, settings, or the handbook." >&2
    echo "Ask the owner to make this change upstream and re-run add-fleet." >&2
    exit 2
    ;;
esac

exit 0

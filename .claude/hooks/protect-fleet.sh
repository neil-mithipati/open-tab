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
# paths regardless of how the tool call expressed it. An absolute path OUTSIDE
# the root (e.g. a worktree agent aiming at the main checkout's hooks) leaves
# rel untouched, so a second suffix match below catches those too — matching
# only relative to $ROOT was a bypass.
ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
rel="${path#"$ROOT"/}"

# MAINTENANCE OVERRIDE — same grant as deny-irreversible.sh. The owner lists a
# task id under "maintenance" in the MAIN checkout's .claude/gates.json; the
# override holds only when this session's project dir is that task's worktree
# (wt-<ID>). gates.json and the two guard hooks are never overridable.
maint_active() {
  local base id common main gates
  base=$(basename "$ROOT")
  case "$base" in wt-*) id="${base#wt-}" ;; *) return 1 ;; esac
  common=$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null) || return 1
  case "$common" in
    '') return 1 ;;
    /*) : ;;
    *) common="$ROOT/$common" ;;
  esac
  main="${common%/.git}"; main="${main%/}"
  gates="$main/.claude/gates.json"
  [ -s "$gates" ] || return 1
  jq -e --arg id "$id" '(.maintenance // []) | index($id) != null' "$gates" >/dev/null 2>&1
}

hit=""
case "$rel" in
  .claude/hooks/*|.claude/agents/*|.claude/settings.json|.claude/gates.json|CLAUDE.md|bin/*) hit=1 ;;
esac
case "$path" in
  */.claude/hooks/*|*/.claude/agents/*|*/.claude/settings.json|*/.claude/gates.json|*/CLAUDE.md) hit=1 ;;
esac

if [ -n "$hit" ]; then
  case "$path" in
    */.claude/gates.json|.claude/gates.json|*deny-irreversible.sh|*protect-fleet.sh)
      echo "Blocked: gates.json and the guard hooks are never editable by agents," >&2
      echo "even under a maintenance grant — the override cannot widen itself." >&2
      exit 2
      ;;
  esac
  if maint_active; then
    exit 0
  fi
  echo "Blocked: $rel is fleet infrastructure, not application code." >&2
  echo "Agents do not edit their own hooks, cards, settings, or the handbook." >&2
  echo "For a sanctioned fleet-tooling task, the owner lists the task id under" >&2
  echo "\"maintenance\" in the main checkout's .claude/gates.json. Otherwise ask" >&2
  echo "the owner to make this change upstream and re-run add-fleet." >&2
  exit 2
fi

exit 0

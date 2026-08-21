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
#
# Every decision below is made on the CANONICAL target path. Matching the raw
# string was the bug behind OT-150 and OT-152: `.claude//hooks/x` and
# `./bin/doctor` missed the matcher entirely, and `wt-OT-147/../open-tab/...`
# — or a directory named wt-OT-147 in /tmp holding a `.claude` symlink —
# carried a maintenance grant straight into the main checkout's hooks.

set -f  # no globbing; the IFS splitting below must stay literal

input=$(cat)
path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
[ -z "$path" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

# Lexical cleanup of an absolute path: drops empty segments (// and a trailing
# /), drops `.`, folds `x/..`. Only ever applied to a prefix already resolved
# on disk plus a tail that does not exist yet.
lex_norm() {
  local seg out=""
  local IFS=/
  for seg in $1; do
    case "$seg" in
      ''|.) continue ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s' "${out:-/}"
}

# Canonical absolute path, symlinks resolved, WITHOUT requiring the target to
# exist — a first write to a brand-new hook file has to be matched too, which
# is why this is not `realpath` (it fails on a missing path, and `-m` is not
# portable). Walk up to the deepest existing ancestor, let `cd -P` resolve
# that one for real, then re-attach the missing tail.
#
# The walk alone stops at the deepest existing DIRECTORY, so a symlink used as
# the FINAL component survives it: `<dir>/link -> .claude/hooks/log-event.sh`
# would be matched as `<dir>/link` while the write lands on the real hook. A
# symlink-to-directory in the tail is already resolved by `cd -P`; only the
# last component needs this. So: after each walk, if the result is still a
# symlink, read it, re-anchor a relative target on the link's own directory,
# and walk again. Bounded at 40 hops so a symlink loop cannot hang the hook.
canon_path() {
  local p="$1" dir next tail real link hops=0
  case "$p" in
    /*) : ;;
    *) p="$ROOT/$p" ;;
  esac
  while : ; do
    tail=""
    dir="$p"
    while [ ! -d "$dir" ]; do
      tail="${dir##*/}${tail:+/$tail}"
      next="${dir%/*}"
      if [ -z "$next" ] || [ "$next" = "$dir" ]; then
        dir="/"
        break
      fi
      dir="$next"
    done
    real=$(cd -P "$dir" 2>/dev/null && pwd -P) || real="$dir"
    p=$(lex_norm "$real/$tail")
    [ -L "$p" ] || break
    hops=$((hops + 1))
    [ "$hops" -le 40 ] || break
    link=$(readlink "$p" 2>/dev/null) || break
    [ -n "$link" ] || break
    case "$link" in
      /*) p="$link" ;;
      *) p="${p%/*}/$link" ;;
    esac
  done
  printf '%s' "$p"
}

cpath=$(canon_path "$path")
ROOTC=$(canon_path "$ROOT")
rel="${cpath#"$ROOTC"/}"

# Case folding, deliberately one-directional. This volume is case-insensitive
# APFS and bash's `pwd -P` does not correct the case of a path component, so
# `.claude/Gates.json`, `Claude.md` and `Protect-Fleet.sh` all open the real
# files while missing a case-sensitive glob — one letter of case was enough to
# let a granted agent rewrite the grant file and both guard hooks.
#
# Every DENY match below runs against a lowercased copy. The GRANT side does
# not: `shopt -s nocasematch` is shell-scoped and would also loosen the
# worktree containment test in maint_active (`case "$cpath" in "$p"/*`), so on
# a case-SENSITIVE volume a directory named `WT-OT-150` would inherit the grant
# issued for `wt-OT-150`. Over-denying is harmless; over-granting is the hole
# being closed. Lowercasing only the deny inputs keeps the looseness pointed in
# the safe direction, on either kind of volume.
#
# Patterns matched against $lcpath and $lrel must be written in lowercase.
lcpath=$(printf '%s' "$cpath" | tr '[:upper:]' '[:lower:]')
lrel=$(printf '%s' "$rel" | tr '[:upper:]' '[:lower:]')

# MAINTENANCE OVERRIDE — the owner lists a task id under "maintenance" in the
# MAIN checkout's .claude/gates.json, and the grant then covers writes that
# land inside that task's worktree. The worktree comes from
# `git worktree list --porcelain` run on the session root, so it has to be a
# real registered worktree of this repo — not any directory whose name happens
# to start with `wt-`, and not a path that merely contains one. gates.json and
# the two guard hooks are never overridable.
maint_active() {
  local main gates wt="" id="" line p

  main=$(git -C "$ROOTC" rev-parse --git-common-dir 2>/dev/null) || return 1
  case "$main" in
    '') return 1 ;;
    /*) : ;;
    *) main="$ROOTC/$main" ;;
  esac
  main=$(canon_path "$main")
  main="${main%/.git}"
  main="${main%/}"
  [ -n "$main" ] || return 1

  gates="$main/.claude/gates.json"
  [ -s "$gates" ] || return 1

  while IFS= read -r line; do
    case "$line" in
      'worktree '*) p="${line#worktree }" ;;
      *) continue ;;
    esac
    p=$(canon_path "$p")
    # The main checkout is never a grantable worktree.
    [ "$p" = "$main" ] && continue
    case "$cpath" in
      "$p"/*) [ "${#p}" -gt "${#wt}" ] && wt="$p" ;;
    esac
  done <<<"$(git -C "$ROOTC" worktree list --porcelain 2>/dev/null)"

  [ -n "$wt" ] || return 1

  id="${wt##*/}"
  case "$id" in
    wt-*) id="${id#wt-}" ;;
    *) return 1 ;;
  esac
  case "$id" in
    ''|*[!A-Za-z0-9_-]*) return 1 ;;
  esac

  jq -e --arg id "$id" '(.maintenance // []) | index($id) != null' "$gates" >/dev/null 2>&1
}

# Never overridable, and checked before anything else: an override that can
# edit the grant file or the guards can widen itself. This used to sit inside
# the `hit` branch, so any spelling that missed the matcher skipped it too.
case "$lcpath" in
  */.claude/gates.json|*deny-irreversible.sh|*protect-fleet.sh)
    echo "Blocked: gates.json and the guard hooks are never editable by agents," >&2
    echo "even under a maintenance grant — the override cannot widen itself." >&2
    exit 2
    ;;
esac

hit=""
case "$lrel" in
  .claude/hooks/*|.claude/agents/*|.claude/settings.json|.claude/gates.json|claude.md|bin/*) hit=1 ;;
esac
# The same list by absolute path, for a target outside the session root — a
# worktree agent aiming at the main checkout, or at another checkout entirely.
# `bin/` is here too; it used to be protected only relative to $ROOT.
case "$lcpath" in
  */.claude/hooks/*|*/.claude/agents/*|*/.claude/settings.json|*/.claude/gates.json|*/claude.md) hit=1 ;;
  # A package's own bin/ is not the fleet's. This carve-out matters only
  # because the tail symlink is now resolved: `node_modules/.bin/next` does
  # not contain a literal `/bin/`, but it is a link to
  # `node_modules/next/dist/bin/next`, which does. First match wins, so this
  # narrows the `bin/` clause below and nothing above it.
  */node_modules/*) : ;;
  */bin/*) hit=1 ;;
esac

if [ -n "$hit" ]; then
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

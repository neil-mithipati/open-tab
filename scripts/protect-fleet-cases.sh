#!/bin/bash
# protect-fleet-cases.sh — case harness for the fleet guard hook.
#
#   bash scripts/protect-fleet-cases.sh .claude/hooks/protect-fleet.sh
#
# Feeds a hook one case at a time as JSON on stdin (`.tool_input.file_path`),
# exactly the way PreToolUse:Edit|Write|MultiEdit does, and compares the exit
# status against the expected verdict: 0 = ALLOW, 2 = DENY. Prints one line per
# case and exits non-zero if any case fails.
#
# A failing case means the guard has a hole. Report it; do not patch the hook to
# make this script green.
#
# The case list is the one recorded in ledger/OT-152.md (the OT-150 candidate
# review, 96 cases, harness since lost) plus the four edges filed as OT-154.
# The OT-154 cases assert the guard's CURRENT behaviour, tagged [OT-154#n], so
# that landing OT-154 flips them here deliberately rather than silently.
#
# Every fixture is built under `mktemp -d` and removed on exit, including on
# failure. Nothing is ever written inside a repo checkout: the guard denies
# writes to `.claude/`, `bin/`, `CLAUDE.md` and `gates.json`, so a fixture named
# `.claude/Gates.json` inside this repo would be blocked, and correctly so.
# The grant cases need real registered worktrees, so the fixture is its own git
# repo with its own worktrees and its own `.claude/gates.json` grant — no
# worktree of this repo is touched or relied on.

set -u

HOOK="${1:-}"
if [ -z "$HOOK" ]; then
  echo "usage: bash scripts/protect-fleet-cases.sh <path-to-protect-fleet.sh>" >&2
  exit 64
fi
if [ ! -f "$HOOK" ]; then
  echo "no such hook: $HOOK" >&2
  exit 64
fi
HOOK=$(cd -P "$(dirname "$HOOK")" && pwd -P)/$(basename "$HOOK")
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 64; }

# ---------------------------------------------------------------- fixtures ---

FIX=$(mktemp -d) || { echo "mktemp -d failed" >&2; exit 64; }
cleanup() { rm -rf "$FIX"; }
trap cleanup EXIT INT TERM
# $TMPDIR on darwin is itself a symlink (/var -> /private/var). Canonicalise it
# once so the fixture paths this script builds match what the hook resolves.
FIX=$(cd -P "$FIX" && pwd -P)

MAIN="$FIX/open-tab"     # fixture "main checkout"
WT="$FIX/wt-FX-001"      # registered worktree, granted
WT2="$FIX/wt-FX-002"     # registered worktree, NOT granted

mk() { mkdir -p "$(dirname "$1")" && printf '%s\n' "${2:-x}" >"$1"; }

mkdir -p "$MAIN"
mk "$MAIN/.claude/hooks/protect-fleet.sh" '# fixture stand-in'
mk "$MAIN/.claude/hooks/deny-irreversible.sh" '# fixture stand-in'
mk "$MAIN/.claude/hooks/log-event.sh" '# fixture stand-in'
mk "$MAIN/.claude/agents/reviewer.md" '# reviewer'
mk "$MAIN/.claude/settings.json" '{}'
mk "$MAIN/CLAUDE.md" '# handbook'
mk "$MAIN/bin/doctor" '#!/bin/bash'
mk "$MAIN/src/app/page.tsx" 'export default function P() { return null }'
mk "$MAIN/src/lib/money.ts" 'export const zero = 0'
mk "$MAIN/ledger/FX-001.md" '# task'
mk "$MAIN/docs/kanban.md" '# board'
printf '{\n  "required": ["lint"],\n  "maintenance": ["FX-001"]\n}\n' \
  >"$MAIN/.claude/gates.json"

git -C "$MAIN" init -q -b main >/dev/null 2>&1 || { echo "git init failed" >&2; exit 64; }
git -C "$MAIN" add -A >/dev/null 2>&1
git -C "$MAIN" -c user.name=fixture -c user.email=fixture@example.com \
  commit -q --no-verify -m 'fixture' >/dev/null 2>&1
git -C "$MAIN" worktree add -q -b task/FX-001 "$WT" >/dev/null 2>&1
git -C "$MAIN" worktree add -q -b task/FX-002 "$WT2" >/dev/null 2>&1
if [ ! -f "$WT/.claude/hooks/protect-fleet.sh" ] || [ ! -f "$WT2/CLAUDE.md" ]; then
  echo "could not build the fixture worktrees — grant cases cannot run" >&2
  exit 64
fi

# Untracked extras in the fixture main checkout (not needed in the worktrees).
mk "$MAIN/node_modules/next/dist/bin/next" '#!/usr/bin/env node'
mkdir -p "$MAIN/node_modules/.bin"
ln -s ../next/dist/bin/next "$MAIN/node_modules/.bin/next"
mk "$MAIN/bin/node_modules/evil" 'x'                    # OT-154 finding 1
mk "$MAIN/src/lib/protect-fleet.sh" '# app file, not a hook'  # OT-154 finding 3
mk "$MAIN/src/app/docs/CLAUDE.md" '# nested, not the handbook' # OT-154 finding 4
mk "$MAIN/src/app/café ☕.tsx" 'x'
mk "$MAIN/src/app/it's \"quoted\".tsx" 'x'
LONGNAME=$(printf 'a%.0s' $(seq 1 3000))

# Another checkout entirely, and the kit the hook is released from.
mk "$FIX/agent-fleet-kit/.claude/hooks/protect-fleet.sh" '# kit copy'
mk "$FIX/other-checkout/bin/doctor" '#!/bin/bash'
mk "$FIX/other-checkout/bin/node_modules/evil" 'x'      # OT-154 finding 1
# A loose copy outside any checkout.
mk "$FIX/tmpcopy/protect-fleet.sh" '# loose copy'
# Directories merely NAMED like the granted worktree, one holding a real
# .claude tree and one holding a .claude symlink into the main checkout.
mk "$FIX/fake/wt-FX-001/.claude/hooks/log-event.sh" '# not a worktree'
mkdir -p "$FIX/fakelink/wt-FX-001"
ln -s "$MAIN/.claude" "$FIX/fakelink/wt-FX-001/.claude"
# Symlinks: final component, directory in the tail, and a loop.
mkdir -p "$FIX/link-lab"
ln -s "$MAIN/.claude/hooks/log-event.sh" "$FIX/link-lab/link"
ln -s "$MAIN/.claude/hooks" "$FIX/link-lab/hookdir"
ln -s "$FIX/link-lab/loop-b" "$FIX/link-lab/loop-a"
ln -s "$FIX/link-lab/loop-a" "$FIX/link-lab/loop-b"

# This volume decides whether the case-variant block is meaningful at all. On
# case-insensitive APFS (the default on darwin) `.claude/Gates.json` opens the
# real grant file, which is the whole point of those cases. On a case-sensitive
# volume it opens nothing, so they are skipped rather than counted as passes.
CI=0
[ -f "$MAIN/.claude/Gates.json" ] && CI=1

# ------------------------------------------------------------------ runner ---

ok=0; bad=0; skipped=0
R="$MAIN"   # CLAUDE_PROJECT_DIR for the next case; "-" means unset
C="$MAIN"   # cwd for the next case

verdict() {
  local json rc
  json=$(jq -n --arg p "$1" '{tool_input: {file_path: $p}}')
  if [ "$R" = "-" ]; then
    ( cd "$C" 2>/dev/null || cd / ; env -u CLAUDE_PROJECT_DIR bash "$HOOK" >/dev/null 2>&1 ) <<<"$json"
  else
    ( cd "$C" 2>/dev/null || cd / ; CLAUDE_PROJECT_DIR="$R" bash "$HOOK" >/dev/null 2>&1 ) <<<"$json"
  fi
  rc=$?
  case "$rc" in
    0) printf 'ALLOW' ;;
    2) printf 'DENY' ;;
    *) printf 'ERR%s' "$rc" ;;
  esac
}

# check <ALLOW|DENY> <real|new|-> <path> <label>
#   real — the path must open an existing file first, so a DENY is never a
#          lucky miss on a path that does not exist. Trailing slashes are
#          stripped before the test: `-f` on `<file>/` is false by definition,
#          and the trailing-slash case is about the spelling, not the file.
#   new  — the path must NOT exist, for the first-write-to-a-new-file cases
# Both run from $C, so a relative case asserts against the same cwd the hook
# will resolve it from, not against the checkout this harness was started in.
check() {
  local want="$1" assert="$2" path="$3" label="$4" got
  case "$assert" in
    real)
      if ! ( cd "$C" 2>/dev/null && [ -f "${path%/}" ] ); then
        printf 'FAIL  %-5s  assert [ -f ] failed  %s\n' "$want" "$label"
        bad=$((bad + 1)); return
      fi ;;
    new)
      if ( cd "$C" 2>/dev/null && [ -e "$path" ] ); then
        printf 'FAIL  %-5s  assert [ ! -e ] failed  %s\n' "$want" "$label"
        bad=$((bad + 1)); return
      fi ;;
  esac
  got=$(verdict "$path")
  if [ "$got" = "$want" ]; then
    printf 'ok    %-5s  %s\n' "$want" "$label"
    ok=$((ok + 1))
  else
    printf 'FAIL  %-5s  got %-5s  %s\n' "$want" "$got" "$label"
    bad=$((bad + 1))
  fi
}

skip() { printf 'skip         %s (%s)\n' "$1" "$2"; skipped=$((skipped + 1)); }
section() { printf '\n-- %s\n' "$1"; }

# ------------------------------------------------------------------- cases ---

section 'baseline: fleet paths in the main checkout deny with no grant'
R="$MAIN"; C="$MAIN"
check DENY real "$MAIN/.claude/hooks/log-event.sh"    'hooks/log-event.sh'
check DENY real "$MAIN/.claude/agents/reviewer.md"    'agents/reviewer.md'
check DENY real "$MAIN/.claude/settings.json"         'settings.json'
check DENY real "$MAIN/.claude/gates.json"            'gates.json'
check DENY real "$MAIN/CLAUDE.md"                     'CLAUDE.md'
check DENY real "$MAIN/bin/doctor"                    'bin/doctor'
check DENY real "$MAIN/.claude/hooks/protect-fleet.sh" 'protect-fleet.sh'
check DENY real "$MAIN/.claude/hooks/deny-irreversible.sh" 'deny-irreversible.sh'

section 'case variants — one letter of case must not defeat any deny'
if [ "$CI" = 1 ]; then
  R="$MAIN"; C="$MAIN"
  check DENY real "$MAIN/.claude/Gates.json"          '.claude/Gates.json (the real grant file)'
  check DENY real "$MAIN/.Claude/gates.json"          '.Claude/gates.json (case-variant DIRECTORY)'
  check DENY real "$MAIN/Claude.md"                   'Claude.md (the real handbook)'
  check DENY real "$MAIN/.claude/Agents/reviewer.md"  '.claude/Agents/reviewer.md'
  check DENY real "$MAIN/Bin/doctor"                  'Bin/doctor'
  R="$WT"; C="$WT"
  check DENY real "$WT/.claude/hooks/Protect-Fleet.sh"    'wt/Protect-Fleet.sh under a live grant'
  check DENY real "$WT/.claude/hooks/Deny-Irreversible.sh" 'wt/Deny-Irreversible.sh under a live grant'
  check DENY real "$WT/.claude/hooks/protect-fleet.sh"    'wt/protect-fleet.sh under a live grant (lowercase)'
else
  for v in '.claude/Gates.json' '.Claude/gates.json' 'Claude.md' \
           '.claude/Agents/reviewer.md' 'Bin/doctor' \
           'wt/Protect-Fleet.sh' 'wt/Deny-Irreversible.sh' 'wt/protect-fleet.sh'; do
    skip "$v" 'case-sensitive volume: the variant opens no real file'
  done
fi

section 'spellings of the same file'
R="$MAIN"; C="$MAIN"
check DENY real "$MAIN/.claude//hooks/protect-fleet.sh"  'doubled slash'
check DENY real "$MAIN/./bin/doctor"                     'dot segment'
check DENY real "$MAIN/.claude/hooks/../hooks/log-event.sh" 'interior ..'
check DENY real "$MAIN/.claude/hooks/protect-fleet.sh/"  'trailing slash'
check DENY real "./bin/doctor"                           'relative ./ spelling'
R="$WT"; C="$WT"
check DENY real "$WT/../open-tab/bin/doctor"             'climb-out from a granted worktree'
check DENY real "$MAIN/.claude/hooks/log-event.sh"       'session rooted in the worktree, target the main checkout'
R="$MAIN"; C="$MAIN"
check DENY new  "$MAIN/.claude/hooks/brand-new-hook.sh"  'nonexistent target — first write to a new hook'
check DENY real "$FIX/tmpcopy/protect-fleet.sh"          'a loose copy outside any checkout'
check DENY real "$FIX/agent-fleet-kit/.claude/hooks/protect-fleet.sh" 'the kit copy'
check DENY real "$FIX/other-checkout/bin/doctor"         'another checkout entirely'
check DENY real "$FIX/fake/wt-FX-001/.claude/hooks/log-event.sh" 'a directory merely NAMED like the granted worktree'
check DENY real "$FIX/fakelink/wt-FX-001/.claude/hooks/log-event.sh" 'wt-named directory holding a .claude symlink into the checkout'
check DENY real "$WT2/.claude/hooks/log-event.sh"        'a registered worktree with no grant'
check ALLOW -   '/nope/../../../etc-does-not-exist'      '.. above / returns / without crashing'
R="-";    C="$MAIN"
check DENY real ".claude/hooks/log-event.sh"             'unset CLAUDE_PROJECT_DIR, relative path — fails closed'
R="$FIX/no-such-root"; C="$MAIN"
check DENY real "$MAIN/.claude/hooks/log-event.sh"       'bogus CLAUDE_PROJECT_DIR — fails closed'
check DENY real "$WT/.claude/hooks/log-event.sh"         'bogus CLAUDE_PROJECT_DIR, granted worktree — fails closed'

section 'symlinks'
R="$MAIN"; C="$MAIN"
check DENY real "$FIX/link-lab/link"              'symlink as the FINAL component'
check DENY real "$FIX/link-lab/hookdir/log-event.sh" 'symlink to a directory in the tail'
check DENY new  "$FIX/link-lab/hookdir/brand-new.sh" 'brand-new file behind a directory link'

section '*/bin/* and the node_modules carve-out'
check ALLOW -   "$MAIN/node_modules/.bin/next"    'node_modules/.bin/next'
check ALLOW real "$MAIN/node_modules/next/dist/bin/next" 'its resolved target'
check DENY real "$MAIN/node_modules/.bin/../../bin/doctor" 'node_modules/.bin/../../bin/doctor folds back'

section 'no false denials'
R="$MAIN"; C="$MAIN"
check ALLOW real "$MAIN/src/app/page.tsx"          'app code'
check ALLOW real "$MAIN/src/lib/money.ts"          'app library code'
check ALLOW real "$MAIN/ledger/FX-001.md"          'a ledger file'
check ALLOW real "$MAIN/docs/kanban.md"            'docs/kanban.md'
check ALLOW -    "src/app/page.tsx"                'a relative path'
check ALLOW real "$MAIN/src/app/café ☕.tsx"        'unicode in the filename'
check ALLOW -    "$MAIN/src/app/two
lines.tsx"                                         'an embedded newline'
check ALLOW real "$MAIN/src/app/it's \"quoted\".tsx" 'quotes in the filename'
check ALLOW -    "$MAIN/src/app/$LONGNAME.tsx"     'a 3000-character filename'
check ALLOW -    ""                                'an empty path'
R="$WT"; C="$WT"
check ALLOW real "$WT/src/app/page.tsx"            'app code in a granted worktree'
check ALLOW new  "$WT/src/app/brand-new.tsx"       'a new app file in a granted worktree'
check ALLOW real "$WT/.claude/hooks/log-event.sh"  "a granted worktree's own hooks"
check ALLOW real "$WT/.claude/agents/reviewer.md"  "a granted worktree's own cards"
check ALLOW real "$WT/.claude/settings.json"       "a granted worktree's own settings"
check ALLOW real "$WT/CLAUDE.md"                   "a granted worktree's own handbook"
check ALLOW real "$WT/bin/doctor"                  "a granted worktree's own bin/"
check ALLOW new  "$WT/.claude/hooks/brand-new.sh"  'a new file under a granted .claude/'

section 'the grant never widens itself'
R="$WT"; C="$WT"
check DENY real "$WT/.claude/gates.json"           'gates.json under a live grant'
check DENY real "$WT/.claude/hooks/protect-fleet.sh" 'protect-fleet.sh under a live grant'
check DENY real "$WT/.claude/hooks/deny-irreversible.sh" 'deny-irreversible.sh under a live grant'
check DENY real "$MAIN/.claude/gates.json"         'the main checkout gates.json, from inside a live grant'

section 'known open edges — these assert CURRENT behaviour, see ledger/OT-154.md'
R="$WT"; C="$WT"
check ALLOW real "$MAIN/bin/node_modules/evil"     '[OT-154#1] bin/node_modules/<file> in the main checkout, from a worktree root'
check ALLOW real "$FIX/other-checkout/bin/node_modules/evil" '[OT-154#1] bin/node_modules/<file> in another checkout, from a worktree root'
R="$MAIN"; C="$MAIN"
check DENY real "$MAIN/bin/node_modules/evil"      '[OT-154#1] the same file from its own checkout root (relative bin/* saves it)'
check ALLOW -   "$FIX/link-lab/loop-a"             '[OT-154#2] a symlink loop fails OPEN'
check DENY real "$MAIN/src/lib/protect-fleet.sh"   '[OT-154#3] an app file named protect-fleet.sh is denied anywhere'
check DENY real "$MAIN/src/app/docs/CLAUDE.md"     '[OT-154#4] a nested CLAUDE.md is denied, not just the repo-root handbook'

# ------------------------------------------------------------------ tally ----

printf '\n%s\n' "hook: $HOOK"
printf '%d ok / %d fail / %d skip\n' "$ok" "$bad" "$skipped"
if [ "$bad" -gt 0 ]; then
  printf '\n%s\n' "A failing case means the fleet guard has a hole. File it; do not"
  printf '%s\n' "patch the hook to make this script green."
  exit 1
fi
exit 0

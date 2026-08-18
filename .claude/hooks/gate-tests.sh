#!/bin/bash
# SubagentStop:builder* — the automatic quality gate.
#
# Parses the worker output contract from the builder's final message. Exit 2
# prevents the subagent from stopping and feeds stderr back to it, so a builder
# that finishes with red gates is sent back to work rather than reported as done.
#
# Enforces .claude/gates.json: a gate listed as required must be reported `pass`.
# Reporting it as `n/a` or omitting it is a rejection — otherwise "n/a" is a
# loophole that turns the gate into a suggestion.

set -u
GATES_JSON="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/gates.json"

input=$(cat)
msg=$(jq -r '.last_assistant_message // ""' <<<"$input")

# No contract block at all is itself a failure — the orchestrator cannot parse it.
if ! grep -q '^STATUS:' <<<"$msg"; then
  echo "Your final message is missing the worker output contract block. End with the ## Result block from the handbook, and nothing after it." >&2
  exit 2
fi

status=$(grep -m1 '^STATUS:' <<<"$msg" | sed 's/^STATUS:[[:space:]]*//' | tr -d '[:space:]')
gates_line=$(grep -m1 '^GATES:' <<<"$msg" || true)

# Blocked and failed are legitimate outcomes; let the orchestrator act on them.
if [ "$status" = "blocked" ] || [ "$status" = "failed" ]; then
  exit 0
fi

if [ -z "$gates_line" ]; then
  echo "STATUS is '$status' but no GATES line was reported. Run the gates in .claude/GATES.md and report each result." >&2
  exit 2
fi

# Any explicit failure is a rejection regardless of what was required.
if grep -q 'fail' <<<"$gates_line"; then
  echo "You reported STATUS: done with a failing gate — $gates_line. Definition of done requires green gates. Fix the failures, or report STATUS: blocked with the reason." >&2
  exit 2
fi

# Without a declaration there is nothing to enforce; the explicit-fail check above
# still applies.
[ -f "$GATES_JSON" ] || exit 0
required=$(jq -r '.required[]?' "$GATES_JSON" 2>/dev/null || true)
[ -n "$required" ] || exit 0

# Normalize the reported line into "name status" pairs.
reported=$(printf '%s\n' "$gates_line" \
  | sed 's/^GATES:[[:space:]]*//' \
  | tr '·|,' '\n' \
  | awk 'NF >= 2 { print tolower($1), tolower($2) }')

lookup() {
  # Accept singular or plural spelling of the gate name.
  printf '%s\n' "$reported" \
    | awk -v a="$1" -v b="${1}s" -v c="${1%s}" '$1==a || $1==b || $1==c { print $2; exit }'
}

problems=""
for gate in $required; do
  got=$(lookup "$gate")
  case "$got" in
    pass) ;;
    "")   problems="${problems}  - ${gate}: not reported at all\n" ;;
    n/a|na|skip|skipped)
          problems="${problems}  - ${gate}: reported '${got}', but it is required in this repo\n" ;;
    *)    problems="${problems}  - ${gate}: reported '${got}'\n" ;;
  esac
done

if [ -n "$problems" ]; then
  {
    echo "Required gates were not satisfied:"
    printf "%b" "$problems"
    echo "Required in this repo: $(printf '%s ' $required)"
    echo "Run them and report each as pass, or report STATUS: blocked with the reason you cannot. 'n/a' is not accepted for a required gate."
  } >&2
  exit 2
fi

exit 0

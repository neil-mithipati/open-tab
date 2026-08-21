#!/bin/bash
# statusline.sh — Claude Code status line, rendered under the terminal input.
#
# Renders the fleet's ambient state so hooks can stay silent in chat. Format:
#
#   ● Live 2: builder×2,reviewer · ↻ Unfinished (1): OT-136 (2 open) · ● Blocked 1: OT-129A — needs maintenance grant
#
# Green ● for live agents, matching the fleet's running style. Red ● Blocked
# appears only when a ledger task has state: blocked, and carries the ask
# (blocked_reason) in red — the things that need the owner are the only
# things that shout.
#
# Never blocks, never fails loudly: any missing dependency or file renders a
# quieter line rather than an error.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
EVENTS="$ROOT/.claude/state/events.jsonl"
LEDGER="$ROOT/ledger"

G=$'\033[32m'; R=$'\033[31m'; D=$'\033[90m'; B=$'\033[1m'; N=$'\033[0m'

# Consume stdin (session JSON) so the pipe doesn't backpressure; unused here.
cat >/dev/null 2>&1 || true

command -v jq >/dev/null 2>&1 || { printf '%s' "${D}fleet${N}"; exit 0; }
. "$ROOT/.claude/hooks/liveness.sh" 2>/dev/null || { printf '%s' "${D}fleet${N}"; exit 0; }

live_part="${D}● Idle${N}"
if [ -s "$EVENTS" ]; then
  fleet_live_json "$EVENTS"
  n_live=$(printf '%s' "$LIVE_JSON" | jq -r 'map(.running) | add // 0' 2>/dev/null)
  live_names=$(printf '%s' "$LIVE_JSON" | jq -r 'map("\(.type)\(if .running > 1 then "×\(.running)" else "" end)") | join(",")' 2>/dev/null)
  if [ "${n_live:-0}" -gt 0 ] 2>/dev/null; then
    live_part="${G}${B}● Live ${n_live}:${N} ${live_names}"
  fi
fi

# Blocked tasks — the only red on the line, carrying the ask itself.
blocked_part=""
if [ -d "$LEDGER" ]; then
  n_blocked=0; asks=""
  for f in "$LEDGER"/*.md; do
    [ -e "$f" ] || continue
    st=$(sed -n 's/^state:[[:space:]]*//p' "$f" | head -1)
    [ "$st" = "blocked" ] || continue
    id=$(sed -n 's/^id:[[:space:]]*//p' "$f" | head -1)
    br=$(yaml_field blocked_reason "$f")
    [ "${#br}" -gt 48 ] && br="${br:0:46}.."
    n_blocked=$((n_blocked + 1))
    asks="${asks}${asks:+; }${id:-?}${br:+ — $br}"
  done
  if [ "$n_blocked" -gt 0 ]; then
    blocked_part=" · ${R}${B}● Blocked ${n_blocked}:${N} ${R}${asks}${N}"
  fi
fi

# Loop state — the forced-continuation reason lives here now, not in chat.
loop_part=""
if [ -s "$ROOT/.claude/state/loop-note" ]; then
  ln_txt=$(head -1 "$ROOT/.claude/state/loop-note" 2>/dev/null)
  [ "${#ln_txt}" -gt 72 ] && ln_txt="${ln_txt:0:70}.."
  [ -n "$ln_txt" ] && loop_part=" · ${D}↻ ${ln_txt}${N}"
fi

printf '%s%s%s' "$live_part" "$loop_part" "$blocked_part"
exit 0

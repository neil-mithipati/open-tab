#!/bin/bash
# Background poller. Scrapes the local Prometheus endpoint Claude Code exposes and
# flattens per-lane cost into .claude/state/spend.json, which spend-cap.sh reads.
#
# Run one of these per machine, not per lane:
#   ./.claude/hooks/spend-poll.sh &
#
# Lane attribution comes from OTEL_RESOURCE_ATTRIBUTES set by bin/lane, not from
# the agent.name attribute — user-defined subagent names are redacted to "custom"
# on the metrics stream, so every role would otherwise land in one bucket.

set -u
ENDPOINT="${SPEND_ENDPOINT:-http://localhost:9464/metrics}"
STATE="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/state/spend.json"
INTERVAL="${SPEND_POLL_INTERVAL:-15}"

command -v curl >/dev/null || { echo "curl required" >&2; exit 1; }
command -v jq   >/dev/null || { echo "jq required" >&2; exit 1; }

while true; do
  scrape=$(curl -fsS --max-time 5 "$ENDPOINT" 2>/dev/null || true)

  if [ -n "$scrape" ]; then
    # Sum the cost counter per lane label. The metric name carries no unit suffix
    # when prometheus is the only exporter, so match on prefix rather than an
    # exact name.
    printf '%s\n' "$scrape" \
      | grep '^claude_code_cost' \
      | awk '
          {
            lane = "default"
            if (match($0, /lane="[^"]*"/)) {
              lane = substr($0, RSTART+6, RLENGTH-7)
            }
            val = $NF
            total[lane] += val
          }
          END {
            printf "{\"lanes\":{"
            first = 1
            for (l in total) {
              if (!first) printf ","
              printf "\"%s\":%.4f", l, total[l]
              first = 0
            }
            printf "}}\n"
          }
        ' > "$STATE.tmp" 2>/dev/null

    # Atomic swap so a hook never reads a half-written file.
    [ -s "$STATE.tmp" ] && mv "$STATE.tmp" "$STATE"
  fi

  sleep "$INTERVAL"
done

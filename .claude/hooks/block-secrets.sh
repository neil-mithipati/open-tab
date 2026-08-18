#!/bin/bash
# PreToolUse:Read|Edit|Write — blocks secret files.
# The permissions deny list covers the normal path; this exists because that list
# can be bypassed by indexing, so the hook is the reliable block.

input=$(cat)
path=$(jq -r '.tool_input.file_path // ""' <<<"$input")

case "$path" in
  *.env|*.env.*|*.pem|*id_rsa*|*.p12|*credentials.json|*service-account*.json)
    echo "Blocked: $path holds credentials. Secrets are never read, printed, or edited by agents." >&2
    exit 2
    ;;
esac

exit 0

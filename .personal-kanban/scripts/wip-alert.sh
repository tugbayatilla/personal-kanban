#!/usr/bin/env bash
# Fires a macOS notification when a WIP limit is exceeded.
#
# Hook event: wip.violated
# Payload: { column, wip_limit, current_count, card_id }

set -euo pipefail

payload=$(cat)
column=$(echo "$payload" | jq -r '.column')
wip_limit=$(echo "$payload" | jq -r '.wip_limit')
current_count=$(echo "$payload" | jq -r '.current_count')

message="WIP limit exceeded in \"$column\": $current_count cards (limit: $wip_limit)"

if command -v osascript &>/dev/null; then
  osascript -e "display notification \"$message\" with title \"Kanban WIP Alert\""
fi

echo "$message" >&2

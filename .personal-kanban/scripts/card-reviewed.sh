#!/usr/bin/env bash
# Fires a macOS notification when a card moves to Review.
#
# Hook event: card.reviewed
# Payload: { card_id, card_title, from_column, branch }

set -euo pipefail

payload=$(cat)
card_title=$(echo "$payload" | jq -r '.card_title')
branch=$(echo "$payload" | jq -r '.branch // empty')

if [[ -n "$branch" ]]; then
  message="\"$card_title\" is ready for review — branch: $branch"
else
  message="\"$card_title\" is ready for review"
fi

if command -v osascript &>/dev/null; then
  osascript -e "display notification \"$message\" with title \"Kanban: Ready for Review\""
fi

echo "$message"

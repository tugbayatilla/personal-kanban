#!/usr/bin/env bash
# Moves a card to the done column in the manifest (v2 format).
#
# Usage (standalone):
#   card-to-done.sh <card_id>
#
# Usage (via hook — reads JSON payload from stdin):
#   echo '{"card_id":"20260327-ea39"}' | card-to-done.sh

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
BOARD_ROOT="$(dirname "$SCRIPTS_DIR")"
MANIFEST="$BOARD_ROOT/manifest.json"

# Accept card_id from argument or from stdin JSON
if [[ $# -ge 1 ]]; then
  card_id="$1"
else
  payload=$(cat)
  card_id=$(echo "$payload" | jq -r '.card_id')
fi

if [[ -z "$card_id" || "$card_id" == "null" ]]; then
  echo "Error: card_id is required" >&2
  exit 1
fi

# Remove card from every column except done, then append to done if not already there
jq --arg id "$card_id" '
  .columns = (.columns | map(
    if .id == "done" then
      if (.cards | map(select(. == $id)) | length) == 0
      then .cards += [$id]
      else . end
    else
      .cards = (.cards | map(select(. != $id)))
    end
  ))
' "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"

# Update card updated_at
CARD_FILE="$BOARD_ROOT/cards/$card_id.json"
if [[ -f "$CARD_FILE" ]]; then
  now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  jq --arg now "$now" '.metadata.updated_at = $now' "$CARD_FILE" > "$CARD_FILE.tmp" && mv "$CARD_FILE.tmp" "$CARD_FILE"
fi

echo "Card $card_id moved to done."

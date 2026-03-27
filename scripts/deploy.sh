#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# Parse flags
PUBLISH=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

echo "==> Checking dependencies..."
if ! command -v vsce &>/dev/null; then
  echo "vsce not found. Installing @vscode/vsce globally..."
  npm install -g @vscode/vsce
fi

echo "==> Running type check..."
npm run typecheck

echo "==> Running lint..."
npm run lint

echo "==> Building extension..."
npm run build

echo "==> Packaging extension..."
vsce package --out dist/

VSIX_FILE=$(ls -t dist/*.vsix | head -1)
echo "==> Package created: $VSIX_FILE"

if [[ "$PUBLISH" == true ]]; then
  echo "==> Publishing to VS Code Marketplace..."
  vsce publish
  echo "==> Published successfully."
else
  echo "==> Installing extension locally..."
  code --install-extension "$VSIX_FILE" --force
  echo "==> Done. Reload VS Code to activate the updated extension."
fi

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# Load .env
if [[ -f "$ROOT_DIR/.env" ]]; then
  export $(grep -v '^#' "$ROOT_DIR/.env" | xargs)
fi

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

if [[ "$PUBLISH" == true ]]; then
  if [[ -z "${AZURE_PAT:-}" ]]; then
    echo "Error: AZURE_PAT is not set. Add it to .env or export it before running." >&2
    exit 1
  fi

  echo "==> Bumping patch version..."
  npm version patch --no-git-tag-version
  NEW_VERSION=$(node -p "require('./package.json').version")
  echo "==> Version bumped to $NEW_VERSION"

  echo "==> Publishing to VS Code Marketplace..."
  vsce publish --pat "$AZURE_PAT"
  echo "==> Published successfully."

  echo "==> Committing version bump..."
  git add package.json package-lock.json
  git commit -m "chore: release v$NEW_VERSION"
  echo "==> Committed as: chore: release v$NEW_VERSION"
else
  echo "==> Patching package.json for local dev build..."
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.name = pkg.name + '-dev';
    pkg.displayName = pkg.displayName + ' (Dev)';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

  echo "==> Packaging dev extension..."
  { yes 2>/dev/null || true; } | vsce package --out dist/ --allow-missing-repository
  DEV_VSIX=$(ls -t dist/*.vsix | head -1)

  echo "==> Restoring package.json..."
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.name = pkg.name.replace(/-dev$/, '');
    pkg.displayName = pkg.displayName.replace(/ \(Dev\)$/, '');
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

  echo "==> Installing dev extension locally..."
  code --install-extension "$DEV_VSIX" --force
  echo "==> Done. Reload VS Code to activate the updated extension."
fi

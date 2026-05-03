#!/usr/bin/env bash
# install-local.sh — build all packages, install pkan globally, install VSCode extension
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RESET='\033[0m'

step() { echo -e "\n${BLUE}==>${RESET} $1"; }
ok()   { echo -e "${GREEN}✓${RESET} $1"; }

# ── 1. Install dependencies ────────────────────────────────────────────────────
step "Installing dependencies..."
npm install
ok "Dependencies installed"

# ── 2. Build all packages ──────────────────────────────────────────────────────
step "Building @personal-kanban/core..."
npm run build --workspace=packages/kanban-core
ok "kanban-core built"

step "Building @personal-kanban/web..."
npm run build --workspace=packages/kanban-web
ok "kanban-web built"

step "Building @personal-kanban/cli..."
npm run build --workspace=packages/kanban-cli
ok "kanban-cli built"

step "Building vscode-extension..."
npm run build --workspace=packages/vscode-extension
ok "vscode-extension built"

# ── 3. Link CLI globally (pkan + kanban) ──────────────────────────────────────
step "Linking pkan CLI globally..."
cd "$ROOT_DIR/packages/kanban-cli"
npm link
cd "$ROOT_DIR"
ok "pkan is now available globally"

# ── 4. Package and install VSCode extension ───────────────────────────────────
step "Packaging VSCode extension..."

if ! command -v vsce &>/dev/null; then
  echo "  vsce not found — installing @vscode/vsce..."
  npm install -g @vscode/vsce
fi

cd "$ROOT_DIR/packages/vscode-extension"

# Patch name/displayName so dev build doesn't overwrite marketplace install
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.name = pkg.name + '-dev';
  pkg.displayName = (pkg.displayName || pkg.name) + ' (Dev)';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

mkdir -p dist
{ yes 2>/dev/null || true; } | vsce package --out dist/ --allow-missing-repository
VSIX=$(ls -t dist/*.vsix | head -1)

# Restore package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.name = pkg.name.replace(/-dev$/, '');
  pkg.displayName = pkg.displayName.replace(/ \(Dev\)$/, '');
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

cd "$ROOT_DIR"

if command -v code &>/dev/null; then
  step "Installing extension in VS Code..."
  code --install-extension "$VSIX" --force
  ok "Extension installed — reload VS Code to activate"
else
  ok "Extension packaged: $VSIX"
  echo "  (VS Code CLI not found — install manually via Extensions > ... > Install from VSIX)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}All done!${RESET}"
echo ""
echo "  pkan status        — show board"
echo "  pkan serve         — open board in browser"
echo "  pkan --help        — all commands"

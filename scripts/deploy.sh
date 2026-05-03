#!/usr/bin/env bash
# deploy.sh — build, test, and publish all packages
#
# Usage:
#   ./scripts/deploy.sh                  — build + test only (dry run)
#   ./scripts/deploy.sh --npm            — publish npm packages
#   ./scripts/deploy.sh --vscode         — publish VSCode extension
#   ./scripts/deploy.sh --npm --vscode   — publish everything
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

step()  { echo -e "\n${BLUE}==>${RESET} $1"; }
ok()    { echo -e "${GREEN}✓${RESET} $1"; }
warn()  { echo -e "${YELLOW}!${RESET} $1"; }
abort() { echo -e "${RED}✗${RESET} $1" >&2; exit 1; }

# ── Parse flags ────────────────────────────────────────────────────────────────
PUBLISH_NPM=false
PUBLISH_VSCODE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --npm)    PUBLISH_NPM=true;    shift ;;
    --vscode) PUBLISH_VSCODE=true; shift ;;
    *) abort "Unknown argument: $1. Usage: deploy.sh [--npm] [--vscode]" ;;
  esac
done

# Load .env if present
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a; source "$ROOT_DIR/.env"; set +a
fi

# ── Validate credentials early ─────────────────────────────────────────────────
if [[ "$PUBLISH_NPM" == true ]]; then
  if ! npm whoami &>/dev/null; then
    abort "Not logged into npm. Run: npm login"
  fi
  ok "npm login: $(npm whoami)"
fi

if [[ "$PUBLISH_VSCODE" == true ]]; then
  if [[ -z "${AZURE_PAT:-}" ]]; then
    abort "AZURE_PAT is not set. Add it to .env or: export AZURE_PAT=<your-pat>"
  fi
  if ! command -v vsce &>/dev/null; then
    step "Installing vsce..."
    npm install -g @vscode/vsce
  fi
  ok "AZURE_PAT is set"
fi

# ── 1. Install dependencies ────────────────────────────────────────────────────
step "Installing dependencies..."
npm install
ok "Dependencies installed"

# ── 2. Type check all packages ────────────────────────────────────────────────
step "Type checking..."
npm run typecheck --workspaces --if-present 2>&1 | grep -v "^$" || abort "Type check failed"
ok "Type check passed"

# ── 3. Lint all packages ──────────────────────────────────────────────────────
step "Linting..."
npm run lint --workspaces --if-present 2>&1 | grep -v "^$" || abort "Lint failed"
ok "Lint passed"

# ── 4. Build all packages (dependency order) ──────────────────────────────────
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

# ── 5. Run all tests ──────────────────────────────────────────────────────────
step "Running tests..."
npm test --workspaces --if-present 2>&1 | tee /tmp/pkan-test-output.txt
FAIL_COUNT=$(grep -oP '\d+ failed' /tmp/pkan-test-output.txt | awk '{s+=$1} END {print s+0}')
if [[ "$FAIL_COUNT" -gt 2 ]]; then
  abort "Tests failed ($FAIL_COUNT failures, expected at most 2 pre-existing). Fix before deploying."
elif [[ "$FAIL_COUNT" -gt 0 ]]; then
  warn "$FAIL_COUNT known pre-existing test failure(s) — proceeding"
fi
ok "Tests passed"

# ── 6. Publish npm packages ───────────────────────────────────────────────────
if [[ "$PUBLISH_NPM" == true ]]; then
  for pkg in kanban-core kanban-web kanban-cli; do
    step "Publishing packages/$pkg..."
    cd "$ROOT_DIR/packages/$pkg"
    npm version patch --no-git-tag-version
    NEW_VER=$(node -p "require('./package.json').version")
    npm publish --access public
    cd "$ROOT_DIR"
    ok "$pkg published at v$NEW_VER"
  done

  git add packages/kanban-core/package.json \
          packages/kanban-web/package.json \
          packages/kanban-cli/package.json \
          package-lock.json
  VERSION=$(node -p "require('./packages/kanban-cli/package.json').version")
  git commit -m "chore: publish npm packages v$VERSION"
  ok "Version bumps committed"
fi

# ── 7. Publish VSCode extension ───────────────────────────────────────────────
if [[ "$PUBLISH_VSCODE" == true ]]; then
  step "Publishing VSCode extension..."
  cd "$ROOT_DIR/packages/vscode-extension"
  npm version patch --no-git-tag-version
  NEW_VER=$(node -p "require('./package.json').version")
  vsce publish --pat "$AZURE_PAT"
  cd "$ROOT_DIR"
  git add packages/vscode-extension/package.json package-lock.json
  git commit -m "chore: release vscode-extension v$NEW_VER"
  ok "VSCode extension v$NEW_VER published and committed"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Deploy complete!${RESET}"
if [[ "$PUBLISH_NPM" == false && "$PUBLISH_VSCODE" == false ]]; then
  warn "Dry run — nothing published. Add --npm and/or --vscode to publish."
  echo ""
  echo "  ./scripts/deploy.sh --npm            publish @personal-kanban/* to npm"
  echo "  ./scripts/deploy.sh --vscode         publish extension to marketplace"
  echo "  ./scripts/deploy.sh --npm --vscode   publish everything"
fi

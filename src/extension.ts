import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BoardPanel } from './BoardPanel';
import { MetricsPanel } from './MetricsPanel';
import { getBoardRoot, boardExists, readManifest, writeManifest, withLock } from './io';
import { loadAllCardFiles, computeMetrics } from './metrics';
import { initLogger } from './hooks';
import { Manifest } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Personal Kanban');
  context.subscriptions.push(channel);
  initLogger(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand('personal-kanban.initBoard', () => initBoard(context)),
    vscode.commands.registerCommand('personal-kanban.openBoard', () => {
      const root = getWorkspaceRoot();
      if (root) BoardPanel.createOrShow(context, root, channel);
    }),
    vscode.commands.registerCommand('personal-kanban.openMetrics', () => {
      const root = getWorkspaceRoot();
      if (root) MetricsPanel.createOrShow(context, root);
    }),
    vscode.commands.registerCommand('personal-kanban.exportMetrics', () => exportMetrics())
  );
}

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage('Kanban: No workspace folder open.');
    return undefined;
  }
  return folders[0].uri.fsPath;
}

function isUnset(val: unknown): boolean {
  return val === undefined || (typeof val === 'object' && val !== null && Object.keys(val as object).length === 0);
}

function initBoard(context: vscode.ExtensionContext): void {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const boardRoot = getBoardRoot(workspaceRoot);

  fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
  fs.mkdirSync(path.join(boardRoot, 'archive'), { recursive: true });
  fs.mkdirSync(path.join(boardRoot, 'scripts'), { recursive: true });

  if (!boardExists(boardRoot)) {
    // v1 manifest: columns include index and policies; scripts and hooks are stored
    // in manifest.json (not in VSCode settings) so the board is self-contained.
    const manifest: Manifest = {
      version: 1,
      name: path.basename(workspaceRoot),
      columns: [
        { id: 'backlog',     label: 'Backlog',      index: 0, wip_limit: null, policies: [] },
        { id: 'refined',     label: 'Refined',       index: 1, wip_limit: null, policies: [] },
        { id: 'in-progress', label: 'In Progress',   index: 2, wip_limit: null, policies: [] },
        { id: 'review',      label: 'Review',        index: 3, wip_limit: null, policies: ['entry:review'] },
        { id: 'done',        label: 'Done',          index: 4, wip_limit: null, policies: ['entry:done'] },
      ],
      policies: {
        'wip-limit': {
          description: 'The WIP limit of the destination column must not be exceeded.',
          message: 'Moving this card would exceed the WIP limit. Stop starting, start finishing.',
          script: 'scripts/policy-wip-limit.js',
        },
        'no-pullback': {
          description: 'Cards must not move backward in the value stream. If rework is needed, add a note to the card explaining why.',
          message: 'Moving a card backward is a policy violation. Add a note to the card explaining why instead.',
          script: 'scripts/policy-no-pullback.js',
        },
        'entry:review': {
          description: 'All acceptance criteria must be met from the worker\'s perspective before a card may enter Review.',
          message: 'Card is not ready for Review — all acceptance criteria must be met first.',
          script: 'scripts/policy-entry-review.js',
        },
        'entry:done': {
          description: 'A card may only enter Done after a second person (or the same person after a pause) has verified the outcome.',
          message: 'Card has not been verified — Done requires independent acceptance.',
          script: 'scripts/policy-entry-done.js',
        },
      },
      board_policies: ['wip-limit', 'no-pullback'],
      policy_bypass_tags: [],
      column_stamps: {
        active_at: 'in-progress',
        done_at: 'done',
      },
      tags: {},
      scripts: {
        'policy-overridden': { file: 'scripts/policy-overridden.js' },
        'card-created':      { file: 'scripts/card-created.js' },
        'card-edited':       { file: 'scripts/card-edited.js' },
        'card-deleted':      { file: 'scripts/card-deleted.js' },
        'card-moved':        { file: 'scripts/card-moved.js' },
        'cards-archived':    { file: 'scripts/cards-archived.js' },
      },
      hooks: {
        'policy.overridden': ['policy-overridden'],
        'card.created':      ['card-created'],
        'card.edited':       ['card-edited'],
        'card.deleted':      ['card-deleted'],
        'card.moved':        ['card-moved'],
        'cards.archived':    ['cards-archived'],
      },
      tagColorTarget: 'tag',
    };
    withLock(boardRoot, () => writeManifest(boardRoot, manifest));
  }

  const writeIfMissing = (filePath: string, content: string) => {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content);
  };
  writeIfMissing(path.join(boardRoot, 'scripts', 'lib.js'),                 SCRIPT_LIB);
  writeIfMissing(path.join(boardRoot, 'scripts', 'lib.d.ts'),               SCRIPT_LIB_DTS);
  writeIfMissing(path.join(boardRoot, 'scripts', 'jsconfig.json'),          SCRIPT_JSCONFIG);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-created.js'),        SCRIPT_CARD_CREATED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-edited.js'),         SCRIPT_CARD_EDITED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-deleted.js'),        SCRIPT_CARD_DELETED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-moved.js'),          SCRIPT_CARD_MOVED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'cards-archived.js'),      SCRIPT_CARDS_ARCHIVED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'policy-overridden.js'),   SCRIPT_POLICY_OVERRIDDEN);
  writeIfMissing(path.join(boardRoot, 'scripts', 'policy-wip-limit.js'),    SCRIPT_POLICY_WIP_LIMIT);
  writeIfMissing(path.join(boardRoot, 'scripts', 'policy-no-pullback.js'),  SCRIPT_POLICY_NO_PULLBACK);
  writeIfMissing(path.join(boardRoot, 'scripts', 'policy-entry-review.js'), SCRIPT_POLICY_ENTRY_REVIEW);
  writeIfMissing(path.join(boardRoot, 'scripts', 'policy-entry-done.js'),   SCRIPT_POLICY_ENTRY_DONE);

  const guidelinesTemplate = path.join(context.extensionPath, 'resources', 'GUIDELINES.md');
  fs.writeFileSync(path.join(boardRoot, 'GUIDELINES.md'), fs.readFileSync(guidelinesTemplate, 'utf8'));

  // Tags and display settings remain in VSCode workspace settings.
  const config = vscode.workspace.getConfiguration('personal-kanban');
  const tagsInfo = config.inspect('tags');
  if (isUnset(tagsInfo?.workspaceValue) && isUnset(tagsInfo?.workspaceFolderValue)) {
    void config.update('tags', {
      'bug':     { color: '#e11d48', weight: 10 },
      'feature': { color: '#2563eb', weight:  5 },
      'chore':   { color: '#6b7280', weight:  1 },
      'urgent':  { color: '#f97316', weight: 20 },
    }, vscode.ConfigurationTarget.Workspace);
  }
  const tagColorTargetInfo = config.inspect('tagColorTarget');
  if (isUnset(tagColorTargetInfo?.workspaceValue) && isUnset(tagColorTargetInfo?.workspaceFolderValue)) {
    void config.update('tagColorTarget', 'tag', vscode.ConfigurationTarget.Workspace);
  }

  vscode.window.showInformationMessage('Kanban: Board initialized.');
}

export function deactivate(): void {}

// ── Export metrics ────────────────────────────────────────────────────────────

function exportMetrics(): void {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const boardRoot = getBoardRoot(workspaceRoot);

  let manifest: Manifest;
  try {
    manifest = readManifest(boardRoot);
  } catch (err) {
    vscode.window.showErrorMessage(`Kanban: could not read board — ${String(err)}`);
    return;
  }

  const cards = loadAllCardFiles(boardRoot);
  const columns = manifest.columns.map((c) => ({ id: c.id, label: c.label }));
  const data = computeMetrics(cards, columns);

  const outPath = path.join(boardRoot, 'metrics.json');
  try {
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  } catch (err) {
    vscode.window.showErrorMessage(`Kanban: could not write metrics.json — ${String(err)}`);
    return;
  }

  vscode.window.showTextDocument(vscode.Uri.file(outPath));
}

// ── Script templates ─────────────────────────────────────────────────────────
//
// lib.js exposes helpers for all other scripts:
//   readPayload(scriptName, callback) — reads JSON payload from stdin
//   notify(title, message)            — cross-platform system notification
//   readCard(cardPath)                — parse a card's YAML frontmatter + body
//   writeCard(cardPath, metadata, content) — serialize card back to disk
//   updateCardMetadata(cardPath, updates)  — patch specific metadata fields

const SCRIPT_LIB = `'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

function readPayload(scriptName, callback) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      process.stderr.write(\`\${scriptName}: invalid JSON payload\\n\`);
      process.exit(1);
    }
    callback(payload);
  });
}

function notify(title, message) {
  try {
    if (process.platform === 'darwin') {
      execSync(\`osascript -e 'display notification \${JSON.stringify(message)} with title \${JSON.stringify(title)}'\`);
    } else if (process.platform === 'win32') {
      const ps = \`[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show(\${JSON.stringify(message)}, \${JSON.stringify(title)})\`;
      execSync(\`powershell -Command "\${ps}"\`, { stdio: 'ignore' });
    } else {
      execSync(\`notify-send \${JSON.stringify(title)} \${JSON.stringify(message)}\`);
    }
  } catch {
    // Notification failure is non-fatal
  }
}

/**
 * Parse a card file into { metadata, content }.
 * metadata: object with all YAML frontmatter key/value pairs (strings).
 * content:  markdown body after the closing ---.
 */
function readCard(cardPath) {
  const raw = fs.readFileSync(cardPath, 'utf-8');
  const match = raw.match(/^---\\n([\\s\\S]*?)\\n---\\n?([\\s\\S]*)$/);
  if (!match) return { metadata: {}, content: raw };
  const metadata = {};
  for (const line of match[1].split('\\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    metadata[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { metadata, content: match[2].replace(/^\\n/, '') };
}

/**
 * Write a card file from metadata object and markdown content.
 * Field order: id, created_at, column, order, then remaining fields alphabetically.
 */
function writeCard(cardPath, metadata, content) {
  const priority = ['id', 'created_at', 'column', 'order', 'active_at', 'done_at', 'branch', 'archived_at', 'created_by', 'active_by', 'done_by', 'archived_by'];
  const lines = ['---'];
  for (const key of priority) {
    if (metadata[key] !== undefined && metadata[key] !== '') {
      lines.push(\`\${key}: \${metadata[key]}\`);
    }
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!priority.includes(key) && value !== undefined && value !== '') {
      lines.push(\`\${key}: \${value}\`);
    }
  }
  lines.push('---', '', content);
  fs.writeFileSync(cardPath, lines.join('\\n'));
}

/**
 * Patch specific metadata fields on a card file without touching others.
 * Example: updateCardMetadata('cards/abc.md', { column: 'done' })
 */
function updateCardMetadata(cardPath, updates) {
  const { metadata, content } = readCard(cardPath);
  Object.assign(metadata, updates);
  writeCard(cardPath, metadata, content);
}

/**
 * Return the current git user as "Name <email>", "Name", or "<email>".
 * Returns null if git is not available or neither name nor email is configured.
 */
function getGitUser() {
  try {
    const name  = execSync('git config user.name',  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const email = execSync('git config user.email', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (name && email) return \`\${name} <\${email}>\`;
    if (name)          return name;
    if (email)         return \`<\${email}>\`;
  } catch {
    // git not available or user not configured
  }
  return null;
}

module.exports = { readPayload, notify, readCard, writeCard, updateCardMetadata, getGitUser };
`;

const SCRIPT_LIB_DTS = `// Type declarations for scripts/lib.js
// VS Code uses this file to provide intellisense in all scripts/*.js files.

// ── Card types ────────────────────────────────────────────────────────────────

export interface CardMetadata {
  id?: string;
  created_at: string;
  /** Column id this card belongs to */
  column?: string;
  /** Sort order within the column (fractional indexing; lower = higher position) */
  order?: string;
  /** Stamped the first time the card enters the column_stamps.active_at column */
  active_at?: string;
  /** Stamped every time the card enters the column_stamps.done_at column */
  done_at?: string;
  branch?: string;
  archived_at?: string;
  /** Git user who created the card, e.g. "Name <email>" */
  created_by?: string;
  /** Git user who moved the card to the active_at column */
  active_by?: string;
  /** Git user who moved the card to the done_at column */
  done_by?: string;
  /** Git user who archived the card */
  archived_by?: string;
  [key: string]: string | undefined;
}

export interface Card {
  metadata: CardMetadata;
  /** Markdown body after the frontmatter block */
  content: string;
}

// ── Policy script payloads ────────────────────────────────────────────────────

export interface PolicyPayload {
  /** Always "card.moving" */
  event: 'card.moving';
  /** ISO 8601 datetime of the move attempt */
  timestamp: string;
  /** Note: policy payloads do NOT include a notifications field */
  card_id: string;
  /** First # heading from the card content */
  card_title: string;
  /** Column id the card is leaving */
  from_column: string;
  /** Column id the card is entering */
  to_column: string;
  /** Current number of cards in the destination column */
  to_column_card_count: number;
  /** WIP limit of the destination column, or null if unset */
  to_column_wip_limit: number | null;
  /** Ordered array of all column ids, left → right */
  columns: string[];
  /** Key of the policy being checked, e.g. "entry:done" */
  policy: string;
}

// ── Hook payloads ─────────────────────────────────────────────────────────────

interface BaseHookPayload {
  /** The event name, e.g. "card.moved" */
  event: string;
  /** ISO 8601 datetime the event fired */
  timestamp: string;
  /** Whether desktop notifications are enabled in VS Code settings */
  notifications: boolean;
}

export interface CardCreatedPayload extends BaseHookPayload {
  event: 'card.created';
  card_id: string;
  /** Empty string — card has no content yet */
  card_title: string;
  column: string;
  /** Relative path, e.g. "cards/20260101-a1b2.md" */
  card_path: string;
}

export interface CardEditedPayload extends BaseHookPayload {
  event: 'card.edited';
  card_id: string;
  card_title: string;
  /** Relative path to the card file */
  card_path: string;
}

export interface CardDeletedPayload extends BaseHookPayload {
  event: 'card.deleted';
  card_id: string;
  card_title: string;
  /** Column the card was in when deleted */
  last_column: string;
}

export interface CardMovedPayload extends BaseHookPayload {
  event: 'card.moved';
  card_id: string;
  card_title: string;
  from_column: string;
  to_column: string;
  /** Value of the branch metadata field, if set */
  branch?: string;
  /** Relative path to the card file */
  card_path: string;
}

export interface PolicyOverriddenPayload extends BaseHookPayload {
  event: 'policy.overridden';
  card_id: string;
  card_title: string;
  from_column: string;
  to_column: string;
  /** Policy key that was violated, e.g. "entry:done" */
  policy: string;
  /** The human-readable violation message shown to the user */
  message: string;
}

export interface CardsArchivedPayload extends BaseHookPayload {
  event: 'cards.archived';
  /** Column that was swept — the id configured in column_stamps.done_at */
  column: string;
}

// ── readPayload overloads ─────────────────────────────────────────────────────

export function readPayload(name: 'policy-entry-done',   cb: (payload: PolicyPayload)           => void): void;
export function readPayload(name: 'policy-entry-review', cb: (payload: PolicyPayload)           => void): void;
export function readPayload(name: 'policy-wip-limit',    cb: (payload: PolicyPayload)           => void): void;
export function readPayload(name: 'policy-no-pullback',  cb: (payload: PolicyPayload)           => void): void;
export function readPayload(name: 'card-created',        cb: (payload: CardCreatedPayload)      => void): void;
export function readPayload(name: 'card-edited',         cb: (payload: CardEditedPayload)       => void): void;
export function readPayload(name: 'card-deleted',        cb: (payload: CardDeletedPayload)      => void): void;
export function readPayload(name: 'card-moved',          cb: (payload: CardMovedPayload)        => void): void;
export function readPayload(name: 'policy-overridden',   cb: (payload: PolicyOverriddenPayload) => void): void;
export function readPayload(name: 'cards-archived',      cb: (payload: CardsArchivedPayload)    => void): void;
export function readPayload(name: string,                cb: (payload: Record<string, unknown>) => void): void;

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Read and parse a card file into { metadata, content }. */
export function readCard(cardPath: string): Card;

/** Write a card file from metadata and markdown content. */
export function writeCard(cardPath: string, metadata: CardMetadata, content: string): void;

/** Patch specific metadata fields on a card file without touching others. */
export function updateCardMetadata(cardPath: string, updates: Partial<CardMetadata>): void;

/** Show a desktop notification (macOS / Windows / Linux). Non-fatal if unavailable. */
export function notify(title: string, message: string): void;

/**
 * Return the current git user as "Name <email>", "Name", or "<email>".
 * Returns null if git is not available or user.name / user.email are not configured.
 */
export function getGitUser(): string | null;
`;

const SCRIPT_JSCONFIG = `{
  "compilerOptions": {
    "checkJs": false,
    "strictNullChecks": true
  }
}
`;

// card-moved.js: primary handler for card column writes.
// The extension also writes `column` and `order` synchronously as a reliable fallback,
// so this script's metadata update is idempotent. Use this script for notifications
// and any additional logic (git operations, logging, webhooks, etc.).
const SCRIPT_CARD_MOVED = `#!/usr/bin/env node
// Fires whenever a card moves between columns.
// Handles notifications for all column transitions including Review and Done.
//
// Hook event: card.moved
// Payload: { event, timestamp, notifications, card_id, card_title, from_column, to_column, branch, card_path }

'use strict';

const fs = require('fs');
const { readPayload, notify, updateCardMetadata, getGitUser } = require('./lib');

readPayload('card-moved', ({ card_title, from_column, to_column, branch, card_path, notifications }) => {
  // Stamp active_by / done_by from git user based on column_stamps config.
  // cwd is set to boardRoot by the extension spawner — relative paths are safe.
  try {
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    const stamps = manifest.column_stamps ?? {};
    const user = getGitUser();
    if (user) {
      if (to_column === stamps.active_at) {
        updateCardMetadata(card_path, { active_by: user });
      } else if (to_column === stamps.done_at) {
        updateCardMetadata(card_path, { done_by: user });
      }
    }
  } catch {
    // Non-fatal: manifest unreadable or git unavailable.
  }

  let title = 'Kanban: Card Moved';
  let message;

  // These column ids match the default manifest. If you rename your columns,
  // update the checks below to match your column_stamps / column ids.
  if (to_column === 'review') {
    title = 'Kanban: Ready for Review';
    message = branch
      ? \`"\${card_title}" is ready for review — branch: \${branch}\`
      : \`"\${card_title}" is ready for review\`;
  } else if (to_column === 'done') {
    title = 'Kanban: Card Done';
    message = branch
      ? \`"\${card_title}" moved to Done — branch: \${branch}\`
      : \`"\${card_title}" moved to Done\`;
  } else {
    message = \`"\${card_title}" moved from \${from_column} to \${to_column}\`;
  }

  if (notifications !== false) notify(title, message);
  process.stdout.write(message + '\\n');
});
`;

const SCRIPT_CARD_CREATED = `#!/usr/bin/env node
// Fires when a new card is created.
//
// Hook event: card.created
// Payload: { event, timestamp, notifications, card_id, card_title, column, card_path }

'use strict';

const { readPayload, updateCardMetadata, getGitUser } = require('./lib');

readPayload('card-created', ({ card_id, card_title, column, card_path }) => {
  const user = getGitUser();
  if (user) {
    // cwd is set to boardRoot by the extension spawner — relative paths are safe.
    updateCardMetadata(card_path, { created_by: user });
  }
  process.stdout.write(\`card created: "\${card_title}" (\${card_id}) in \${column}\\n\`);
});
`;

const SCRIPT_CARD_EDITED = `#!/usr/bin/env node
// Fires when a card's content changes.
//
// Hook event: card.edited
// Payload: { event, timestamp, card_id, card_title, card_path }
//
// card_path is relative to the board root (e.g. "cards/20260401-8d96.md").
// Use updateCardMetadata(card_path, { key: value }) from lib.js to patch metadata.

'use strict';

const { readPayload } = require('./lib');

readPayload('card-edited', ({ card_id, card_title, card_path }) => {
  process.stdout.write(\`card edited: "\${card_title}" (\${card_id})\\n\`);
});
`;

const SCRIPT_CARD_DELETED = `#!/usr/bin/env node
// Fires when a card is deleted.
//
// Hook event: card.deleted
// Payload: { event, timestamp, card_id, card_title, last_column }
//
// Note: the card file has already been removed by the time this fires.

'use strict';

const { readPayload } = require('./lib');

readPayload('card-deleted', ({ card_id, card_title, last_column }) => {
  process.stdout.write(\`card deleted: "\${card_title}" (\${card_id}) from \${last_column}\\n\`);
});
`;

const SCRIPT_CARDS_ARCHIVED = `#!/usr/bin/env node
// Fires after all Done cards are archived.
//
// Hook event: cards.archived
// Payload: { event, timestamp, column }
//
// Archived card files live at: archive/<card_id>.md

'use strict';

const { readPayload } = require('./lib');

readPayload('cards-archived', ({ column }) => {
  process.stdout.write(\`cards archived from: \${column}\\n\`);
});
`;

const SCRIPT_POLICY_OVERRIDDEN = `#!/usr/bin/env node
// Fires after a user approves a policy violation and the card move proceeds.
//
// Hook event: policy.overridden
// Payload: { event, timestamp, notifications, card_id, card_title, from_column, to_column, policy, message }

'use strict';

const { readPayload, notify } = require('./lib');

readPayload('policy-overridden', ({ card_title, from_column, to_column, policy, notifications }) => {
  const message = \`[\${policy}] "\${card_title}" moved \${from_column} → \${to_column} (policy overridden)\`;

  process.stdout.write(message + '\\n');
  if (notifications !== false) notify('Kanban: Policy Overridden', message);
});
`;

const SCRIPT_POLICY_WIP_LIMIT = `#!/usr/bin/env node
// Policy script: wip-limit
// Exits 1 (violated) if moving this card would exceed the destination column's WIP limit.
// Exits 0 (ok) if no WIP limit is set or the limit is not exceeded.
//
// Payload: { to_column, to_column_card_count, to_column_wip_limit, ... }

'use strict';

const { readPayload } = require('./lib');

readPayload('policy-wip-limit', ({ to_column_wip_limit, to_column_card_count }) => {
  if (to_column_wip_limit !== null && to_column_card_count >= to_column_wip_limit) {
    process.exit(1);
  }
  process.exit(0);
});
`;

const SCRIPT_POLICY_NO_PULLBACK = `#!/usr/bin/env node
// Policy script: no-pullback
// Exits 1 (violated) if the card is moving backward in the column order.
// Exits 0 (ok) otherwise.
//
// Payload: { from_column, to_column, columns, policy, ... }
// columns: ordered array of column ids, e.g. ["backlog","refined","in-progress","review","done"]

'use strict';

const { readPayload } = require('./lib');

readPayload('policy-no-pullback', ({ from_column, to_column, columns }) => {
  const fromIdx = columns.indexOf(from_column);
  const toIdx   = columns.indexOf(to_column);
  if (fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx) {
    process.exit(1);
  }
  process.exit(0);
});
`;

const SCRIPT_POLICY_ENTRY_REVIEW = `#!/usr/bin/env node
// Policy script: entry:review
// Exits 1 (violated) if the card has any unchecked checklist items.
// Exits 0 (ok) if all items are checked or there are no checklist items.
//
// Payload: { card_id, card_title, from_column, to_column, columns, policy, ... }

'use strict';

const path = require('path');
const { readPayload, readCard } = require('./lib');

readPayload('policy-entry-review', ({ card_id }) => {
  // cwd is set to boardRoot by the extension spawner — relative paths are safe.
  const cardPath = path.join('cards', \`\${card_id}.md\`);
  const { content } = readCard(cardPath);
  const hasUnchecked = /^- \\[ \\]/m.test(content);
  process.exit(hasUnchecked ? 1 : 0);
});
`;

const SCRIPT_POLICY_ENTRY_DONE = `#!/usr/bin/env node
// Policy script: entry:done
// Exits 1 (violated) if the card has any unchecked checklist items.
// Exits 0 (ok) if all items are checked or there are no checklist items.
//
// Payload: { card_id, card_title, from_column, to_column, columns, policy, ... }

'use strict';

const path = require('path');
const { readPayload, readCard } = require('./lib');

readPayload('policy-entry-done', ({ card_id }) => {
  // cwd is set to boardRoot by the extension spawner — relative paths are safe.
  const cardPath = path.join('cards', \`\${card_id}.md\`);
  const { content } = readCard(cardPath);
  const hasUnchecked = /^- \\[ \\]/m.test(content);
  process.exit(hasUnchecked ? 1 : 0);
});
`;

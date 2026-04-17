import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BoardPanel } from './BoardPanel';
import { getBoardRoot, boardExists, writeManifest, withLock } from './io';
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
    })
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
        { id: 'backlog',     label: 'Backlog',      index: 0, wip_limit: null, policies: {} },
        { id: 'refined',     label: 'Refined',       index: 1, wip_limit: null, policies: {} },
        { id: 'in-progress', label: 'In Progress',   index: 2, wip_limit: null, policies: {} },
        { id: 'review',      label: 'Review',        index: 3, wip_limit: null, policies: {} },
        { id: 'done',        label: 'Done',          index: 4, wip_limit: null, policies: {} },
      ],
      tags: {},
      scripts: {
        'card-reviewed':  { file: 'scripts/card-reviewed.js' },
        'wip-alert':      { file: 'scripts/wip-alert.js' },
        'card-created':   { file: 'scripts/card-created.js' },
        'card-edited':    { file: 'scripts/card-edited.js' },
        'card-deleted':   { file: 'scripts/card-deleted.js' },
        'card-moved':     { file: 'scripts/card-moved.js' },
        'cards-archived': { file: 'scripts/cards-archived.js' },
      },
      hooks: {
        'card.reviewed':  ['card-reviewed'],
        'wip.violated':   ['wip-alert'],
        'card.created':   ['card-created'],
        'card.edited':    ['card-edited'],
        'card.deleted':   ['card-deleted'],
        'card.moved':     ['card-moved'],
        'cards.archived': ['cards-archived'],
      },
      tagColorTarget: 'tag',
    };
    withLock(boardRoot, () => writeManifest(boardRoot, manifest));
  }

  const writeIfMissing = (filePath: string, content: string) => {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content);
  };
  writeIfMissing(path.join(boardRoot, 'scripts', 'lib.js'),            SCRIPT_LIB);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-reviewed.js'),  SCRIPT_CARD_REVIEWED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'wip-alert.js'),      SCRIPT_WIP_ALERT);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-created.js'),   SCRIPT_CARD_CREATED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-edited.js'),    SCRIPT_CARD_EDITED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-deleted.js'),   SCRIPT_CARD_DELETED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-moved.js'),     SCRIPT_CARD_MOVED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'cards-archived.js'), SCRIPT_CARDS_ARCHIVED);

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
  const priority = ['id', 'created_at', 'column', 'order', 'active_at', 'done_at', 'branch', 'archived_at'];
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

module.exports = { readPayload, notify, readCard, writeCard, updateCardMetadata };
`;

// card-moved.js: primary handler for card column writes.
// The extension also writes `column` and `order` synchronously as a reliable fallback,
// so this script's metadata update is idempotent. Use this script for notifications
// and any additional logic (git operations, logging, webhooks, etc.).
const SCRIPT_CARD_MOVED = `#!/usr/bin/env node
// Fires whenever a card moves between columns.
// Writes the updated \`column\` field to the card file and fires a notification.
//
// Hook event: card.moved
// Payload: { event, timestamp, card_id, card_title, from_column, to_column, branch, card_path }
//
// Note: the extension already wrote \`column\` and \`order\` to the card synchronously.
// Calling updateCardMetadata here is safe (idempotent) and demonstrates how scripts
// can modify card metadata for custom workflows.

'use strict';

const path = require('path');
const { readPayload, notify, updateCardMetadata } = require('./lib');

readPayload('card-moved', ({ card_id, card_title, from_column, to_column, branch, card_path, notifications }) => {
  // Optionally re-write column (already done by the extension; shown here as an example).
  // if (card_path) {
  //   updateCardMetadata(card_path, { column: to_column });
  // }

  const message = (to_column === 'done' && branch)
    ? \`"\${card_title}" moved to Done — branch: \${branch}\`
    : \`"\${card_title}" moved to \${to_column}\`;

  if (notifications !== false) notify('Kanban: Card Moved', message);
  process.stdout.write(message + '\\n');
});
`;

const SCRIPT_CARD_REVIEWED = `#!/usr/bin/env node
// Fires a system notification when a card moves to Review.
//
// Hook event: card.reviewed
// Payload: { event, timestamp, card_id, card_title, from_column, branch }

'use strict';

const { readPayload, notify } = require('./lib');

readPayload('card-reviewed', ({ card_title, branch, notifications }) => {
  const message = branch
    ? \`"\${card_title}" is ready for review — branch: \${branch}\`
    : \`"\${card_title}" is ready for review\`;

  if (notifications !== false) notify('Kanban: Ready for Review', message);
  process.stdout.write(message + '\\n');
});
`;

const SCRIPT_WIP_ALERT = `#!/usr/bin/env node
// Fires a system notification when a WIP limit is exceeded.
//
// Hook event: wip.violated
// Payload: { event, timestamp, column, wip_limit, current_count, card_id }

'use strict';

const { readPayload, notify } = require('./lib');

readPayload('wip-alert', ({ column, wip_limit, current_count, notifications }) => {
  const message = \`WIP limit exceeded in "\${column}": \${current_count} cards (limit: \${wip_limit})\`;

  if (notifications !== false) notify('Kanban WIP Alert', message);
  process.stdout.write(message + '\\n');
});
`;

const SCRIPT_CARD_CREATED = `#!/usr/bin/env node
// Fires when a new card is created.
//
// Hook event: card.created
// Payload: { event, timestamp, card_id, card_title, column, card_path }

'use strict';

const { readPayload } = require('./lib');

readPayload('card-created', ({ card_id, card_title, column }) => {
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

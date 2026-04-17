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
// Handles notifications for all column transitions including Review and Done.
//
// Hook event: card.moved
// Payload: { event, timestamp, card_id, card_title, from_column, to_column, branch, card_path }

'use strict';

const { readPayload, notify } = require('./lib');

readPayload('card-moved', ({ card_title, from_column, to_column, branch, notifications }) => {
  let title = 'Kanban: Card Moved';
  let message;

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

const SCRIPT_POLICY_OVERRIDDEN = `#!/usr/bin/env node
// Fires after a user approves a policy violation and the card move proceeds.
//
// Hook event: policy.overridden
// Payload: { event, timestamp, card_id, card_title, from_column, to_column, policy, message }

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
// Exits 1 (violated) to require explicit approval before a card enters Review.
// Customize this script to add your own readiness checks — e.g. check for a
// #ready tag or verify all checklist items are ticked in the card content.
//
// Payload: { card_id, card_title, from_column, to_column, columns, policy, ... }

'use strict';

const { readPayload } = require('./lib');

readPayload('policy-entry-review', () => {
  // Always require confirmation before entering Review.
  // Replace with conditional logic to allow certain moves silently (exit 0).
  process.exit(1);
});
`;

const SCRIPT_POLICY_ENTRY_DONE = `#!/usr/bin/env node
// Policy script: entry:done
// Exits 1 (violated) to require explicit approval before a card enters Done.
// Customize this script to add your own acceptance checks.
//
// Payload: { card_id, card_title, from_column, to_column, columns, policy, ... }

'use strict';

const { readPayload } = require('./lib');

readPayload('policy-entry-done', () => {
  // Always require confirmation before entering Done.
  // Replace with conditional logic to allow certain moves silently (exit 0).
  process.exit(1);
});
`;

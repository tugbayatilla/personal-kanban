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
    const manifest: Manifest = {
      version: 4,
      name: path.basename(workspaceRoot),
      columns: [
        { id: 'backlog', label: 'Backlog', wip_limit: null, cards: [] },
        { id: 'refined', label: 'Refined', wip_limit: null, cards: [] },
        { id: 'in-progress', label: 'In Progress', wip_limit: null, cards: [] },
        { id: 'review', label: 'Review', wip_limit: null, cards: [] },
        { id: 'done', label: 'Done', wip_limit: null, cards: [] },
      ],
      tags: {},
      scripts: {},
      hooks: {},  // in-memory only; written from VSCode settings, not to file
      tagColorTarget: 'tag',
    };
    withLock(boardRoot, () => writeManifest(boardRoot, manifest));
  }

  const writeIfMissing = (filePath: string, content: string) => {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content);
  };
  writeIfMissing(path.join(boardRoot, 'scripts', 'lib.js'), SCRIPT_LIB);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-reviewed.js'), SCRIPT_CARD_REVIEWED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'wip-alert.js'), SCRIPT_WIP_ALERT);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-created.js'), SCRIPT_CARD_CREATED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-edited.js'), SCRIPT_CARD_EDITED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-deleted.js'), SCRIPT_CARD_DELETED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'card-moved.js'), SCRIPT_CARD_MOVED);
  writeIfMissing(path.join(boardRoot, 'scripts', 'cards-archived.js'), SCRIPT_CARDS_ARCHIVED);
  const guidelinesTemplate = path.join(context.extensionPath, 'resources', 'GUIDELINES.md');
  fs.writeFileSync(path.join(boardRoot, 'GUIDELINES.md'), fs.readFileSync(guidelinesTemplate, 'utf8'));

  const config = vscode.workspace.getConfiguration('personal-kanban');
  const scriptsInfo = config.inspect('scripts');
  if (isUnset(scriptsInfo?.workspaceValue) && isUnset(scriptsInfo?.workspaceFolderValue)) {
    void config.update('scripts', {
      'card-reviewed':  { file: 'scripts/card-reviewed.js' },
      'wip-alert':      { file: 'scripts/wip-alert.js' },
      'card-created':   { file: 'scripts/card-created.js' },
      'card-edited':    { file: 'scripts/card-edited.js' },
      'card-deleted':   { file: 'scripts/card-deleted.js' },
      'card-moved':     { file: 'scripts/card-moved.js' },
      'cards-archived': { file: 'scripts/cards-archived.js' },
    }, vscode.ConfigurationTarget.Workspace);
  }
  const hooksInfo = config.inspect('hooks');
  if (isUnset(hooksInfo?.workspaceValue) && isUnset(hooksInfo?.workspaceFolderValue)) {
    void config.update('hooks', {
      'card.reviewed':   ['card-reviewed'],
      'wip.violated':    ['wip-alert'],
      'card.created':    ['card-created'],
      'card.edited':     ['card-edited'],
      'card.deleted':    ['card-deleted'],
      'card.moved':      ['card-moved'],
      'cards.archived':  ['cards-archived'],
    }, vscode.ConfigurationTarget.Workspace);
  }
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

const SCRIPT_LIB = `'use strict';

const { execSync } = require('child_process');

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

module.exports = { readPayload, notify };
`;

const SCRIPT_CARD_REVIEWED = `#!/usr/bin/env node
// Fires a system notification when a card moves to Review.
//
// Hook event: card.reviewed
// Payload: { event, timestamp, card_id, card_title, from_column, branch }
//
// Card files live at: cards/<card_id>.md  (YAML frontmatter + markdown body)

'use strict';

const { readPayload, notify } = require('./lib');

readPayload('card-reviewed', ({ card_title, branch }) => {
  const message = branch
    ? \`"\${card_title}" is ready for review — branch: \${branch}\`
    : \`"\${card_title}" is ready for review\`;

  notify('Kanban: Ready for Review', message);
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

readPayload('wip-alert', ({ column, wip_limit, current_count }) => {
  const message = \`WIP limit exceeded in "\${column}": \${current_count} cards (limit: \${wip_limit})\`;

  notify('Kanban WIP Alert', message);
  process.stdout.write(message + '\\n');
});
`;

const SCRIPT_CARD_CREATED = `#!/usr/bin/env node
// Fires when a new card is created.
//
// Hook event: card.created
// Payload: { event, timestamp, card_id, card_title, column }
//
// Card files live at: cards/<card_id>.md  (YAML frontmatter + markdown body)

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
// Payload: { event, timestamp, card_id, card_title }
//
// Card files live at: cards/<card_id>.md  (YAML frontmatter + markdown body)

'use strict';

const { readPayload } = require('./lib');

readPayload('card-edited', ({ card_id, card_title }) => {
  process.stdout.write(\`card edited: "\${card_title}" (\${card_id})\\n\`);
});
`;

const SCRIPT_CARD_DELETED = `#!/usr/bin/env node
// Fires when a card is deleted.
//
// Hook event: card.deleted
// Payload: { event, timestamp, card_id, card_title, last_column }
//
// Note: by the time this fires the card file has already been removed.

'use strict';

const { readPayload } = require('./lib');

readPayload('card-deleted', ({ card_id, card_title, last_column }) => {
  process.stdout.write(\`card deleted: "\${card_title}" (\${card_id}) from \${last_column}\\n\`);
});
`;

const SCRIPT_CARD_MOVED = `#!/usr/bin/env node
// Fires whenever a card moves between columns.
//
// Hook event: card.moved
// Payload: { event, timestamp, card_id, card_title, from_column, to_column, branch }
//
// Card files live at: cards/<card_id>.md  (YAML frontmatter + markdown body)

'use strict';

const { readPayload, notify } = require('./lib');

readPayload('card-moved', ({ card_title, to_column, branch }) => {
  const message = (to_column === 'done' && branch)
    ? \`"\${card_title}" moved to Done — branch: \${branch}\`
    : \`"\${card_title}" moved to \${to_column}\`;

  notify('Kanban: Card Moved', message);
  process.stdout.write(message + '\\n');
});
`;

const SCRIPT_CARDS_ARCHIVED = `#!/usr/bin/env node
// Fires after all Done cards are archived.
//
// Hook event: cards.archived
// Payload: { event, timestamp, column }
//
// Archived card files live at: archive/<card_id>.md  (YAML frontmatter + markdown body)

'use strict';

const { readPayload } = require('./lib');

readPayload('cards-archived', ({ column }) => {
  process.stdout.write(\`cards archived from: \${column}\\n\`);
});
`;

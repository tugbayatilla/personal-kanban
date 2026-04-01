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
    vscode.commands.registerCommand('personal-kanban.initBoard', () => initBoard()),
    vscode.commands.registerCommand('personal-kanban.openBoard', () => {
      const root = getWorkspaceRoot();
      if (root) BoardPanel.createOrShow(context, root);
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

function initBoard(): void {
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
  writeIfMissing(path.join(boardRoot, 'GUIDELINES.md'), GUIDELINES_CONTENT);

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

const GUIDELINES_CONTENT = `# Kanban Board Guidelines

## Columns

| Column | Purpose |
|--------|---------|
| Backlog | All ideas and future work. No commitment yet. |
| Refined | Scoped, estimated, and ready to be picked up. |
| In Progress | Actively being worked on. Respect WIP limits. |
| Review | Work complete, awaiting review or verification. |
| Done | Accepted and shipped. |

## Rules

1. **One thing at a time.** Keep In Progress cards to a minimum. Set a WIP limit if needed.
2. **Refine before starting.** A card should be in Refined with a clear description before moving to In Progress.
3. **Move cards forward, not backward.** If a card needs rework, add a note rather than pulling it back.
4. **Archive regularly.** Move Done cards to the archive to keep the board clean.

## Tags

- \`bug\` — Something broken that needs fixing.
- \`feature\` — New functionality.
- \`chore\` — Maintenance, dependency updates, tooling.
- \`urgent\` — Needs attention before other work.

## Coding

### Implementation Workflow

1. Move card to in-progress: remove id from current column, append to in-progress, update card's \`updated_at\`.
2. Create branch \`{tag-prefix}/short-name\` from a fresh pull of main; save branch name to card metadata.
3. Run the tests and make sure all green.
4. Append a \`## Plan\` section to the card content describing the implementation approach.
5. Run tests to confirm green baseline before changing anything.
6. Implement the solution following the plan.
7. Make small focused commits with Conventional Commits messages throughout.
8. Write tests for new behaviour; all must pass before proceeding.
9. Append a \`## Summary\` section to the card content describing what was done.
10. Commit remaining work, push branch, move card to review, append \`#claude-code\` to card tag line. Stop.

### Card Format

Card files live in \`cards/<id>.md\` and use YAML frontmatter followed by Markdown body:

\`\`\`
---
id: <YYYYMMDD-xxxx>
created_at: <ISO-8601>
updated_at: <ISO-8601>
branch: <branch-name>       # optional — set when work starts
archived_at: <ISO-8601>     # optional — set when archived
---

#tag1 #tag2

# Card Title

Card description and notes in Markdown.
\`\`\`

- The first line of the body should be a space-separated list of \`#tags\`.
- The card title is the first H1 (\`#\`) heading.
- Everything after the title is free-form Markdown.

## Scripts & Hooks

- \`scripts/card-reviewed.js\` — Fires when a card moves to Review.
- \`scripts/wip-alert.js\` — Fires when a WIP limit is exceeded.
- \`scripts/card-created.js\` — Fires when a new card is created.
- \`scripts/card-edited.js\` — Fires when a card's content changes.
- \`scripts/card-deleted.js\` — Fires when a card is deleted.
- \`scripts/card-moved.js\` — Fires when a card moves between columns.
- \`scripts/cards-archived.js\` — Fires after Done cards are archived.

Scripts receive a JSON payload via stdin. Shared helpers (notifications, payload parsing) are in \`scripts/lib.js\`.

Customize or add scripts in \`.vscode/settings.json\` under \`personal-kanban.scripts\` and \`personal-kanban.hooks\`.
`;

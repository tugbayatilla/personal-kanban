import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BoardPanel } from './BoardPanel';
import { getBoardRoot, boardExists, writeManifest } from './io';
import { setOutputChannel } from './hooks';
import { Manifest } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Personal Kanban');
  setOutputChannel(outputChannel);
  context.subscriptions.push(outputChannel);

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

function initBoard(): void {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const boardRoot = getBoardRoot(workspaceRoot);
  if (boardExists(boardRoot)) {
    vscode.window.showInformationMessage('Kanban: Board already exists.');
    return;
  }

  fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
  fs.writeFileSync(path.join(boardRoot, 'board.log'), '', 'utf-8');

  // V3 manifest — structure only (column IDs → card ID lists)
  const manifest: Manifest = {
    version: 3,
    name: path.basename(workspaceRoot),
    columns: [
      { id: 'backlog',      label: 'Backlog',      wip_limit: null, cards: [] },
      { id: 'refined',     label: 'Refined',      wip_limit: null, cards: [] },
      { id: 'in-progress', label: 'In Progress',  wip_limit: 1,    cards: [] },
      { id: 'review',      label: 'Review',       wip_limit: null, cards: [] },
      { id: 'done',        label: 'Done',         wip_limit: null, cards: [] },
    ],
    tags: {},
    hooks: {},
  };
  writeManifest(boardRoot, manifest);

  // Write default board config to workspace settings
  _writeDefaultSettings(workspaceRoot);

  vscode.window.showInformationMessage('Kanban: Board initialized.');
}

function _writeDefaultSettings(workspaceRoot: string): void {
  const settingsDir = path.join(workspaceRoot, '.vscode');
  const settingsPath = path.join(settingsDir, 'settings.json');

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      // ignore parse errors
    }
  }

  if (existing['personalKanban.columns']) {
    return; // already configured
  }

  const defaults = {
    'personalKanban.boardPath': '.personal-kanban',
    'personalKanban.columns': [
      { id: 'backlog',      label: 'Backlog',      wipLimit: null },
      { id: 'refined',     label: 'Refined',      wipLimit: null },
      { id: 'in-progress', label: 'In Progress',  wipLimit: 1    },
      { id: 'review',      label: 'Review',       wipLimit: null },
      { id: 'done',        label: 'Done',         wipLimit: null },
    ],
    'personalKanban.tags': {
      bug:         { color: '#e74c3c' },
      feature:     { color: '#2ecc71' },
      improvement: { color: '#3498db' },
      chore:       { color: '#95a5a6' },
      'claude-code':{ color: '#9b59b6' },
    },
    'personalKanban.hooks': {},
  };

  fs.mkdirSync(settingsDir, { recursive: true });
  const merged = { ...existing, ...defaults };
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
}

export function deactivate(): void {}

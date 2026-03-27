import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BoardPanel } from './BoardPanel';
import { getBoardRoot, boardExists, writeManifest } from './io';
import { Manifest } from './types';

export function activate(context: vscode.ExtensionContext): void {
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

  const manifest: Manifest = {
    version: 1,
    name: path.basename(workspaceRoot),
    columns: [
      { id: 'backlog', label: 'Backlog', wip_limit: null },
      { id: 'in-progress', label: 'In Progress', wip_limit: null },
      { id: 'review', label: 'Review', wip_limit: null },
      { id: 'done', label: 'Done', wip_limit: null },
    ],
    tags: {},
    cards: { backlog: [], 'in-progress': [], review: [], done: [] },
    hooks: {},
  };

  writeManifest(boardRoot, manifest);
  vscode.window.showInformationMessage('Kanban: Board initialized.');
}

export function deactivate(): void {}

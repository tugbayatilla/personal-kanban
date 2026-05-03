/**
 * VSCode-aware wrappers that extend @personal-kanban/core functionality with
 * VSCode workspace configuration support.
 */
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Returns the board root directory, respecting the `boardFolderName` VSCode
 * workspace setting. Falls back to `.personal-kanban` if the setting is unset.
 */
export function getBoardRoot(workspaceRoot: string): string {
  const folderName = vscode.workspace.getConfiguration('personal-kanban').get<string>('boardFolderName', '.personal-kanban');
  return path.join(workspaceRoot, folderName);
}

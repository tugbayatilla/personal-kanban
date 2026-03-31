import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { appendBoardLog } from './io';

let _outputChannel: vscode.OutputChannel | null = null;

export function setOutputChannel(channel: vscode.OutputChannel): void {
  _outputChannel = channel;
}

function logLine(boardRoot: string, line: string): void {
  const entry = `${new Date().toISOString()}  ${line}`;
  appendBoardLog(boardRoot, line);
  _outputChannel?.appendLine(entry);
}

export function extractTitle(content: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      return line.slice(2).trim();
    }
  }
  return '';
}

/**
 * Fire a hook for the given event.
 * @param hooks  Map of event name → { file: scriptPath } from VSCode settings.
 *               Script paths are resolved relative to the workspace root.
 */
export function fireHook(
  boardRoot: string,
  hooks: Record<string, { file: string }>,
  event: string,
  payload: Record<string, unknown>
): void {
  const hookDef = hooks[event];
  if (!hookDef?.file) return;

  const workspaceRoot = path.dirname(boardRoot);
  const scriptPath = hookDef.file;
  const absScript = path.resolve(workspaceRoot, scriptPath);

  if (!fs.existsSync(absScript)) {
    logLine(boardRoot, `[hook.failed] ${event} → ${scriptPath} (file not found)`);
    return;
  }

  const fullPayload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  });

  const isNode = absScript.endsWith('.js');
  const cmd = isNode ? process.execPath : absScript;
  const args = isNode ? [absScript] : [];

  let child;
  try {
    child = spawn(cmd, args, {
      cwd: workspaceRoot,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
  } catch {
    logLine(boardRoot, `[hook.failed] ${event} → ${scriptPath} (spawn error)`);
    return;
  }

  child.stdin.write(fullPayload);
  child.stdin.end();

  child.on('close', (code: number | null) => {
    if (code === 0) {
      logLine(boardRoot, `[hook.fired] ${event} → ${scriptPath}`);
    } else {
      logLine(boardRoot, `[hook.failed] ${event} → ${scriptPath} (exit ${code ?? 'null'})`);
    }
  });

  child.on('error', () => {
    logLine(boardRoot, `[hook.failed] ${event} → ${scriptPath} (spawn error)`);
  });
}

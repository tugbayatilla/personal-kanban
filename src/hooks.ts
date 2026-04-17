import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { Manifest } from './types';

let _channel: vscode.OutputChannel | undefined;

export function initLogger(channel: vscode.OutputChannel): void {
  _channel = channel;
}

function log(line: string): void {
  _channel?.appendLine(`[${new Date().toISOString()}] ${line}`);
}

export function extractTitle(content: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      return line.slice(2).trim();
    }
  }
  return '';
}

function formatPayloadContext(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (payload.card_id) parts.push(`card=${payload.card_id}`);
  if (payload.from_column) parts.push(`from=${payload.from_column}`);
  if (payload.to_column) parts.push(`to=${payload.to_column}`);
  if (payload.branch) parts.push(`branch=${payload.branch}`);
  if (payload.column_id) parts.push(`column=${payload.column_id}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function fireHook(
  boardRoot: string,
  manifest: Manifest,
  event: string,
  payload: Record<string, unknown>
): void {
  const config = vscode.workspace.getConfiguration('personal-kanban');
  const enabled = config.get<boolean>('enableHooks', true);
  if (!enabled) { return; }

  const scriptNames = manifest.hooks[event];
  if (!scriptNames || scriptNames.length === 0) {
    return;
  }

  const notifications = config.get<boolean>('notifications', true);
  const fullPayload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    notifications,
    ...payload,
  });

  const context = formatPayloadContext(payload);

  for (const scriptName of scriptNames) {
    const scriptDef = manifest.scripts?.[scriptName];
    if (!scriptDef) {
      log(`[hook.failed] ${event}${context} → ${scriptName} (not defined in manifest.scripts)`);
      continue;
    }
    const scriptPath = scriptDef.file;
    const absScript = path.resolve(boardRoot, scriptPath);
    const cmd = process.execPath;
    const args = [absScript];
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: boardRoot,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch {
      log(`[hook.failed] ${event}${context} → ${scriptPath} (spawn error)`);
      continue;
    }

    child.stdin.write(fullPayload);
    child.stdin.end();

    child.on('close', (code: number | null) => {
      if (code === 0) {
        log(`[hook.fired] ${event}${context} → ${scriptPath}`);
      } else {
        log(`[hook.failed] ${event}${context} → ${scriptPath} (exit ${code ?? 'null'})`);
      }
    });

    child.on('error', () => {
      log(`[hook.failed] ${event}${context} → ${scriptPath} (spawn error)`);
    });
  }
}

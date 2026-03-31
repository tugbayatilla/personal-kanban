import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Manifest } from './types';

function getLogPath(boardRoot: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(boardRoot, 'logs', `${date}.log`);
}

function appendLog(boardRoot: string, line: string): void {
  const logPath = getLogPath(boardRoot);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  fs.appendFileSync(logPath, entry, 'utf-8');
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
  const scriptNames = manifest.hooks[event];
  if (!scriptNames || scriptNames.length === 0) {
    return;
  }

  const fullPayload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  });

  const context = formatPayloadContext(payload);

  for (const scriptName of scriptNames) {
    const scriptDef = manifest.scripts?.[scriptName];
    if (!scriptDef) {
      appendLog(boardRoot, `[hook.failed] ${event}${context} → ${scriptName} (not defined in manifest.scripts)`);
      continue;
    }
    const scriptPath = scriptDef.file;
    const absScript = path.resolve(boardRoot, scriptPath);
    const isNode = absScript.endsWith('.js');
    const cmd = isNode ? process.execPath : absScript;
    const args = isNode ? [absScript] : [];
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: boardRoot,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch {
      appendLog(boardRoot, `[hook.failed] ${event}${context} → ${scriptPath} (spawn error)`);
      continue;
    }

    child.stdin.write(fullPayload);
    child.stdin.end();

    child.on('close', (code: number | null) => {
      if (code === 0) {
        appendLog(boardRoot, `[hook.fired] ${event}${context} → ${scriptPath}`);
      } else {
        appendLog(boardRoot, `[hook.failed] ${event}${context} → ${scriptPath} (exit ${code ?? 'null'})`);
      }
    });

    child.on('error', () => {
      appendLog(boardRoot, `[hook.failed] ${event}${context} → ${scriptPath} (spawn error)`);
    });
  }
}

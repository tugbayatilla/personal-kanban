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

export function logInfo(line: string): void {
  log(line);
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

function runScript(
  boardRoot: string,
  scriptPath: string,
  fullPayload: string,
  logContext: string
): Promise<number | null> {
  return new Promise((resolve) => {
    const absScript = path.resolve(boardRoot, scriptPath);
    let child;
    try {
      child = spawn(process.execPath, [absScript], {
        cwd: boardRoot,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch {
      log(`[hook.failed] ${logContext} → ${scriptPath} (spawn error)`);
      resolve(null);
      return;
    }

    child.stdin.write(fullPayload);
    child.stdin.end();

    child.on('close', (code: number | null) => {
      if (code === 0 || code === null) {
        log(`[hook.fired] ${logContext} → ${scriptPath}`);
      } else {
        log(`[hook.failed] ${logContext} → ${scriptPath} (exit ${code})`);
      }
      resolve(code);
    });

    child.on('error', () => {
      log(`[hook.failed] ${logContext} → ${scriptPath} (spawn error)`);
      resolve(null);
    });
  });
}

/**
 * Run a single policy script and return whether the policy is violated.
 *
 * The script receives the move payload as JSON on stdin.
 * Exit code 0 = no violation (move may proceed).
 * Exit code non-zero = policy violated (approval required).
 *
 * If the script cannot be spawned, the policy is treated as not violated so
 * that a missing or broken script never silently blocks all card moves.
 */
export function runPolicyScript(
  boardRoot: string,
  scriptPath: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  return new Promise((resolve) => {
    const absScript = path.resolve(boardRoot, scriptPath);
    const fullPayload = JSON.stringify(payload);

    let child;
    try {
      child = spawn(process.execPath, [absScript], {
        cwd: boardRoot,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch {
      log(`[policy.check.failed] ${scriptPath} (spawn error)`);
      resolve(false);
      return;
    }

    child.stdin.write(fullPayload);
    child.stdin.end();

    child.on('close', (code: number | null) => {
      const violated = code !== null && code !== 0;
      log(`[policy.check] ${scriptPath} → exit ${code} (${violated ? 'violated' : 'ok'})`);
      resolve(violated);
    });

    child.on('error', () => {
      log(`[policy.check.failed] ${scriptPath} (spawn error)`);
      resolve(false);
    });
  });
}

/**
 * Fire all scripts registered for an event in manifest.hooks[event].
 *
 * Execution model:
 * - Scripts run sequentially in the order they appear in the manifest array.
 * - Each script receives the full event payload as JSON on stdin.
 * - If a script exits with a non-zero code, the chain stops immediately —
 *   remaining scripts for this event are not spawned.
 * - Exit code 0 (or null) is treated as success; the chain continues.
 *
 * This allows a guard script (e.g. policy-violation) to be placed first in
 * the array so it can block downstream scripts by exiting with code 1.
 *
 * The function is fire-and-forget (returns void). The async chain runs in the
 * background; callers do not need to await it.
 */
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

  const context = `${event}${formatPayloadContext(payload)}`;

  // Run scripts sequentially. A non-zero exit code stops the chain.
  (async () => {
    for (const scriptName of scriptNames) {
      const scriptDef = manifest.scripts?.[scriptName];
      if (!scriptDef) {
        log(`[hook.failed] ${context} → ${scriptName} (not defined in manifest.scripts)`);
        continue;
      }

      const code = await runScript(boardRoot, scriptDef.file, fullPayload, context);

      if (code !== null && code !== 0) {
        log(`[hook.stopped] ${context} → chain halted by ${scriptDef.file} (exit ${code})`);
        break;
      }
    }
  })();
}

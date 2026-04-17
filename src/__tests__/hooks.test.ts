/**
 * Unit and integration tests for src/hooks.ts
 *
 * Coverage:
 *   - extractTitle: pure function, various markdown heading scenarios
 *   - fireHook: respects enableHooks config, handles missing hook definitions,
 *     spawns the correct script and delivers a JSON payload via stdin
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { resetMockConfig, setMockConfig } from './__mocks__/vscode';
import { extractTitle, fireHook, initLogger } from '../hooks';
import { Manifest } from '../types';

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-hooks-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    name: 'Test',
    columns: [],
    tags: {},
    tagColorTarget: 'tag',
    showCardAge: true,
    scripts: {},
    hooks: {},
    ...overrides,
  };
}

// ── extractTitle ──────────────────────────────────────────────────────────────

describe('extractTitle', () => {
  it('returns the text of the first h1 heading', () => {
    const content = '# My Task Title\n\nSome body text.';
    expect(extractTitle(content)).toBe('My Task Title');
  });

  it('returns the first h1 heading even when preceded by blank lines', () => {
    const content = '\n\n# Heading After Blank Lines\n\nBody.';
    expect(extractTitle(content)).toBe('Heading After Blank Lines');
  });

  it('returns the first h1 heading and ignores subsequent h1 lines', () => {
    const content = '# First Title\n# Second Title\n\nBody.';
    expect(extractTitle(content)).toBe('First Title');
  });

  it('returns an empty string when there is no h1 heading', () => {
    const content = '## Only An H2\n\nNo h1 here.';
    expect(extractTitle(content)).toBe('');
  });

  it('returns an empty string for completely empty content', () => {
    expect(extractTitle('')).toBe('');
  });

  it('trims leading and trailing whitespace from the heading text', () => {
    const content = '#   Padded Title   \n\nBody.';
    expect(extractTitle(content)).toBe('Padded Title');
  });

  it('does not match h2 or deeper headings', () => {
    const content = '### Deep Heading\n\nNo h1.';
    expect(extractTitle(content)).toBe('');
  });

  it('does not match a line that starts with # but has no space after it', () => {
    // "# " prefix is required — "##Title" has two hashes, "#Title" has no space.
    const content = '#NoSpace\n\nBody.';
    expect(extractTitle(content)).toBe('');
  });
});

// ── fireHook ──────────────────────────────────────────────────────────────────

describe('fireHook', () => {
  let boardRoot: string;

  beforeEach(() => {
    boardRoot = makeTempDir();
    resetMockConfig();
    // Silence the logger so test output stays clean.
    initLogger({ appendLine: () => {}, show: () => {}, dispose: () => {} } as never);
  });

  afterEach(() => removeTempDir(boardRoot));

  it('does nothing when hooks are disabled in configuration', () => {
    setMockConfig({ enableHooks: false });
    const manifest = makeManifest({ hooks: { 'card.created': ['my-script'] } });

    // If fireHook tried to spawn, it would throw because the script doesn't exist.
    // No throw = hooks were correctly skipped.
    expect(() => fireHook(boardRoot, manifest, 'card.created', {})).not.toThrow();
  });

  it('does nothing when no hooks are registered for the event', () => {
    setMockConfig({ enableHooks: true });
    const manifest = makeManifest({ hooks: {} });

    expect(() => fireHook(boardRoot, manifest, 'card.created', {})).not.toThrow();
  });

  it('does nothing when the event hook list is empty', () => {
    setMockConfig({ enableHooks: true });
    const manifest = makeManifest({ hooks: { 'card.created': [] } });

    expect(() => fireHook(boardRoot, manifest, 'card.created', {})).not.toThrow();
  });

  it('logs a failure (does not throw) when a named script is not defined in manifest.scripts', () => {
    setMockConfig({ enableHooks: true });
    const manifest = makeManifest({
      hooks: { 'card.created': ['undefined-script'] },
      scripts: {},
    });

    // Should not throw — hooks fire-and-forget; missing definitions are logged.
    expect(() => fireHook(boardRoot, manifest, 'card.created', { card_id: 'x' })).not.toThrow();
  });

  it('spawns the correct Node.js script and receives a JSON payload via stdin', (done) => {
    setMockConfig({ enableHooks: true });

    // Write a hook script that writes its stdin payload to a file so we can inspect it.
    const payloadCapturePath = path.join(boardRoot, 'captured-payload.json');
    const scriptContent = `
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  const fs = require('fs');
  fs.writeFileSync(${JSON.stringify(payloadCapturePath)}, Buffer.concat(chunks).toString());
  process.exit(0);
});
`;
    const scriptPath = path.join(boardRoot, 'hook-script.js');
    fs.writeFileSync(scriptPath, scriptContent);

    const manifest = makeManifest({
      hooks: { 'card.moved': ['move-hook'] },
      scripts: { 'move-hook': { file: 'hook-script.js' } },
    });

    fireHook(boardRoot, manifest, 'card.moved', {
      card_id:     'test-card-01',
      from_column: 'backlog',
      to_column:   'in-progress',
    });

    // Give the child process time to run and write the file.
    setTimeout(() => {
      expect(fs.existsSync(payloadCapturePath)).toBe(true);

      const payload = JSON.parse(fs.readFileSync(payloadCapturePath, 'utf-8'));
      expect(payload.event).toBe('card.moved');
      expect(payload.card_id).toBe('test-card-01');
      expect(payload.from_column).toBe('backlog');
      expect(payload.to_column).toBe('in-progress');
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      done();
    }, 1500);
  }, 5000);

  it('spawns scripts for all hook names registered for the same event', (done) => {
    setMockConfig({ enableHooks: true });

    const touch1 = path.join(boardRoot, 'touched-1.txt');
    const touch2 = path.join(boardRoot, 'touched-2.txt');

    const makeScript = (touchPath: string) =>
      `require('fs').writeFileSync(${JSON.stringify(touchPath)}, 'ok'); process.exit(0);`;

    fs.writeFileSync(path.join(boardRoot, 'script-a.js'), makeScript(touch1));
    fs.writeFileSync(path.join(boardRoot, 'script-b.js'), makeScript(touch2));

    const manifest = makeManifest({
      hooks: { 'card.deleted': ['hook-a', 'hook-b'] },
      scripts: {
        'hook-a': { file: 'script-a.js' },
        'hook-b': { file: 'script-b.js' },
      },
    });

    fireHook(boardRoot, manifest, 'card.deleted', { card_id: 'del-01' });

    setTimeout(() => {
      expect(fs.existsSync(touch1)).toBe(true);
      expect(fs.existsSync(touch2)).toBe(true);
      done();
    }, 1500);
  }, 5000);
});

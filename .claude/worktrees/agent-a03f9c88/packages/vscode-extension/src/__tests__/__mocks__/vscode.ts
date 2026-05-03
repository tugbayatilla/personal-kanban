/**
 * Minimal vscode API stub for use in Jest tests.
 *
 * The real vscode module is injected by the extension host and is not
 * importable in a plain Node.js test environment. This module provides just
 * enough surface area for the code under test to run without crashing.
 *
 * Individual tests that need different configuration values should call
 * `setMockConfig()` before exercising the code.
 */

// ── Configurable defaults ─────────────────────────────────────────────────────

interface MockConfig {
  tags: Record<string, { color: string; weight: number }>;
  tagColorTarget: string;
  showCardAge: boolean;
  boardFolderName: string;
  cardsFolderPath: string;
  archiveFolderPath: string;
  enableHooks: boolean;
  scripts: Record<string, unknown>;
  hooks: Record<string, string[]>;
}

let _mockConfig: MockConfig = {
  tags: {},
  tagColorTarget: 'tag',
  showCardAge: true,
  boardFolderName: '.personal-kanban',
  cardsFolderPath: '',
  archiveFolderPath: '',
  enableHooks: true,
  scripts: {},
  hooks: {},
};

/**
 * Override configuration values returned by `vscode.workspace.getConfiguration`.
 * Call this in a `beforeEach` or inside a specific test to control what the
 * code under test sees.
 */
export function setMockConfig(overrides: Partial<MockConfig>): void {
  _mockConfig = { ..._mockConfig, ...overrides };
}

/** Reset configuration to its default stub values. */
export function resetMockConfig(): void {
  _mockConfig = {
    tags: {},
    tagColorTarget: 'tag',
    showCardAge: true,
    boardFolderName: '.personal-kanban',
    cardsFolderPath: '',
    archiveFolderPath: '',
    enableHooks: true,
    scripts: {},
    hooks: {},
  };
}

// ── vscode.workspace.getConfiguration stub ────────────────────────────────────

const configurationProxy = {
  get<T>(key: string, defaultValue?: T): T {
    const value = (_mockConfig as unknown as Record<string, unknown>)[key];
    if (value !== undefined) return value as T;
    if (defaultValue !== undefined) return defaultValue;
    return undefined as unknown as T;
  },
};

export const workspace = {
  getConfiguration(_section?: string) {
    return configurationProxy;
  },
  workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
  createFileSystemWatcher() {
    return {
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    };
  },
};

// ── vscode.window stub ────────────────────────────────────────────────────────

export const window = {
  createOutputChannel: jest.fn().mockReturnValue({
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  }),
  createWebviewPanel: jest.fn(),
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn<Promise<string | undefined>, [string, ...unknown[]]>(),
  showTextDocument: jest.fn(),
};

// ── vscode.Uri stub ───────────────────────────────────────────────────────────

export const Uri = {
  file: (p: string) => ({ fsPath: p, toString: () => p }),
  joinPath: (...parts: Array<{ fsPath: string } | string>) => {
    const segments = parts.map((p) => (typeof p === 'string' ? p : p.fsPath));
    return { fsPath: segments.join('/'), toString: () => segments.join('/') };
  },
};

// ── Misc stubs ────────────────────────────────────────────────────────────────

export const ViewColumn = { One: 1 };

export const RelativePattern = class {
  constructor(public base: unknown, public pattern: string) {}
};

export const ExtensionContext = {};

export const commands = {
  registerCommand: jest.fn(),
};

export const extensions = {
  getExtension: jest.fn(),
};

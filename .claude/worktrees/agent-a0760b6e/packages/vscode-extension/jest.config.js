/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // Stub the vscode module — not available outside the extension host.
    vscode: '<rootDir>/src/__tests__/__mocks__/vscode.ts',
    // Resolve @personal-kanban/core to its source (no build step needed for tests).
    '^@personal-kanban/core$': '<rootDir>/../kanban-core/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

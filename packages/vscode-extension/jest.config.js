/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // Stub the vscode module — not available outside the extension host.
    vscode: '<rootDir>/src/__tests__/__mocks__/vscode.ts',
    // Resolve @personal-kanban/core to its TypeScript source so ts-jest can
    // transform it and jest.spyOn can intercept its exports.
    '^@personal-kanban/core$': '<rootDir>/../kanban-core/src/index.ts',
    // Allow direct import of the hooks module for spying in tests.
    '^@personal-kanban/core/hooks$': '<rootDir>/../kanban-core/src/hooks.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

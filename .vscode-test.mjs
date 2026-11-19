import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'test-real/suite/**/*.test.js',
  workspaceFolder: 'test-real/multi.code-workspace',
  mocha: { ui: 'bdd', timeout: 30000 },
  launchArgs: ['--no-sandbox', '--disable-gpu', '--disable-updates', '--skip-welcome'],
});

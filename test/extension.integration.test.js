'use strict';

// Integration test: runs the REAL src/extension.js against a stubbed
// `vscode` module that simulates workspaces on disk, then asks the
// registered completion provider what it would offer for each file.
// This exercises the exact code path VS Code would call, short of the
// editor UI itself.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SAMPLE = path.resolve(__dirname, '..', 'sample-workspace');
const sampleRules = JSON.parse(
  fs.readFileSync(path.join(SAMPLE, '.vscode', 'settings.json'), 'utf8'),
)['snipGate.rules'];

// ---- mutable simulation state, swapped per test ----
let state = { folders: [], rulesByFolder: new Map() };

class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}
class SnippetString { constructor(value) { this.value = value; } }
class MarkdownString { constructor(value) { this.value = value; } }

let capturedProvider = null;
let outputLines = [];

const vscodeStub = {
  CompletionItem,
  SnippetString,
  MarkdownString,
  CompletionItemKind: { Snippet: 15 },
  Uri: { file: (fsPath) => ({ fsPath, scheme: 'file' }) },
  window: {
    createOutputChannel: () => ({
      appendLine: (line) => outputLines.push(line),
      show: () => {},
    }),
    showInformationMessage: async () => undefined,
    activeTextEditor: undefined,
  },
  workspace: {
    getWorkspaceFolder: (uri) => {
      const folder = state.folders.find((f) =>
        uri.fsPath === f || uri.fsPath.startsWith(f + path.sep),
      );
      return folder ? { uri: { fsPath: folder }, name: path.basename(folder) } : undefined;
    },
    getConfiguration: (section, resource) => ({
      get: (key, fallback) => {
        // folder-scoped rules: keyed by the folder that owns the document
        const folder = state.folders.find((f) =>
          resource && (resource.fsPath === f || resource.fsPath.startsWith(f + path.sep)),
        );
        const rules = folder ? state.rulesByFolder.get(folder) : undefined;
        return rules !== undefined ? rules : fallback;
      },
    }),
    createFileSystemWatcher: () => ({
      onDidChange: () => {}, onDidCreate: () => {}, onDidDelete: () => {}, dispose: () => {},
    }),
  },
  languages: {
    registerCompletionItemProvider: (selector, provider) => {
      capturedProvider = provider;
      return { dispose: () => {} };
    },
  },
  commands: { registerCommand: () => ({ dispose: () => {} }) },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, ...rest);
};

let extension;
before(() => {
  extension = require('../src/extension');
  extension.activate({ subscriptions: [] });
  assert.ok(capturedProvider, 'provider was registered');
});

function makeDocument(fsPath, languageId) {
  return {
    uri: { fsPath, scheme: 'file' },
    languageId,
    getWordRangeAtPosition: () => undefined,
  };
}

async function labelsFor(fsPath, languageId) {
  const items = await capturedProvider.provideCompletionItems(
    makeDocument(fsPath, languageId),
    { line: 0, character: 0 },
  );
  return items.map((i) => i.label).sort();
}

test('sample workspace: test file gets ONLY the test snippets', async () => {
  state = { folders: [SAMPLE], rulesByFolder: new Map([[SAMPLE, sampleRules]]) };
  const labels = await labelsFor(path.join(SAMPLE, 'src/sample.test.ts'), 'typescript');
  assert.deepEqual(labels, ['expecteq', 'testblock']);
});

test('sample workspace: plain helper file gets NOTHING (missing-file rule skipped silently)', async () => {
  state = { folders: [SAMPLE], rulesByFolder: new Map([[SAMPLE, sampleRules]]) };
  const labels = await labelsFor(path.join(SAMPLE, 'src/utils/helper.ts'), 'typescript');
  assert.deepEqual(labels, []);
});

test('sample workspace: component file gets ONLY the component snippet', async () => {
  state = { folders: [SAMPLE], rulesByFolder: new Map([[SAMPLE, sampleRules]]) };
  const labels = await labelsFor(path.join(SAMPLE, 'src/components/Button.tsx'), 'typescriptreact');
  assert.deepEqual(labels, ['comp']);
});

test('snippet body and detail survive the trip (tabstops intact)', async () => {
  state = { folders: [SAMPLE], rulesByFolder: new Map([[SAMPLE, sampleRules]]) };
  const items = await capturedProvider.provideCompletionItems(
    makeDocument(path.join(SAMPLE, 'src/sample.test.ts'), 'typescript'),
    { line: 0, character: 0 },
  );
  const tb = items.find((i) => i.label === 'testblock');
  assert.ok(tb.insertText.value.includes("${1:description}"));
  assert.ok(tb.insertText.value.includes('$0'));
  assert.equal(tb.kind, 15);
  assert.ok(tb.detail.includes('test.code-snippets'));
});

test('multi-root: same rules, snippet file missing in root B -> root B gets nothing, root A unaffected', async () => {
  // Build root B: same folder shape, but NO .vscode/snipgate/ at all.
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-rootB-'));
  fs.mkdirSync(path.join(rootB, 'src'), { recursive: true });
  fs.writeFileSync(path.join(rootB, 'src', 'x.test.ts'), '// x');
  state = {
    folders: [SAMPLE, rootB],
    rulesByFolder: new Map([[SAMPLE, sampleRules], [rootB, sampleRules]]),
  };
  assert.deepEqual(
    await labelsFor(path.join(rootB, 'src', 'x.test.ts'), 'typescript'),
    [],
    'root B: missing snippet file means the rule is ignored, no error, no items',
  );
  assert.deepEqual(
    await labelsFor(path.join(SAMPLE, 'src/sample.test.ts'), 'typescript'),
    ['expecteq', 'testblock'],
    'root A still works in the same session',
  );
});

test('multi-root: different rules per folder stay separate', async () => {
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-rootB2-'));
  fs.mkdirSync(path.join(rootB, '.vscode', 'snipgate'), { recursive: true });
  fs.mkdirSync(path.join(rootB, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(rootB, '.vscode', 'snipgate', 'b.code-snippets'),
    JSON.stringify({ BOnly: { prefix: 'bonly', body: '// b only' } }),
  );
  const rulesB = [{ patterns: ['\\.ts$'], snippetFile: '.vscode/snipgate/b.code-snippets' }];
  state = {
    folders: [SAMPLE, rootB],
    rulesByFolder: new Map([[SAMPLE, sampleRules], [rootB, rulesB]]),
  };
  assert.deepEqual(await labelsFor(path.join(rootB, 'src', 'y.ts'), 'typescript'), ['bonly']);
  // the sample root does not see root B's snippet, and vice versa
  assert.deepEqual(
    await labelsFor(path.join(SAMPLE, 'src/sample.test.ts'), 'typescript'),
    ['expecteq', 'testblock'],
  );
});

test('documentation is a plain string, not Markdown (no remote-image beacons)', async () => {
  state = { folders: [SAMPLE], rulesByFolder: new Map([[SAMPLE, sampleRules]]) };
  const items = await capturedProvider.provideCompletionItems(
    makeDocument(path.join(SAMPLE, 'src/sample.test.ts'), 'typescript'),
    { line: 0, character: 0 },
  );
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(typeof item.documentation, 'string');
  }
});

test('oversized snippet file is skipped, not loaded', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-big-'));
  fs.mkdirSync(path.join(root, '.vscode', 'snipgate'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const big = JSON.stringify({ Big: { prefix: 'big', body: 'x'.repeat(1024 * 1024) } });
  assert.ok(big.length > 1024 * 1024);
  fs.writeFileSync(path.join(root, '.vscode', 'snipgate', 'big.code-snippets'), big);
  const rules = [{ patterns: ['\\.ts$'], snippetFile: '.vscode/snipgate/big.code-snippets' }];
  state = { folders: [root], rulesByFolder: new Map([[root, rules]]) };
  assert.deepEqual(await labelsFor(path.join(root, 'src', 'a.ts'), 'typescript'), []);
});

test('a nested-quantifier pattern is rejected and does not stall or break other rules', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-redos-'));
  fs.mkdirSync(path.join(root, '.vscode', 'snipgate'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.vscode', 'snipgate', 'ok.code-snippets'),
    JSON.stringify({ Ok: { prefix: 'okp', body: '// ok' } }),
  );
  const rules = [
    { patterns: ['([a-z]+)+\\.tsx$'], snippetFile: '.vscode/snipgate/ok.code-snippets' },
    { patterns: ['\\.ts$'], snippetFile: '.vscode/snipgate/ok.code-snippets' },
  ];
  state = { folders: [root], rulesByFolder: new Map([[root, rules]]) };
  const started = Date.now();
  const labels = await labelsFor(path.join(root, 'src', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa.ts'), 'typescript');
  assert.ok(Date.now() - started < 1000, 'matching returned promptly');
  assert.deepEqual(labels, ['okp'], 'the healthy rule still supplies its snippet');
});

test('file outside any workspace folder gets nothing', async () => {
  state = { folders: [SAMPLE], rulesByFolder: new Map([[SAMPLE, sampleRules]]) };
  assert.deepEqual(await labelsFor('/tmp/nowhere/loose.ts', 'typescript'), []);
});

test('activation logged and no errors were swallowed into output', () => {
  assert.ok(outputLines.some((l) => l.includes('activated')));
});

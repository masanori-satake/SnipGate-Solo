'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core');

test('normalizeRelPath converts backslashes and drops ./', () => {
  assert.equal(core.normalizeRelPath('src\\components\\Button.tsx'), 'src/components/Button.tsx');
  assert.equal(core.normalizeRelPath('./src/a.ts'), 'src/a.ts');
  assert.equal(core.normalizeRelPath('src//a.ts'), 'src/a.ts');
});

test('ruleMatches: extension regex', () => {
  const rule = { patterns: ['\\.test\\.ts$'], snippetFile: 'x.code-snippets' };
  assert.equal(core.ruleMatches(rule, 'src/foo.test.ts'), true);
  assert.equal(core.ruleMatches(rule, 'src/foo.ts'), false);
});

test('ruleMatches: multiple patterns are OR', () => {
  const rule = {
    patterns: ['\\.test\\.ts$', '^src/components/'],
    snippetFile: 'x.code-snippets',
  };
  assert.equal(core.ruleMatches(rule, 'src/foo.test.ts'), true);
  assert.equal(core.ruleMatches(rule, 'src/components/Button.tsx'), true);
  assert.equal(core.ruleMatches(rule, 'src/pages/Home.tsx'), false);
});

test('ruleMatches: windows-style separators in the target still match', () => {
  const rule = { patterns: ['^src/components/'], snippetFile: 'x.code-snippets' };
  assert.equal(core.ruleMatches(rule, 'src\\components\\Button.tsx'), true);
});

test('ruleMatches: a specific file name can be pinned by regex', () => {
  const rule = { patterns: ['(^|/)vite\\.config\\.ts$'], snippetFile: 'x.code-snippets' };
  assert.equal(core.ruleMatches(rule, 'vite.config.ts'), true);
  assert.equal(core.ruleMatches(rule, 'packages/app/vite.config.ts'), true);
  assert.equal(core.ruleMatches(rule, 'src/vite.config.ts.bak'), false);
});

test('ruleMatches: invalid regex never matches and is reported, others still work', () => {
  const { regexes, errors } = core.compilePatterns(['[', '\\.ts$']);
  assert.equal(regexes.length, 1);
  assert.equal(errors.length, 1);
  const rule = { patterns: ['[', '\\.ts$'], snippetFile: 'x.code-snippets' };
  assert.equal(core.ruleMatches(rule, 'a.ts'), true);
  assert.equal(core.ruleMatches(rule, 'a.js'), false);
});

test('validateRule catches missing fields', () => {
  assert.deepEqual(core.validateRule({ patterns: ['a'], snippetFile: 'f' }), []);
  assert.ok(core.validateRule({ patterns: [], snippetFile: 'f' }).length > 0);
  assert.ok(core.validateRule({ patterns: ['a'] }).length > 0);
  assert.ok(core.validateRule(null).length > 0);
});

test('parseSnippets: comments, trailing commas, prefix/body arrays', () => {
  const text = `{
    // a comment
    "Test Block": {
      "prefix": ["testblock", "tb"],
      "body": ["test('\${1:desc}', () => {", "\\t$0", "});",],
      "description": "Insert a test block",
      "scope": "typescript, javascript",
    },
    /* block comment */
    "Single": { "prefix": "one", "body": "one();" }
  }`;
  const snippets = core.parseSnippets(text);
  assert.equal(snippets.length, 2);
  assert.deepEqual(snippets[0].prefixes, ['testblock', 'tb']);
  assert.equal(snippets[0].body, "test('${1:desc}', () => {\n\t$0\n});");
  assert.deepEqual(snippets[0].scope, ['typescript', 'javascript']);
  assert.deepEqual(snippets[1].prefixes, ['one']);
  assert.deepEqual(snippets[1].scope, []);
});

test('parseSnippets: // inside a string is not treated as a comment', () => {
  const text = `{ "Url": { "prefix": "url", "body": "https://example.com/$0" } }`;
  const snippets = core.parseSnippets(text);
  assert.equal(snippets[0].body, 'https://example.com/$0');
});

test('parseSnippets: entries without a prefix are skipped', () => {
  const text = `{ "NoPrefix": { "body": "x" }, "Ok": { "prefix": "ok", "body": "y" } }`;
  assert.deepEqual(core.parseSnippets(text).map((s) => s.name), ['Ok']);
});

test('snippetAppliesToLanguage honours scope, empty scope = all', () => {
  assert.equal(core.snippetAppliesToLanguage({ scope: [] }, 'rust'), true);
  assert.equal(core.snippetAppliesToLanguage({ scope: ['typescript'] }, 'typescript'), true);
  assert.equal(core.snippetAppliesToLanguage({ scope: ['typescript'] }, 'javascript'), false);
});

test('joinSnippetPath joins folder and relative path, allowing ..', () => {
  assert.equal(
    core.joinSnippetPath('/ws/app', '.vscode/snipgate/test.code-snippets'),
    '/ws/app/.vscode/snipgate/test.code-snippets',
  );
  assert.equal(
    core.joinSnippetPath('C:\\ws\\app', '../shared/common.code-snippets'),
    'C:/ws/app/../shared/common.code-snippets',
  );
});

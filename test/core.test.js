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

test('compilePatterns rejects nested quantifiers but keeps ordinary patterns', () => {
  for (const bad of ['([a-z]+)+\\.tsx$', '(a*)*', '(a+)+$', '((a)+)+']) {
    const { regexes, errors } = core.compilePatterns([bad]);
    assert.equal(regexes.length, 0, bad);
    assert.equal(errors.length, 1, bad);
    assert.match(errors[0], /nested quantifiers/);
  }
  for (const good of [
    '\\.test\\.ts$',
    '^src/components/',
    '(^|/)vite\\.config\\.ts$',
    '(a|b)+',
    'src/(foo|bar)/',
    '[a-z]+\\.ts$',
  ]) {
    const { regexes, errors } = core.compilePatterns([good]);
    assert.equal(errors.length, 0, good);
    assert.equal(regexes.length, 1, good);
  }
});

test('compilePatterns rejects overlong patterns', () => {
  const { regexes, errors } = core.compilePatterns(['a'.repeat(513)]);
  assert.equal(regexes.length, 0);
  assert.match(errors[0], /longer than 512/);
});

test('compilePatterns rejects adjacent quantified atoms with overlapping sets', () => {
  // Shapes proven to stall the Extension Host (audit 2026-11-22): the
  // engine can partition the input between the quantified atoms in
  // exponentially many ways when they can match the same characters.
  for (const bad of [
    '.*.*.*.*b',
    '[a-z]*[a-z]*[a-z]*$',
    'a*a*a*a*b',
    'a+a+$',
    'a?a?b',
    '\\w*\\d*b',
  ]) {
    const { regexes, errors } = core.compilePatterns([bad]);
    assert.equal(regexes.length, 0, bad);
    assert.equal(errors.length, 1, bad);
    assert.match(errors[0], /adjacent quantified atoms/, bad);
  }
});

test('compilePatterns rejects quantified groups with overlapping alternation', () => {
  for (const bad of [
    '(a|aa)+$',
    '(x|x)+$',
    '(a|aa)*',
    '(ab|a)+',
    '(\\d|\\d\\d)+',
    '((a|aa))+',
    '(foo|foobar)+\\.ts$',
  ]) {
    const { regexes, errors } = core.compilePatterns([bad]);
    assert.equal(regexes.length, 0, bad);
    assert.equal(errors.length, 1, bad);
    assert.match(errors[0], /alternation branches/, bad);
  }
});

test('compilePatterns keeps legitimate patterns that merely look similar', () => {
  for (const good of [
    '^.*\\.ts$', // one quantified atom, then literals
    '(\\.test|\\.spec)\\.ts$', // overlapping branches, but the group is not quantified
    '(foo|bar)+\\.ts$', // quantified group, disjoint branches
    '(ab|ac)?x', // shared first character, but the group repeats at most once
    '\\d{4}-\\d{2}-\\d{2}', // fixed-count quantifiers cannot repartition
    'colou?r', // a single optional atom
    'https?://',
    'a{2,3}b',
    '[a-z]*[0-9]*\\.ts$', // adjacent quantified atoms, disjoint sets
    'x{2}y{3}',
    '(a|b)*abb',
    '[^/]+\\.ts$',
    '^src/(components|pages)/[a-z]+\\.tsx$',
  ]) {
    const { regexes, errors } = core.compilePatterns([good]);
    assert.equal(errors.length, 0, good);
    assert.equal(regexes.length, 1, good);
  }
});

test('validateRule rejects more than MAX_PATTERNS_PER_RULE patterns', () => {
  const tooMany = {
    patterns: Array.from({ length: core.MAX_PATTERNS_PER_RULE + 1 }, () => 'a'),
    snippetFile: 'f',
  };
  assert.ok(core.validateRule(tooMany).some((p) => p.includes('at most')));
  const atLimit = {
    patterns: Array.from({ length: core.MAX_PATTERNS_PER_RULE }, () => 'a'),
    snippetFile: 'f',
  };
  assert.deepEqual(core.validateRule(atLimit), []);
});

test('isInsidePath distinguishes folder-internal and external paths', () => {
  assert.equal(core.isInsidePath('/ws/app', '/ws/app/.vscode/snipgate/x.code-snippets'), true);
  assert.equal(core.isInsidePath('/ws/app', '/ws/app'), true);
  assert.equal(core.isInsidePath('/ws/app', '/ws/shared/common.code-snippets'), false);
  assert.equal(core.isInsidePath('/ws/app', '/ws/application/x'), false);
  assert.equal(core.isInsidePath('C:\\ws\\app', 'C:/ws/app/x.code-snippets'), true);
  assert.equal(core.isInsidePath('C:\\ws\\app', 'C:/ws/shared/x.code-snippets'), false);
});

test('ruleMatchesCompiled matches with pre-compiled regexes', () => {
  const { regexes } = core.compilePatterns(['\\.test\\.ts$']);
  assert.equal(core.ruleMatchesCompiled(regexes, 'src/a.test.ts'), true);
  assert.equal(core.ruleMatchesCompiled(regexes, 'src/a.ts'), false);
});

test('parseSnippets preserves commas inside string literals', () => {
  const text = `{ "Arr": { "prefix": "arr", "body": "arr = [1,]; s = \\",]\\"; o = \\",}\\";" } }`;
  const snippets = core.parseSnippets(text);
  assert.equal(snippets[0].body, 'arr = [1,]; s = ",]"; o = ",}";');
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

test('joinSnippetPath joins folder and relative path, resolving ..', () => {
  assert.equal(
    core.joinSnippetPath('/ws/app', '.vscode/snipgate/test.code-snippets'),
    '/ws/app/.vscode/snipgate/test.code-snippets',
  );
  // .. is allowed (pointing outside the folder is a feature) and resolved,
  // so the result is the canonical path of the shared file.
  assert.equal(
    core.joinSnippetPath('C:\\ws\\app', '../shared/common.code-snippets'),
    'C:/ws/shared/common.code-snippets',
  );
  assert.equal(
    core.joinSnippetPath('/ws/app', '../shared/common.code-snippets'),
    '/ws/shared/common.code-snippets',
  );
});

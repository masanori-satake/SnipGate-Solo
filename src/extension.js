'use strict';

const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');
const core = require('./core');

let output;
const snippetCache = new Map(); // fsPath -> { mtimeMs, snippets }
const failedFiles = new Map(); // fsPath -> mtimeMs of a version that failed to parse
const loggedProblems = new Set(); // dedupe noisy logs
const compiledPatternCache = new Map(); // JSON.stringify(patterns) -> { regexes, errors }
const MAX_COMPILED_CACHE_ENTRIES = 256;

/**
 * Compile a rule's patterns, memoised by the patterns themselves:
 * provideCompletionItems runs on essentially every keystroke, and
 * recompiling every rule's patterns each time is wasted work (and, with
 * many rules, a way for a shared workspace's settings to keep the
 * Extension Host busy). Settings edits produce new pattern arrays,
 * hence new cache keys, so changes still take effect immediately.
 */
function compilePatternsCached(patterns) {
  const key = JSON.stringify(patterns);
  let hit = compiledPatternCache.get(key);
  if (!hit) {
    hit = core.compilePatterns(patterns);
    if (compiledPatternCache.size >= MAX_COMPILED_CACHE_ENTRIES) {
      compiledPatternCache.clear();
    }
    compiledPatternCache.set(key, hit);
  }
  return hit;
}

// Real .code-snippets files are kilobytes. The cap keeps a rule that
// (accidentally or maliciously) points at a huge workspace file from
// loading it into the shared Extension Host on every keystroke.
const MAX_SNIPPET_FILE_BYTES = 1024 * 1024;

function log(message) {
  if (output) output.appendLine(message);
}

function logOnce(key, message) {
  if (loggedProblems.has(key)) return;
  loggedProblems.add(key);
  log(message);
}

function skipError(message) {
  const e = new Error(message);
  e.code = 'SNIPGATE_SKIP';
  return e;
}

async function loadSnippets(fsPath) {
  let stat;
  try {
    stat = await fs.stat(fsPath);
  } catch {
    return null; // does not exist in this root: caller skips the rule silently
  }
  if (!stat.isFile()) {
    logOnce(`not-file-${fsPath}`, `${fsPath} is not a regular file; skipped`);
    throw skipError('not a regular file');
  }
  if (stat.size > MAX_SNIPPET_FILE_BYTES) {
    logOnce(
      `too-large-${fsPath}`,
      `${fsPath} is ${stat.size} bytes (limit ${MAX_SNIPPET_FILE_BYTES}); skipped`,
    );
    throw skipError('snippet file too large');
  }
  const cached = snippetCache.get(fsPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.snippets;
  if (failedFiles.get(fsPath) === stat.mtimeMs) {
    // This exact version already failed once: do not re-read and re-parse
    // it on every completion request while the user keeps typing.
    throw skipError('this file version previously failed to parse');
  }
  try {
    const text = await fs.readFile(fsPath, 'utf8');
    const snippets = core.parseSnippets(text); // throws on bad JSON: caller skips
    snippetCache.set(fsPath, { mtimeMs: stat.mtimeMs, snippets });
    failedFiles.delete(fsPath);
    return snippets;
  } catch (e) {
    failedFiles.set(fsPath, stat.mtimeMs);
    throw e;
  }
}

/**
 * Evaluate the rules that apply to a document.
 * Returns { relPath, folder, evaluations } where each evaluation is
 * { rule, matched, status, snippets } and status is one of
 * 'ok' | 'no-match' | 'missing-file' | 'parse-error' | 'unreadable-file'
 * | 'invalid-rule'.
 */
async function evaluateDocument(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return { relPath: null, folder: null, evaluations: [] };

  const relPath = core.normalizeRelPath(
    path.relative(folder.uri.fsPath, document.uri.fsPath),
  );
  const config = vscode.workspace.getConfiguration('snipGate', document.uri);
  const configuredRules = config.get('rules', []);
  const allRules = Array.isArray(configuredRules) ? configuredRules : [];
  if (allRules.length > core.MAX_RULES) {
    logOnce(
      'rules-truncated',
      `${allRules.length} rules are configured; only the first ${core.MAX_RULES} are evaluated`,
    );
  }
  const rules = allRules.slice(0, core.MAX_RULES);
  const evaluations = [];
  let totalSnippets = 0;

  for (const [index, rule] of rules.entries()) {
    const problems = core.validateRule(rule);
    if (problems.length > 0) {
      logOnce(`rule-${index}-invalid`, `[rule ${index}] skipped: ${problems.join('; ')}`);
      evaluations.push({ rule, matched: false, status: 'invalid-rule', snippets: [] });
      continue;
    }
    const { regexes, errors } = compilePatternsCached(rule.patterns);
    for (const error of errors) {
      logOnce(`rule-${index}-${error}`, `[rule ${index}] ${error}`);
    }
    if (!core.ruleMatchesCompiled(regexes, relPath)) {
      evaluations.push({ rule, matched: false, status: 'no-match', snippets: [] });
      continue;
    }
    const snippetFsPath = core.joinSnippetPath(folder.uri.fsPath, rule.snippetFile);
    if (!core.isInsidePath(folder.uri.fsPath, snippetFsPath)) {
      // Pointing outside the folder is an intentional feature (shared
      // snippet files), but it must never happen silently: the user may
      // not realise a cloned workspace's rules read files elsewhere.
      logOnce(
        `outside-${snippetFsPath}`,
        `[rule ${index}] warning: snippetFile "${rule.snippetFile}" resolves outside the workspace folder: ${snippetFsPath}`,
      );
    }
    let snippets;
    try {
      snippets = await loadSnippets(snippetFsPath);
    } catch (e) {
      if (e && e.code === 'SNIPGATE_SKIP') {
        // Not a regular file / too large / known-bad version: the specific
        // reason was already logged once inside loadSnippets.
        evaluations.push({ rule, matched: true, status: 'unreadable-file', snippets: [] });
        continue;
      }
      // Do not log e.message: V8 parse errors embed the start of the file,
      // and a rule may point outside the workspace — keep file contents
      // out of the log.
      logOnce(
        `parse-${snippetFsPath}`,
        `[rule ${index}] could not parse ${rule.snippetFile} (${e.name || 'Error'})`,
      );
      evaluations.push({ rule, matched: true, status: 'parse-error', snippets: [] });
      continue;
    }
    if (snippets === null) {
      // The relative path does not exist in this root: ignore this rule
      // and move on to the next one (multi-root behaviour, by design).
      logOnce(
        `missing-${folder.uri.fsPath}-${rule.snippetFile}`,
        `[rule ${index}] ${rule.snippetFile} not found under ${folder.name}; rule ignored for this root`,
      );
      evaluations.push({ rule, matched: true, status: 'missing-file', snippets: [] });
      continue;
    }
    if (totalSnippets + snippets.length > core.MAX_TOTAL_SNIPPETS) {
      logOnce(
        'snippets-truncated',
        `more than ${core.MAX_TOTAL_SNIPPETS} snippets matched; the excess is not offered`,
      );
      snippets = snippets.slice(0, Math.max(0, core.MAX_TOTAL_SNIPPETS - totalSnippets));
    }
    totalSnippets += snippets.length;
    evaluations.push({ rule, matched: true, status: 'ok', snippets });
  }
  return { relPath, folder, evaluations };
}

const provider = {
  async provideCompletionItems(document, position) {
    if (document.uri.scheme !== 'file') return [];
    let result;
    try {
      result = await evaluateDocument(document);
    } catch (e) {
      log(`provideCompletionItems failed: ${e.message}`);
      return [];
    }
    const items = [];
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z0-9_-]+/);
    for (const ev of result.evaluations) {
      if (ev.status !== 'ok') continue;
      for (const snippet of ev.snippets) {
        if (!core.snippetAppliesToLanguage(snippet, document.languageId)) continue;
        for (const prefix of snippet.prefixes) {
          const item = new vscode.CompletionItem(prefix, vscode.CompletionItemKind.Snippet);
          item.insertText = new vscode.SnippetString(snippet.body);
          item.detail = `${snippet.name} — ${ev.rule.snippetFile}`;
          // Plain string, not MarkdownString: descriptions come from
          // workspace files, and Markdown would let a description embed a
          // remote image (a tracking beacon) in the completion details.
          item.documentation = snippet.description || snippet.name;
          item.filterText = prefix;
          if (wordRange) item.range = wordRange;
          items.push(item);
        }
      }
    }
    return items;
  },
};

async function showMatches() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('SnipGate: no active editor.');
    return;
  }
  let result;
  try {
    result = await evaluateDocument(editor.document);
  } catch (e) {
    log(`showMatches failed: ${e.name || 'Error'}`);
    void vscode.window.showInformationMessage('SnipGate: could not evaluate rules.');
    return;
  }
  const { relPath, folder, evaluations } = result;
  output.show(true);
  log('--- Show Matching Rules ---');
  if (!folder) {
    log(`${editor.document.uri.fsPath} is not inside a workspace folder; no rules apply.`);
    void vscode.window.showInformationMessage(
      'SnipGate: this file is not inside a workspace folder, so no rules apply.',
    );
    return;
  }
  log(`file: ${relPath}  (folder: ${folder.name})`);
  if (evaluations.length === 0) log('no rules configured for this folder.');
  evaluations.forEach((ev, i) => {
    // ev.rule is the raw settings value and can be null or malformed
    // (validateRule passes it through for invalid-rule evaluations).
    const patterns =
      ev.rule && Array.isArray(ev.rule.patterns) ? ev.rule.patterns.join(' | ') : '?';
    const target =
      ev.rule && typeof ev.rule.snippetFile === 'string' ? ev.rule.snippetFile : '?';
    log(
      `[rule ${i}] ${ev.status}  patterns: ${patterns}  -> ${target}` +
        (ev.status === 'ok' ? `  (${ev.snippets.length} snippets)` : ''),
    );
  });
  const okCount = evaluations.filter((e) => e.status === 'ok').length;
  void vscode.window.showInformationMessage(
    `SnipGate: ${okCount} rule(s) supply snippets for ${relPath}. Details in the output panel.`,
  );
}

function activate(context) {
  output = vscode.window.createOutputChannel('SnipGate-Solo');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ scheme: 'file' }, provider),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('snipGate.showMatches', showMatches),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('snipGate.reload', () => {
      snippetCache.clear();
      failedFiles.clear();
      loggedProblems.clear();
      compiledPatternCache.clear();
      void vscode.window.showInformationMessage('SnipGate: snippet cache cleared.');
    }),
  );

  // Editing a snippet file or the settings takes effect without a reload:
  // the cache is keyed by mtime, and configuration is read per request.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.code-snippets');
  const invalidate = (uri) => {
    snippetCache.delete(uri.fsPath);
    failedFiles.delete(uri.fsPath);
  };
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(invalidate),
    watcher.onDidCreate(invalidate),
    watcher.onDidDelete(invalidate),
  );

  log('SnipGate-Solo activated.');
}

function deactivate() {}

module.exports = { activate, deactivate };

'use strict';

const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');
const core = require('./core');

let output;
const snippetCache = new Map(); // fsPath -> { mtimeMs, snippets }
const loggedProblems = new Set(); // dedupe noisy logs

function log(message) {
  if (output) output.appendLine(message);
}

function logOnce(key, message) {
  if (loggedProblems.has(key)) return;
  loggedProblems.add(key);
  log(message);
}

async function loadSnippets(fsPath) {
  let stat;
  try {
    stat = await fs.stat(fsPath);
  } catch {
    return null; // does not exist in this root: caller skips the rule silently
  }
  const cached = snippetCache.get(fsPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.snippets;
  const text = await fs.readFile(fsPath, 'utf8');
  const snippets = core.parseSnippets(text); // throws on bad JSON: caller skips
  snippetCache.set(fsPath, { mtimeMs: stat.mtimeMs, snippets });
  return snippets;
}

/**
 * Evaluate the rules that apply to a document.
 * Returns { relPath, folder, evaluations } where each evaluation is
 * { rule, matched, status, snippets } and status is one of
 * 'ok' | 'no-match' | 'missing-file' | 'parse-error' | 'invalid-rule'.
 */
async function evaluateDocument(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return { relPath: null, folder: null, evaluations: [] };

  const relPath = core.normalizeRelPath(
    path.relative(folder.uri.fsPath, document.uri.fsPath),
  );
  const config = vscode.workspace.getConfiguration('snipGate', document.uri);
  const rules = config.get('rules', []);
  const evaluations = [];

  for (const [index, rule] of (Array.isArray(rules) ? rules : []).entries()) {
    const problems = core.validateRule(rule);
    if (problems.length > 0) {
      logOnce(`rule-${index}-invalid`, `[rule ${index}] skipped: ${problems.join('; ')}`);
      evaluations.push({ rule, matched: false, status: 'invalid-rule', snippets: [] });
      continue;
    }
    const { errors } = core.compilePatterns(rule.patterns);
    for (const error of errors) {
      logOnce(`rule-${index}-${error}`, `[rule ${index}] ${error}`);
    }
    if (!core.ruleMatches(rule, relPath)) {
      evaluations.push({ rule, matched: false, status: 'no-match', snippets: [] });
      continue;
    }
    const snippetFsPath = core.joinSnippetPath(folder.uri.fsPath, rule.snippetFile);
    let snippets;
    try {
      snippets = await loadSnippets(snippetFsPath);
    } catch (e) {
      logOnce(
        `parse-${snippetFsPath}`,
        `[rule ${index}] could not parse ${rule.snippetFile}: ${e.message}`,
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
          item.documentation = new vscode.MarkdownString(
            snippet.description || snippet.name,
          );
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
  const { relPath, folder, evaluations } = await evaluateDocument(editor.document);
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
    const patterns = Array.isArray(ev.rule.patterns) ? ev.rule.patterns.join(' | ') : '?';
    log(
      `[rule ${i}] ${ev.status}  patterns: ${patterns}  -> ${ev.rule.snippetFile}` +
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
      loggedProblems.clear();
      void vscode.window.showInformationMessage('SnipGate: snippet cache cleared.');
    }),
  );

  // Editing a snippet file or the settings takes effect without a reload:
  // the cache is keyed by mtime, and configuration is read per request.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.code-snippets');
  const invalidate = (uri) => snippetCache.delete(uri.fsPath);
  watcher.onDidChange(invalidate);
  watcher.onDidCreate(invalidate);
  watcher.onDidDelete(invalidate);
  context.subscriptions.push(watcher);

  log('SnipGate-Solo activated.');
}

function deactivate() {}

module.exports = { activate, deactivate };

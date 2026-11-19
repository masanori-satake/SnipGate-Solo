'use strict';

// Core logic for the SnipGate prototype.
// No VS Code dependency: everything here is unit-tested with `node --test`.

/**
 * Normalise a workspace-relative path for matching:
 * backslashes become `/`, a leading `./` is dropped, duplicate `/` collapse.
 */
function normalizeRelPath(p) {
  let s = String(p == null ? '' : p).replace(/\\/g, '/');
  s = s.replace(/\/{2,}/g, '/');
  if (s.startsWith('./')) s = s.slice(2);
  return s;
}

/**
 * Compile an array of pattern strings into RegExps.
 * Returns { regexes, errors } — invalid patterns are reported, never thrown,
 * so one bad rule cannot break the others.
 */
function compilePatterns(patterns) {
  const regexes = [];
  const errors = [];
  if (!Array.isArray(patterns)) {
    return { regexes, errors: ['patterns is not an array'] };
  }
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      errors.push(`invalid pattern (not a non-empty string): ${String(pattern)}`);
      continue;
    }
    try {
      regexes.push(new RegExp(pattern));
    } catch (e) {
      errors.push(`invalid regex "${pattern}": ${e.message}`);
    }
  }
  return { regexes, errors };
}

/**
 * A rule matches when ANY of its patterns matches the relative path (OR).
 * Invalid patterns simply never match.
 */
function ruleMatches(rule, relPath) {
  if (!rule || !Array.isArray(rule.patterns)) return false;
  const target = normalizeRelPath(relPath);
  const { regexes } = compilePatterns(rule.patterns);
  return regexes.some((re) => re.test(target));
}

/**
 * Validate one raw rule object from settings.
 * Returns a list of problems (empty = usable apart from regex errors,
 * which compilePatterns reports separately).
 */
function validateRule(rule) {
  const problems = [];
  if (!rule || typeof rule !== 'object') {
    return ['rule is not an object'];
  }
  if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) {
    problems.push('patterns must be a non-empty array of regex strings');
  }
  if (typeof rule.snippetFile !== 'string' || rule.snippetFile.length === 0) {
    problems.push('snippetFile must be a non-empty string');
  }
  return problems;
}

/**
 * Strip JSONC comments (// and /* *\/) and trailing commas,
 * respecting string literals and escapes. Good enough for .code-snippets.
 */
function stripJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Parse a .code-snippets file body.
 * Returns an array of { name, prefixes, body, description, scope }
 * where prefixes/body are always arrays/strings respectively and
 * scope is an array of language ids (empty = all languages).
 * Throws on unparseable JSON so the caller can skip that file only.
 */
function parseSnippets(text) {
  const data = JSON.parse(stripJsonc(String(text)));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('snippet file must be a JSON object');
  }
  const snippets = [];
  for (const [name, def] of Object.entries(data)) {
    if (!def || typeof def !== 'object') continue;
    const prefixes = Array.isArray(def.prefix)
      ? def.prefix.filter((p) => typeof p === 'string' && p.length > 0)
      : typeof def.prefix === 'string' && def.prefix.length > 0
        ? [def.prefix]
        : [];
    if (prefixes.length === 0) continue;
    const body = Array.isArray(def.body)
      ? def.body.join('\n')
      : typeof def.body === 'string'
        ? def.body
        : '';
    const scope =
      typeof def.scope === 'string'
        ? def.scope.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    snippets.push({
      name,
      prefixes,
      body,
      description: typeof def.description === 'string' ? def.description : '',
      scope,
    });
  }
  return snippets;
}

/** A snippet with no scope applies to every language. */
function snippetAppliesToLanguage(snippet, languageId) {
  if (!snippet || !Array.isArray(snippet.scope) || snippet.scope.length === 0) {
    return true;
  }
  return snippet.scope.includes(languageId);
}

/**
 * Join a workspace folder path and a rule's relative snippetFile path.
 * Pure string join with `/` normalisation; the caller checks existence.
 * `..` segments are preserved (pointing outside the folder is allowed,
 * e.g. `../shared/common.code-snippets`).
 */
function joinSnippetPath(folderFsPath, snippetFile) {
  const base = String(folderFsPath).replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = normalizeRelPath(snippetFile);
  return `${base}/${rel}`;
}

module.exports = {
  normalizeRelPath,
  compilePatterns,
  ruleMatches,
  validateRule,
  stripJsonc,
  parseSnippets,
  snippetAppliesToLanguage,
  joinSnippetPath,
};

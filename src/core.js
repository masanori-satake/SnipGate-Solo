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

/** Patterns longer than this are rejected (path matching needs far less). */
const MAX_PATTERN_LENGTH = 512;

/**
 * Detect the classic catastrophic-backtracking shape: a group whose body
 * itself contains a quantifier, immediately quantified again — e.g.
 * `([a-z]+)+` or `(a*)*`. JavaScript regexes cannot be interrupted by a
 * timeout, and matching runs synchronously inside the shared Extension
 * Host, so such a pattern (reachable from workspace settings in a cloned
 * repository) could freeze every extension. This is a heuristic: it
 * rejects the practical attack shape while leaving ordinary path
 * patterns (`\.test\.ts$`, `^src/components/`, `(^|/)vite\.config\.ts$`,
 * `(a|b)+`) untouched.
 */
function hasNestedQuantifier(pattern) {
  const stack = []; // one entry per open group: does its body contain a quantifier?
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      stack.push(false);
      continue;
    }
    if (ch === ')') {
      const bodyHadQuantifier = stack.pop() || false;
      const next = pattern[i + 1];
      if (
        bodyHadQuantifier &&
        (next === '*' || next === '+' || next === '?' || next === '{')
      ) {
        return true;
      }
      continue;
    }
    if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      if (stack.length > 0) stack[stack.length - 1] = true;
    }
  }
  return false;
}

/**
 * Compile an array of pattern strings into RegExps.
 * Returns { regexes, errors } — invalid patterns are reported, never thrown,
 * so one bad rule cannot break the others. Overlong patterns and patterns
 * with nested quantifiers are rejected (reported like invalid regexes).
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
    if (pattern.length > MAX_PATTERN_LENGTH) {
      errors.push(
        `pattern rejected (longer than ${MAX_PATTERN_LENGTH} characters): "${pattern.slice(0, 40)}…"`,
      );
      continue;
    }
    if (hasNestedQuantifier(pattern)) {
      errors.push(
        `pattern rejected (nested quantifiers can stall matching): "${pattern}"`,
      );
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

/** Match pre-compiled regexes against a relative path (ANY match wins). */
function ruleMatchesCompiled(regexes, relPath) {
  const target = normalizeRelPath(relPath);
  return regexes.some((re) => re.test(target));
}

/**
 * A rule matches when ANY of its patterns matches the relative path (OR).
 * Invalid patterns simply never match.
 */
function ruleMatches(rule, relPath) {
  if (!rule || !Array.isArray(rule.patterns)) return false;
  const { regexes } = compilePatterns(rule.patterns);
  return ruleMatchesCompiled(regexes, relPath);
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
 * Trailing-comma removal happens inside the scanner: a comma outside a
 * string is remembered, and dropped only when the next significant token
 * is `}` or `]` — so `,]` / `,}` sequences inside string literals
 * (common in snippet bodies, e.g. `"arr = [1,];"`) survive untouched.
 */
function stripJsonc(text) {
  const out = [];
  let lastCommaAt = -1; // index in `out` of a comma awaiting its next token
  let i = 0;
  let inString = false;
  const pushSignificant = (ch) => {
    if ((ch === '}' || ch === ']') && lastCommaAt >= 0) {
      out.splice(lastCommaAt, 1); // it was a trailing comma after all
      lastCommaAt = -1;
    } else if (ch !== ',') {
      lastCommaAt = -1; // a real value followed: the comma was a separator
    }
    out.push(ch);
    if (ch === ',') lastCommaAt = out.length - 1;
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out.push(ch);
      if (ch === '\\' && next !== undefined) {
        out.push(next);
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      pushSignificant(ch);
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
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      out.push(ch);
      i += 1;
      continue;
    }
    pushSignificant(ch);
    i += 1;
  }
  return out.join('');
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
 * Join a workspace folder path and a rule's relative snippetFile path,
 * resolving `.` / `..` segments. Pointing outside the folder is allowed
 * (e.g. `../shared/common.code-snippets`); resolving the segments keeps
 * one canonical spelling per file, so the snippet cache key and the
 * file-watcher invalidation (which reports real paths) agree.
 */
function joinSnippetPath(folderFsPath, snippetFile) {
  const base = String(folderFsPath).replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = normalizeRelPath(snippetFile);
  const joined = `${base}/${rel}`;
  const isAbsolute = joined.startsWith('/');
  const parts = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return (isAbsolute ? '/' : '') + parts.join('/');
}

module.exports = {
  normalizeRelPath,
  compilePatterns,
  ruleMatches,
  ruleMatchesCompiled,
  hasNestedQuantifier,
  validateRule,
  stripJsonc,
  parseSnippets,
  snippetAppliesToLanguage,
  joinSnippetPath,
  MAX_PATTERN_LENGTH,
};

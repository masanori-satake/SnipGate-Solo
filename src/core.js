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

/** Upper bounds on settings size (see validateRule / the extension host):
 *  a hostile or accidental settings file must not make every completion
 *  request recompile and re-scan unbounded amounts of work. */
const MAX_RULES = 64;
const MAX_PATTERNS_PER_RULE = 16;
const MAX_TOTAL_SNIPPETS = 1024;

// ---------------------------------------------------------------------------
// Character sets for the overlap checks below, represented as
// { any, negated, ranges } where ranges is a sorted, merged list of
// inclusive [lo, hi] code-point pairs. `negated` means "every code point
// EXCEPT these ranges".
// ---------------------------------------------------------------------------

function makeRangeSet(ranges) {
  const sorted = ranges
    .filter(([lo, hi]) => lo <= hi)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return { any: false, negated: false, ranges: merged };
}

function makeAnySet() {
  return { any: true, negated: false, ranges: [] };
}

function makeNegatedSet(ranges) {
  const set = makeRangeSet(ranges);
  set.negated = true;
  return set;
}

function charSetOf(cp) {
  return makeRangeSet([[cp, cp]]);
}

function rangesOverlap(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i][0] <= b[j][1] && b[j][0] <= a[i][1]) return true;
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return false;
}

/** True when every code point of range list `a` is covered by list `b`. */
function rangesCover(a, b) {
  for (const [lo, hi] of a) {
    let cur = lo;
    for (const [blo, bhi] of b) {
      if (bhi < cur) continue;
      if (blo > cur) break;
      cur = Math.max(cur, bhi + 1);
      if (cur > hi) break;
    }
    if (cur <= hi) return false;
  }
  return true;
}

/** Range list `a` minus range list `b`. */
function rangesSubtract(a, b) {
  const out = [];
  for (const [lo, hi] of a) {
    let cur = lo;
    for (const [blo, bhi] of b) {
      if (bhi < cur) continue;
      if (blo > hi) break;
      if (blo > cur) out.push([cur, Math.min(hi, blo - 1)]);
      cur = Math.max(cur, bhi + 1);
      if (cur > hi) break;
    }
    if (cur <= hi) out.push([cur, hi]);
  }
  return out;
}

function rangesIntersect(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (lo <= hi) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return out;
}

function setsOverlap(a, b) {
  if (a.any || b.any) return true;
  if (!a.negated && !b.negated) return rangesOverlap(a.ranges, b.ranges);
  if (a.negated && b.negated) return true; // two co-finite sets always meet
  const pos = a.negated ? b : a;
  const neg = a.negated ? a : b;
  return !rangesCover(pos.ranges, neg.ranges);
}

function unionSets(a, b) {
  if (a.any || b.any) return makeAnySet();
  if (!a.negated && !b.negated) return makeRangeSet([...a.ranges, ...b.ranges]);
  if (a.negated && b.negated) {
    // ¬A ∪ ¬B = ¬(A ∩ B)
    const inter = rangesIntersect(a.ranges, b.ranges);
    return inter.length === 0 ? makeAnySet() : makeNegatedSet(inter);
  }
  // ¬A ∪ B = ¬(A \ B)
  const neg = a.negated ? a : b;
  const pos = a.negated ? b : a;
  const rest = rangesSubtract(neg.ranges, pos.ranges);
  return rest.length === 0 ? makeAnySet() : makeNegatedSet(rest);
}

const DIGIT_RANGES = [[0x30, 0x39]];
const WORD_RANGES = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]];
const SPACE_RANGES = [
  [0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680],
  [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f],
  [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff],
];

function escapeClassSet(ch) {
  switch (ch) {
    case 'd': return makeRangeSet(DIGIT_RANGES);
    case 'D': return makeNegatedSet(DIGIT_RANGES);
    case 'w': return makeRangeSet(WORD_RANGES);
    case 'W': return makeNegatedSet(WORD_RANGES);
    case 's': return makeRangeSet(SPACE_RANGES);
    case 'S': return makeNegatedSet(SPACE_RANGES);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// A forgiving regex parser producing atom trees (sequences of atoms, groups
// with alternation branches). It only needs to be accurate enough for the
// danger checks below — `new RegExp` remains the authority on validity and
// runs right after. Atom: { kind, set, ch, branches, lookaround, quant }
//   kind: 'char' | 'set' | 'group' | 'zero'
//   set:  character set the atom can consume
//   ch:   code point for kind 'char'
//   quant: { min, max } | null  (max may be Infinity)
// ---------------------------------------------------------------------------

function parsePatternAtoms(pattern) {
  let pos = 0;
  const len = pattern.length;

  function single(cp) {
    return { set: charSetOf(cp), ch: cp };
  }

  function parseEscape(inClass) {
    // pattern[pos] === '\\'
    pos += 1;
    if (pos >= len) return single(0x5c);
    const ch = pattern[pos];
    pos += 1;
    const cls = escapeClassSet(ch);
    if (cls) return { set: cls, ch: undefined };
    switch (ch) {
      case 'n': return single(0x0a);
      case 'r': return single(0x0d);
      case 't': return single(0x09);
      case 'f': return single(0x0c);
      case 'v': return single(0x0b);
      case '0': return single(0);
      case 'b': return inClass ? single(0x08) : { zero: true };
      case 'B': return inClass ? single(0x42) : { zero: true };
      case 'x': {
        const hex = pattern.slice(pos, pos + 2);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          pos += 2;
          return single(parseInt(hex, 16));
        }
        return single(0x78);
      }
      case 'u': {
        if (pattern[pos] === '{') {
          const end = pattern.indexOf('}', pos + 1);
          if (end !== -1) {
            const cp = parseInt(pattern.slice(pos + 1, end), 16);
            if (!Number.isNaN(cp) && cp <= 0x10ffff) {
              pos = end + 1;
              return single(cp);
            }
          }
          return single(0x75);
        }
        const hex = pattern.slice(pos, pos + 4);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          pos += 4;
          return single(parseInt(hex, 16));
        }
        return single(0x75);
      }
      case 'c': {
        if (pos < len && /[a-zA-Z]/.test(pattern[pos])) {
          const cp = pattern[pos].toUpperCase().charCodeAt(0) % 32;
          pos += 1;
          return single(cp);
        }
        return single(0x63);
      }
      case 'k':
        // \k<name> is a backreference; a bare \k is a literal 'k'.
        if (pattern[pos] === '<') return { set: makeAnySet(), ch: undefined };
        return single(0x6b);
      default: {
        if (ch >= '1' && ch <= '9') {
          // In a class this is an octal escape (approximated by its value);
          // outside, a backreference, which can re-match anything the
          // group matched — conservatively "any".
          if (inClass) return single(ch.charCodeAt(0) - 0x30);
          return { set: makeAnySet(), ch: undefined };
        }
        return single(ch.codePointAt(0));
      }
    }
  }

  function parseClass() {
    // pattern[pos] === '['
    pos += 1;
    let negated = false;
    if (pattern[pos] === '^') {
      negated = true;
      pos += 1;
    }
    let result = makeRangeSet([]);
    // In JavaScript a ']' immediately after '[' or '[^' closes the class.
    if (pattern[pos] === ']') {
      pos += 1;
      return negated ? makeNegatedSet([]) : result;
    }
    while (pos < len && pattern[pos] !== ']') {
      let lo;
      if (pattern[pos] === '\\') {
        const esc = parseEscape(true);
        if (esc.ch === undefined) {
          result = unionSets(result, esc.set);
          continue;
        }
        lo = esc.ch;
      } else {
        lo = pattern.codePointAt(pos);
        pos += lo > 0xffff ? 2 : 1;
      }
      if (pattern[pos] === '-' && pos + 1 < len && pattern[pos + 1] !== ']') {
        pos += 1; // consume '-'
        let hi;
        if (pattern[pos] === '\\') {
          const esc = parseEscape(true);
          hi = esc.ch;
          if (hi === undefined) {
            // e.g. [a-\d]: an invalid regex; approximate and move on.
            result = unionSets(result, charSetOf(lo));
            result = unionSets(result, charSetOf(0x2d));
            continue;
          }
        } else {
          hi = pattern.codePointAt(pos);
          pos += hi > 0xffff ? 2 : 1;
        }
        result = unionSets(result, makeRangeSet([[lo, hi]]));
      } else {
        result = unionSets(result, charSetOf(lo));
      }
    }
    if (pattern[pos] === ']') pos += 1;
    if (!negated) return result;
    if (result.any) return makeRangeSet([]);
    if (result.negated) return makeRangeSet(result.ranges);
    return makeNegatedSet(result.ranges);
  }

  function parseQuantifier() {
    const ch = pattern[pos];
    let quant = null;
    if (ch === '*') {
      quant = { min: 0, max: Infinity };
      pos += 1;
    } else if (ch === '+') {
      quant = { min: 1, max: Infinity };
      pos += 1;
    } else if (ch === '?') {
      quant = { min: 0, max: 1 };
      pos += 1;
    } else if (ch === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(pos, pos + 24));
      if (m) {
        const min = parseInt(m[1], 10);
        let max;
        if (m[2] === undefined) max = min;
        else if (m[2] === '') max = Infinity;
        else max = parseInt(m[2], 10);
        quant = { min, max };
        pos += m[0].length;
      }
      // Not a valid quantifier shape: '{' is a literal in JS regexes.
    }
    if (quant && pattern[pos] === '?') pos += 1; // lazy marker
    return quant;
  }

  function parseAtom() {
    const ch = pattern[pos];
    if (ch === '(') {
      pos += 1;
      let lookaround = false;
      if (pattern[pos] === '?') {
        const kind = pattern[pos + 1];
        if (kind === ':') {
          pos += 2;
        } else if (kind === '=' || kind === '!') {
          lookaround = true;
          pos += 2;
        } else if (kind === '<') {
          const dir = pattern[pos + 2];
          if (dir === '=' || dir === '!') {
            lookaround = true;
            pos += 3;
          } else {
            // Named capture group (?<name>...)
            const end = pattern.indexOf('>', pos + 2);
            pos = end === -1 ? len : end + 1;
          }
        }
        // Any other '(?' prefix is an invalid regex; parse on as a group.
      }
      const branches = parseBranches();
      if (pattern[pos] === ')') pos += 1;
      const atom = { kind: 'group', branches, lookaround, set: null, ch: undefined, quant: null };
      atom.quant = parseQuantifier();
      return atom;
    }
    if (ch === '[') {
      const atom = { kind: 'set', set: parseClass(), ch: undefined, quant: null };
      atom.quant = parseQuantifier();
      return atom;
    }
    if (ch === '.') {
      pos += 1;
      const atom = { kind: 'set', set: makeAnySet(), ch: undefined, quant: null };
      atom.quant = parseQuantifier();
      return atom;
    }
    if (ch === '\\') {
      const esc = parseEscape(false);
      if (esc.zero) return { kind: 'zero', quant: null };
      const atom = {
        kind: esc.ch !== undefined ? 'char' : 'set',
        set: esc.set,
        ch: esc.ch,
        quant: null,
      };
      atom.quant = parseQuantifier();
      return atom;
    }
    if (ch === '^' || ch === '$') {
      pos += 1;
      return { kind: 'zero', quant: null };
    }
    const cp = pattern.codePointAt(pos);
    pos += cp > 0xffff ? 2 : 1;
    const atom = { kind: 'char', set: charSetOf(cp), ch: cp, quant: null };
    atom.quant = parseQuantifier();
    return atom;
  }

  function parseBranches() {
    const branches = [[]];
    while (pos < len && pattern[pos] !== ')') {
      if (pattern[pos] === '|') {
        branches.push([]);
        pos += 1;
        continue;
      }
      branches[branches.length - 1].push(parseAtom());
    }
    return branches;
  }

  return parseBranches();
}

/** The set of characters an atom can consume anywhere in its match. */
function atomConsumableSet(atom) {
  if (atom.kind === 'zero' || atom.lookaround) return null;
  if (atom.kind === 'group') {
    let result = makeRangeSet([]);
    for (const branch of atom.branches) {
      for (const child of branch) {
        const s = atomConsumableSet(child);
        if (s) result = unionSets(result, s);
      }
    }
    return result;
  }
  return atom.set;
}

function atomCanMatchEmpty(atom) {
  if (atom.kind === 'zero') return true;
  if (atom.quant && atom.quant.min === 0) return true;
  if (atom.kind === 'group' && !atom.lookaround) {
    return atom.branches.some((b) => b.every((a) => atomCanMatchEmpty(a)));
  }
  return false;
}

/** The set of characters a sequence can consume as its first character. */
function sequenceFirstSet(seq) {
  let result = null;
  for (const atom of seq) {
    let s = null;
    if (atom.kind === 'group' && !atom.lookaround) {
      for (const branch of atom.branches) {
        const bs = sequenceFirstSet(branch);
        if (bs) s = s ? unionSets(s, bs) : bs;
      }
    } else if (atom.kind !== 'zero' && !atom.lookaround) {
      s = atom.set;
    }
    if (s) result = result ? unionSets(result, s) : s;
    if (!atomCanMatchEmpty(atom)) break;
  }
  return result;
}

/** Leading run of unquantified literal characters of a sequence. */
function sequenceLiteralPrefix(seq) {
  let out = '';
  for (const atom of seq) {
    if (atom.kind !== 'char' || atom.quant) break;
    out += String.fromCodePoint(atom.ch);
  }
  return out;
}

function isVariableQuantifier(atom) {
  return !!atom.quant && atom.quant.max > atom.quant.min;
}

function isRepeatingQuantifier(atom) {
  return !!atom.quant && atom.quant.max >= 2;
}

function checkSequence(seq, insideRepeatedGroup) {
  let prev = null;
  for (const atom of seq) {
    if (atom.kind === 'group') {
      const reason = checkGroup(atom, insideRepeatedGroup);
      if (reason) return reason;
    }
    if (atom.kind === 'zero' || atom.lookaround) continue;
    if (prev && isVariableQuantifier(prev) && isVariableQuantifier(atom)) {
      const a = atomConsumableSet(prev);
      const b = atomConsumableSet(atom);
      if (a && b && setsOverlap(a, b)) {
        return 'adjacent quantified atoms can match overlapping characters';
      }
    }
    prev = atom;
  }
  return null;
}

function checkGroup(atom, insideRepeatedGroup) {
  const repeated = insideRepeatedGroup || isRepeatingQuantifier(atom);
  if (!atom.lookaround && repeated && atom.branches.length > 1) {
    for (let i = 0; i < atom.branches.length; i += 1) {
      for (let j = i + 1; j < atom.branches.length; j += 1) {
        const fi = sequenceFirstSet(atom.branches[i]);
        const fj = sequenceFirstSet(atom.branches[j]);
        if (fi && fj && setsOverlap(fi, fj)) {
          return 'a quantified group has alternation branches that can match overlapping characters';
        }
        const pi = sequenceLiteralPrefix(atom.branches[i]);
        const pj = sequenceLiteralPrefix(atom.branches[j]);
        if (pi && pj && (pi.startsWith(pj) || pj.startsWith(pi))) {
          return 'a quantified group has alternation branches where one is a prefix of another';
        }
      }
    }
  }
  const childContext = insideRepeatedGroup || isRepeatingQuantifier(atom);
  for (const branch of atom.branches) {
    const reason = checkSequence(branch, childContext);
    if (reason) return reason;
  }
  return null;
}

/**
 * Detect catastrophic-backtracking shapes that `hasNestedQuantifier`
 * misses, proven to stall the shared Extension Host for seconds:
 * - two adjacent quantified atoms that can match overlapping character
 *   sets (`a*a*a*a*b`, `[a-z]*[a-z]*[a-z]*$`, `.*.*.*.*b`): the engine
 *   can partition the input between them in exponentially many ways;
 * - a quantified group whose alternation branches can start with the
 *   same character, or where one branch is a prefix of another
 *   (`(a|aa)+$`, `(x|x)+$`): each repetition can re-split the input.
 * Returns a short reason string, or null when no such shape is found.
 * This is a heuristic, like `hasNestedQuantifier`: it rejects the
 * practical attack shapes while leaving ordinary path patterns
 * (`\.test\.ts$`, `(a|b)+`, `(\.test|\.spec)\.ts$`, `\d{4}-\d{2}`) alone.
 */
function dangerousQuantifierReason(pattern) {
  try {
    const branches = parsePatternAtoms(pattern);
    for (const branch of branches) {
      const reason = checkSequence(branch, false);
      if (reason) return reason;
    }
  } catch {
    return null; // the parser is best-effort; RegExp validation follows
  }
  return null;
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
    const risk = dangerousQuantifierReason(pattern);
    if (risk) {
      errors.push(
        `pattern rejected (${risk}; catastrophic backtracking risk): "${pattern}"`,
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
  if (Array.isArray(rule.patterns) && rule.patterns.length > MAX_PATTERNS_PER_RULE) {
    problems.push(`patterns must contain at most ${MAX_PATTERNS_PER_RULE} entries`);
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

/**
 * True when `childFsPath` is `parentFsPath` itself or lives under it.
 * Both sides are compared with `/` separators. Used to surface rules
 * whose snippetFile resolves outside the workspace folder: leaving the
 * folder is an intentional feature (`../shared/common.code-snippets`),
 * but it should never happen silently.
 */
function isInsidePath(parentFsPath, childFsPath) {
  const parent = String(parentFsPath).replace(/\\/g, '/').replace(/\/+$/, '');
  const child = String(childFsPath).replace(/\\/g, '/');
  return child === parent || child.startsWith(`${parent}/`);
}

module.exports = {
  normalizeRelPath,
  compilePatterns,
  ruleMatches,
  ruleMatchesCompiled,
  hasNestedQuantifier,
  dangerousQuantifierReason,
  validateRule,
  stripJsonc,
  parseSnippets,
  snippetAppliesToLanguage,
  joinSnippetPath,
  isInsidePath,
  MAX_PATTERN_LENGTH,
  MAX_RULES,
  MAX_PATTERNS_PER_RULE,
  MAX_TOTAL_SNIPPETS,
};

#!/usr/bin/env node
// Does compileRegex() reject a regex that would freeze the tab, without rejecting a real one?
//
//   node tools/regex-safety.mjs [path/to/index.js]
//
// Several settings are regex sources the user types or pastes. compileRegex used to check only
// SYNTAX, but a syntactically perfect pattern with nested quantifiers backtracks exponentially:
// "(a+)+$" takes over 30 seconds on a 29-character string. These regexes run against every message,
// so such a pattern freezes SillyTavern with no error and nothing to explain it.
//
// The guard times one probe built to trigger that blow-up. This checks both halves of the bargain:
// every pathological pattern must be caught, and every regex the extension actually ships must not
// be — a guard that rejects a real pattern silently disables a feature, which is worse than the bug.
//
// The function is LIFTED from index.js rather than reimplemented, so this cannot drift from what
// ships. If the probe or the limit is retuned, rerun this.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(process.argv[2] || join(root, 'index.js'), 'utf8');

const m = /\/\*\* Compile \(and cache\) a regex source[\s\S]*?\n    \}/.exec(src);
if (!m) { console.error('compileRegex not found in index.js'); process.exit(2); }
const rejected = [];
const compileRegex = eval(
  '(function(){ const regexCache = new Map(); const LOG = "[sd]";'
  + ' const console = { error: (...a) => __rejected.push(a.join(" ")) };'
  + m[0] + '; return compileRegex; })()'.replace('__rejected', 'globalThis.__rejected'));
globalThis.__rejected = rejected;

// Patterns that backtrack exponentially. All must come back null.
const EVIL = ['(a+)+$', '(a|a)+$', '([a-z]+)*$', '(a*)*$', '(\\w+\\s?)*$', '(a+)+b', '([^!]+)*!x',
    // 24 Sep: all of the above are letter-based, so a letters-only probe looked like enough.
    // These target other character classes and slipped straight through it.
    '(\\d+)+$', '(\\s+|\\t+)+$', '(x+x+)+y', '(\\d+\\s?)*$'];
// Every regex source the extension ships: the settings defaults and the big runtime-built tables.
const REAL = [];
const setRe = /^\s+(\w*[Rr]egex\w*): '((?:[^'\\]|\\.)*)'/gm;
let s;
// Several settings default to an empty string, for which compileRegex returns null by design.
// Including them here would report that correct behaviour as a rejected pattern.
while ((s = setRe.exec(src)) !== null) { const v = s[2].replace(/\\\\/g, '\\'); if (v) REAL.push([s[1], v]); }
for (const name of ['DEFAULT_ARRIVAL', 'DEFAULT_ABSENCE', 'DEFAULT_DEPART', 'DEFAULT_ACTION', 'DEFAULT_MEMORY']) {
  const mm = new RegExp("const " + name + " = '((?:[^'\\\\]|\\\\.)*)'").exec(src);
  if (mm) REAL.push([name, mm[1].replace(/\\\\/g, '\\')]);
}

let fails = 0;
console.log('catastrophic patterns — must be rejected (null):');
for (const p of EVIL) {
  const t0 = Date.now();
  const got = compileRegex(p);
  const ms = Date.now() - t0;
  const ok = got === null;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${String(ms).padStart(6)}ms  ${p}`);
}
console.log(`\nregexes the extension ships — must all compile (${REAL.length}):`);
let slowest = 0, slowestName = '';
for (const [name, p] of REAL) {
  const t0 = Date.now();
  const got = compileRegex(p);
  const ms = Date.now() - t0;
  if (ms > slowest) { slowest = ms; slowestName = name; }
  if (got === null) { fails++; console.log(`  FAIL  rejected a real pattern: ${name}`); }
}
console.log(`  all ${REAL.length} compiled; slowest probe ${slowest}ms (${slowestName})`);
// A syntax error must still be caught, and must not be confused with a slow one.
if (compileRegex('(unclosed') !== null) { fails++; console.log('\nFAIL  a syntax error was not rejected'); }
if (compileRegex('') !== null) { fails++; console.log('FAIL  an empty source should be null'); }
console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

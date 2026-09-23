#!/usr/bin/env node
// Does migrateSettings repair a corrupted settings object, or leave a landmine?
//
//   node tools/settings-repair.mjs [path/to/index.js]
//
// 24 call sites read .find/.filter/.map/.forEach off `cast` and `places`, and most of them then
// read a property straight off each element. So a non-array, or a single null inside the list,
// takes out the settings panel and background selection with a TypeError and no way back.
//
// migrateSettings runs on every load and is the only place that can fix settings that were already
// stored badly — the import type check only stops NEW ones arriving. It used to repair `places` to
// an array unconditionally but touch `cast` only when it already was one, and neither dropped a
// stray null from inside the list.
//
// The function is LIFTED from index.js rather than reimplemented, so this cannot drift from what
// ships. The last check in each case is the one that matters: can the real call sites actually run?
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2] || '/home/ryzendigo/scene-director/index.js', 'utf8');
const m = /function migrateSettings\(s\) \{[\s\S]*?\n    \}/.exec(src);
if (!m) { console.error('migrateSettings not found'); process.exit(2); }
// It references defaultSettings, prettyNameFromPattern and LOG; stub what it needs.
const migrate = eval(
  '(function(){ const LOG = "[sd]"; const defaultSettings = { chipSize: 28 };'
  + ' function prettyNameFromPattern(p){ return String(p || ""); }'
  + ' const console = { error: function(){} };'
  + m[0] + '; return migrateSettings; })()');

const CASES = [
  ['cast is null', { cast: null, places: [] }],
  ['cast is an object', { cast: {}, places: [] }],
  ['cast is a number', { cast: 42, places: [] }],
  ['cast is a string', { cast: 'x', places: [] }],
  ['places is null', { cast: [], places: null }],
  ['places is a string', { cast: [], places: 'x' }],
  ['cast holds a null', { cast: [null, { key: 'a' }], places: [] }],
  ['places holds a null', { cast: [], places: [null, { pattern: 'p' }] }],
  ['both hold scalars', { cast: [1, 'two', { key: 'a' }], places: ['x', { pattern: 'p' }] }],
  ['already clean', { cast: [{ key: 'a' }], places: [{ pattern: 'p' }] }],
  // 23 Sep: keys were a bare slugify(label) with no uniqueness check, so two members added without
  // renaming the first both got 'new-member'. Every lookup is cast.find(m => m.key === k), so the
  // second was unreachable and the presence Map merged them into one chip. The FIRST keeps its key
  // — sprite folders and per-member settings are named after it.
  ['duplicate keys', { cast: [{ key: 'new-member', label: 'A' }, { key: 'new-member', label: 'B' }], places: [] }],
  ['triple duplicate', { cast: [{ key: 'm' }, { key: 'm' }, { key: 'm' }], places: [] }],
  ['missing key', { cast: [{ label: 'no key' }, { label: 'also none' }], places: [] }],
];
let fails = 0;
for (const [name, s] of CASES) {
  migrate(s);
  const problems = [];
  if (!Array.isArray(s.cast)) problems.push('cast is not an array');
  if (!Array.isArray(s.places)) problems.push('places is not an array');
  if (Array.isArray(s.cast) && s.cast.some(x => !x || typeof x !== 'object')) problems.push('cast holds a non-object');
  if (Array.isArray(s.places) && s.places.some(x => !x || typeof x !== 'object')) problems.push('places holds a non-object');
  if (Array.isArray(s.cast)) {
    const keys = s.cast.map(x => x && x.key);
    if (new Set(keys).size !== keys.length) problems.push('cast has duplicate keys: ' + JSON.stringify(keys));
    if (keys.some(k => !k)) problems.push('cast has an empty key');
  }
  // The real test: can the call sites actually run?
  try { s.cast.find(x => x.key === 'z'); s.cast.map(x => x.colorHex); s.places.forEach(p => p.slots); }
  catch (e) { problems.push('a call site THREW: ' + String(e).slice(0, 44)); }
  if (problems.length) fails++;
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${name.padEnd(20)} cast=${JSON.stringify(s.cast).slice(0, 26)} places=${JSON.stringify(s.places).slice(0, 22)}${problems.length ? '  <- ' + problems.join('; ') : ''}`);
}
console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

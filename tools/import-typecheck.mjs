// The settings Import button bypasses every validator — the panel runs validators[key],
// import does not. Its only guard is a type check against the default's shape, so that
// check is the whole defence for a hand-edited or truncated export.
//
//   node tools/import-typecheck.mjs [path/to/index.js]
//
// The check is LIFTED from index.js (the two `want`/`got` lines) rather than
// reimplemented, so this cannot drift from what ships.
//
// It shipped with a `typeof null === 'object'` hole: importing {"moodEmoji": null}
// was ACCEPTED because the default is a plain object. getSettings() only backfills
// `undefined`, so the null then survived every reload and silently disabled mood
// emoji — exactly the failure the check's own comment says it exists to stop.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const block = /const skipped = \[\];[\s\S]*?skipped\.push/.exec(src);
if (!block) { console.error('import loop not found in ' + file); process.exit(2); }
const wantLine = /const want = ([^;]+);/.exec(block[0]);
const gotLine = /const got = ([^;]+);/.exec(block[0]);
if (!wantLine || !gotLine) { console.error('import type check not found in ' + file); process.exit(2); }
const accepts = eval(`(function (def, val) {
  const parsed = { k: val }, key = 'k';
  const want = ${wantLine[1]};
  const got = ${gotLine[1]};
  return want === 'any' || want === got;
})`);

// Every default shape, paired with values that must and must not be accepted.
const CASES = [
  // [name, default, value, shouldAccept]
  ['object default, null',        {},        null,       false],
  ['object default, object',      {},        { a: 'x' },  true],
  ['object default, array',       {},        [],         false],
  ['object default, string',      {},        'x',        false],
  ['array default, null',         [],        null,       false],
  ['array default, array',        [],        [1],         true],
  ['array default, object',       [],        {},         false],
  ['string default, null',        'x',       null,       false],
  ['string default, string',      'x',       'y',         true],
  ['number default, null',        1,         null,       false],
  ['number default, number',      1,         2,           true],
  ['number default, string',      1,         '2',        false],
  ['boolean default, null',       true,      null,       false],
  ['boolean default, boolean',    true,      false,       true],
  ['boolean default, number',     true,      1,          false],
  // `null` is the "unset" marker for these, so anything goes — including null.
  ['null default, null',          null,      null,        true],
  ['null default, array',         null,      [['a', 'b']], true],
  ['null default, object',        null,      {},          true],
  ['null default, string',        null,      'x',         true],
];

let bad = 0;
for (const [name, def, val, should] of CASES) {
  const got = accepts(def, val);
  if (got !== should) { bad++; console.log(`FAIL ${name}: ${got ? 'accepted' : 'skipped'}, expected ${should ? 'accepted' : 'skipped'}`); }
}

// Nothing in defaultSettings may be `undefined`: the import loop skips those keys
// outright, so such a key could never be imported at all.
const dm = /const defaultSettings = \{([\s\S]*?)\n    \};/.exec(src);
if (dm && /:\s*undefined\s*,/.test(dm[1])) { bad++; console.log('FAIL a default is `undefined` — import can never set that key'); }

if (bad) { console.log(`\n${bad} case(s) failed`); process.exit(1); }
console.log(`import type check correct for all ${CASES.length} default/value shapes`);

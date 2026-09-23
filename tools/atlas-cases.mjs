#!/usr/bin/env node
// Case-based regression suite for the pure AtlasEngine helpers in index.js.
//
// The atlas shipped in 0.9.15 with three bugs that only a browser found. Two of them live in these
// two pure functions, so they belong under a suite like every other engine.
//
//   node tools/atlas-cases.mjs                 # run the case set
//   node tools/atlas-cases.mjs "2026-9-23"     # format one key
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.js'), 'utf8');
const begin = src.indexOf('// === ATLAS ENGINE (pure) BEGIN ===');
const end = src.indexOf('// === ATLAS ENGINE (pure) END ===');
if (begin < 0 || end < 0) { console.error('engine markers not found in index.js'); process.exit(2); }
const block = src.slice(begin, end).replace('// === ATLAS ENGINE (pure) BEGIN ===', '');
const A = eval('(function(){' + block.replace(/^\s*const AtlasEngine = /m, 'return ') + '})()');

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = k => A.prettyDate(k, DAY, MON);

const DATE_CASES = [
  { k: '2026-9-23', want: 'Wed Sep 23 2026' },
  { k: '2026-1-1', want: 'Thu Jan 1 2026' },
  { k: '2025-12-31', want: 'Wed Dec 31 2025' },
  // new Date(2026, 12, 99) is NOT an Invalid Date — it rolls into the next year — so isNaN alone
  // let this through and the label read "Fri undefined 99 2026".
  { k: '2026-13-99', want: '2026-13-99' },
  // 31 Feb rolls to 3 Mar; the label must never contradict the key it came from.
  { k: '2026-2-31', want: '2026-2-31' },
  { k: '2026-0-5', want: '2026-0-5' },
  { k: 'not-a-date', want: 'not-a-date' },
  { k: '', want: '' },
];

// Keys carry no zero padding, so a plain string sort puts month 10 before month 8. The modal
// listed August between two Septembers until this was sorted numerically.
const SORT_CASES = [
  { keys: ['2026-9-22', '2026-8-11', '2026-10-1', '2025-12-31'],
    want: ['2025-12-31', '2026-8-11', '2026-9-22', '2026-10-1'] },
  { keys: ['2026-1-2', '2026-1-10', '2026-1-1'],
    want: ['2026-1-1', '2026-1-2', '2026-1-10'] },
];

const one = process.argv[2];
if (one) { console.log(pretty(one)); process.exit(0); }

let fails = 0;
for (const c of DATE_CASES) {
  const got = pretty(c.k);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(16)} want ${c.want.padEnd(16)} ${c.k || '(empty)'}`);
}
for (const c of SORT_CASES) {
  const got = c.keys.slice().sort((a, b) => A.keyOrder(a) - A.keyOrder(b));
  const ok = JSON.stringify(got) === JSON.stringify(c.want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  sort ${got.join(' ')}`);
}
const total = DATE_CASES.length + SORT_CASES.length;
console.log(fails ? `\n${fails} failing` : `\nall ${total} pass`);
process.exit(fails ? 1 : 0);

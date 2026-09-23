// The caller filters the background verdict a second time: change only when the winner
// differs AND (the 📍 changed OR the score is >= 8 OR there is no current background).
// That lives in onMessage, not in the engine, so no engine suite can reach it.
//
// Measured on the real corpus: 250 of 253 changes are allowed by the "location changed"
// arm, the ">= 8" arm never fires at all (no change scores above 7.01), and the whole
// filter suppresses 2. It is nearly inert in practice — which is worth knowing, because
// it means the background follows the header and essentially nothing else.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC_OVERRIDE = (process.argv.find((a) => a.startsWith('--src=')) || '').slice(6) || null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(SRC_OVERRIDE || join(root, 'index.js'), 'utf8');

// Lift the real condition so this cannot drift from the shipped one.
const m = /const locChangedBg = location !== lastBgLoc;\s*\n\s*if \(v\.file !== lastBg && \(([^)]*)\)\)/.exec(src);
if (!m) { console.log('FAIL  could not find the background hysteresis in onMessage'); process.exit(1); }
const COND = m[1];
const allow = new Function('locChangedBg', 'v', 'lastBg', 'return (' + COND + ');');

// lastBgLoc is assigned UNCONDITIONALLY after a verdict, including the empty string when
// a message carries no header — so two consecutive headerless messages do NOT both count
// as "the location changed". Modelling that wrongly inflates headerless changes 3 -> 23.
function step(state, loc, file, score) {
  const locChangedBg = loc !== state.lastBgLoc;
  let changed = false;
  if (file && file !== state.lastBg && allow(locChangedBg, { score }, state.lastBg)) {
    state.lastBg = file; changed = true;
  }
  if (file) state.lastBgLoc = loc;
  return changed;
}
let fails = 0;
const CASES = [
  { label: 'first background always applies',
    steps: [['the kitchen', 'generic-kitchen.jpg', 4]], want: [true] },
  { label: 'same location, weak score: held',
    steps: [['the kitchen', 'generic-kitchen.jpg', 4], ['the kitchen', 'generic-porch.jpg', 4]],
    want: [true, false] },
  { label: 'same location, decisive score: changes',
    steps: [['the kitchen', 'generic-kitchen.jpg', 4], ['the kitchen', 'generic-porch.jpg', 8]],
    want: [true, true] },
  { label: 'location changed: changes on a weak score',
    steps: [['the kitchen', 'generic-kitchen.jpg', 4], ['the porch', 'generic-porch.jpg', 4]],
    want: [true, true] },
  { label: 'same file is never re-applied',
    steps: [['the kitchen', 'generic-kitchen.jpg', 4], ['the porch', 'generic-kitchen.jpg', 9]],
    want: [true, false] },
  { label: 'two headerless messages are not two changes',
    steps: [['', 'generic-kitchen.jpg', 3], ['', 'generic-porch.jpg', 3]], want: [true, false] },
];
for (const c of CASES) {
  const state = { lastBg: null, lastBgLoc: null };
  const got = c.steps.map(([loc, file, score]) => step(state, loc, file, score));
  const ok = JSON.stringify(got) === JSON.stringify(c.want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(got).padEnd(16)} want ${JSON.stringify(c.want).padEnd(16)} ${c.label}`);
}
console.log(`\ncondition: ${COND.trim()}`);
console.log(fails ? `${fails} failing` : `all ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

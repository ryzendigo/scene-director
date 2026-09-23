#!/usr/bin/env node
// Standalone test harness for the pure PresenceEngine block in index.js.
//
// Presence decides which cast chips appear, and the failures are the visible kind: a character
// shown in a room they are not in, or missing from one they are in. The engine is delimited by
// "=== PRESENCE ENGINE (pure) BEGIN/END ===" and has no DOM or SillyTavern dependencies, so it
// can be lifted out and run directly, in milliseconds rather than a browser round-trip.
//
//   node tools/presence-cases.mjs            # run the case set
//   node tools/presence-cases.mjs "Beth came in."   # try one message
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.js'), 'utf8');
const begin = src.indexOf('// === PRESENCE ENGINE (pure) BEGIN ===');
const end = src.indexOf('// === PRESENCE ENGINE (pure) END ===');
if (begin < 0 || end < 0) { console.error('engine markers not found in index.js'); process.exit(2); }
const block = src.slice(begin, end).replace('// === PRESENCE ENGINE (pure) BEGIN ===', '');
const P = eval('(function(){' + block.replace(/^\s*const PresenceEngine = /m, 'return ') + '})()');

const TABLES = P.compileTables();
const MEMBER = { key: 'beth', name: 'Beth', nameRe: /\bBeth\b/i, hex: '#c77', female: true };
const shown = t => P.evaluate(P.mask(t), MEMBER, { tables: TABLES }).present;

const CASES = [
  // Narration is the only thing that can carry presence.
  { t: 'Beth came in and sat down.', want: true },
  { t: 'Beth was in the kitchen. She pours the tea.', want: true },
  // Two distinct actions corroborate each other and clear the bar of 4. Before 23 Sep only the
  // FIRST action verb was ever counted, so any number of actions scored the same as one nod.
  { t: 'Beth poured the tea and passed him a cup.', want: true },
  { t: 'Beth laughed and reached for the pot.', want: true },
  // Past tense must score like present tense: most RP prose is past tense, and a dozen verbs in the
  // default action table had no -ed form at all until 23 Sep.
  { t: 'Beth shrugged and folded her arms.', want: true },
  { t: 'Beth sighed and picked up her cup.', want: true },
  { t: 'Beth shook her head and pointed at the door.', want: true },
  // A single action stays below the bar on purpose: narration describes absent people acting too.
  { t: 'Beth nodded.', want: false },
  // A name inside someone else's speech is a mention, never presence.
  { t: '"Beth is coming over later," she said.', want: false },
  { t: '"Have you seen Beth?" he asked.', want: false },
  // Explicit absence and departure veto outright.
  { t: 'Beth was not there.', want: false },
  { t: 'There was no sign of Beth.', want: false },
  { t: 'Beth had left an hour ago.', want: false },
  // Neither a thought, a hypothetical, nor a possession puts anyone in the room.
  { t: 'She thought about Beth for a while.', want: false },
  { t: 'He wondered whether Beth would come.', want: false },
  { t: 'Beth’s coat was on the hook.', want: false },
];

const one = process.argv[2];
if (one) { console.log(shown(one) ? 'SHOWN' : 'hidden'); process.exit(0); }

let fails = 0;
for (const c of CASES) {
  const got = shown(c.t);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${(got ? 'SHOWN' : 'hidden').padEnd(8)} want ${(c.want ? 'SHOWN' : 'hidden').padEnd(8)} ${c.t}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

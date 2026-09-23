#!/usr/bin/env node
// Standalone test harness for the pure WardrobeEngine block in index.js.
//
// The engine is delimited by "=== WARDROBE ENGINE (pure) BEGIN/END ===" and has no DOM or
// SillyTavern dependencies, so it can be lifted out and exercised directly. A browser round-trip
// per attempt is minutes; this is milliseconds, which is the difference between diagnosing a
// matcher bug and guessing at one.
//
//   node tools/wardrobe-harness.mjs            # run the case set
//   node tools/wardrobe-harness.mjs "She puts her coat on."   # try one sentence
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.js'), 'utf8');
const begin = src.indexOf('// === WARDROBE ENGINE (pure) BEGIN ===');
const end = src.indexOf('// === WARDROBE ENGINE (pure) END ===');
if (begin < 0 || end < 0) { console.error('engine markers not found in index.js'); process.exit(2); }
const block = src.slice(begin, end).replace('// === WARDROBE ENGINE (pure) BEGIN ===', '');
const WardrobeEngine = eval('(function(){' + block.replace(/^\s*const WardrobeEngine = /m, 'return ') + '})()');

const OPTS = { at: 1, mainRe: /\bElise\b/i, userRe: /\bRyan\b/i, otherFemale: false, userIsMale: true, speaker: 'main' };
function wornAfter(sentences) {
  const state = {};
  for (const s of sentences) WardrobeEngine.scan(s, [], state, OPTS);
  const all = [];
  for (const k of Object.keys(state)) for (const g of Object.keys(state[k])) all.push(g);
  return all.sort();
}

const CASES = [
  { t: 'She comes down in a green cotton dress.', want: ['green cotton dress'] },
  { t: 'She puts her coat on.', want: ['coat'] },                    // possessive + trailing particle
  { t: 'She puts on her coat.', want: ['coat'] },
  { t: 'She puts on the coat.', want: ['coat'] },
  { t: 'She takes off her coat and hangs it up.', want: [] },
  { t: 'He takes his boots off at the door.', want: [] },
  { t: 'She pulls on her boots and takes off her hat.', want: ['boots'] },
  { t: 'She is wearing a blue cotton nightgown.', want: ['blue cotton nightgown'] },
  { t: 'She changes into her summer dress.', want: ['summer dress'] },
  { t: 'She remembered the red dress she wore that year.', want: [] },   // memory, ignored
  // The dress comes off and the coat goes on, so only the coat is still worn. Before 23 Sep this
  // asserted ['blue coat','green dress']: the ON pass re-added the dress it had just removed.
  { t: 'She pulls the green dress off over her head and puts her blue coat on.', want: ['blue coat'] },
  // Fixed 23 Sep: a direction-neutral verb ("pulls", "tugs") with no removal particle is a put-on,
  // not a removal. OFF used to claim these first, so the garment was lost entirely.
  { t: 'He pulls his clean shirt on.', want: ['clean shirt'] },
  { t: 'She pulls her boots on.', want: ['boots'] },
  { t: 'She tugs the jumper on over her head.', want: ['jumper'] },
  // ...and the removals those same verbs DO make must still register:
  { t: 'She pulls her jumper off.', want: [] },
  { t: 'She steps out of her dress.', want: [] },
  { t: 'She unbuttons her blouse.', want: [] },      // unambiguous verb, no particle, still a removal
  // "and into <garment>" has no verb of its own: the only verb belongs to the OFF clause before it.
  { t: 'She slips out of her dress and into her nightgown.', want: ['nightgown'] },
  // ...but it must stay a garment matcher, not a movement one:
  { t: 'She got out of the car and into the house.', want: [] },
  { t: 'She walked into the kitchen.', want: [] },
  // Things that go "on" but are not worn:
  { t: 'She puts the kettle on.', want: [] },
  { t: 'She turns the light on.', want: [] },
  // Known limits, asserted so they are visible rather than forgotten:
  // A bare pronoun + non-possessive article ("a clean shirt", not "his") has no traceable owner,
  // so ownerOf drops it. With a possessive or a name it resolves — see the three cases above.
  { t: 'He pulls a clean shirt on.', want: [] },
  { t: 'She shrugs her cardigan on over the tank top.', want: ['cardigan'] },  // only the first garment in a clause
];

const one = process.argv[2];
if (one) { console.log(JSON.stringify(wornAfter([one]))); process.exit(0); }

let fails = 0;
for (const c of CASES) {
  const got = wornAfter([c.t]);
  const ok = JSON.stringify(got) === JSON.stringify(c.want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(got).padEnd(34)} want ${JSON.stringify(c.want).padEnd(26)} ${c.t}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

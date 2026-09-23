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
// The extension strips <details> planning blocks before handing text to the engine
// (stripPlanning at the call site), so the harness must too, or it tests a path that does not ship.
// Keep this identical to the call site, including the `|$` for an unclosed block.
const strip = t => String(t || '').replace(/<details[\s\S]*?(?:<\/details>|$)/gi, ' ');
function wornAfter(sentences) {
  const state = {};
  for (const s of sentences) WardrobeEngine.scan(strip(s), [], state, OPTS);
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
  // A possessive qualifier is generic ("<Name>'s"), not a hardcoded list of names. It must work for
  // any name and for a relationship word, and must not swallow non-garment nouns.
  { t: "She puts on Sarah's old coat.", want: ["sarah's old coat"] },
  { t: "She wears her mother's dress.", want: ["mother's dress"] },
  // Negation and contemplation: these used to record the OPPOSITE of what happened.
  { t: 'She did not put her coat on.', want: [] },
  { t: "She didn't put her coat on.", want: [] },
  { t: 'She thought about wearing the blue dress.', want: [] },
  { t: 'She should have worn her coat.', want: [] },
  { t: 'She went out without her coat.', want: [] },
  // An instruction to dress is not a description of dressing.
  { t: '"Put your coat on," she said.', want: [] },
  { t: 'She told him to put his coat on.', want: [] },
  // ...but a character stating what they have on is real and must survive the guard above:
  { t: '"I\'m wearing the green dress," she said.', want: ['green dress'] },
  { t: 'She pulled her coat on. "Ready," she said.', want: ['coat'] },
  // Nakedness. These had NO coverage at all, which is how the fast path drifted out of step with
  // NAKED_RE and silently swallowed three of them (23 Sep).
  { t: 'She is naked.', want: ['(nothing)'] },
  { t: 'She had nothing on.', want: ['(nothing)'] },
  { t: 'She is wearing nothing.', want: ['(nothing)'] },
  { t: 'She is wearing nothing at all.', want: ['(nothing)'] },
  { t: 'Not a stitch on her.', want: ['(nothing)'] },
  { t: 'She has nothing on under her coat.', want: ['(nothing)'] },
  // "nothing BUT X" is not nakedness: X is worn. Stripping here lost the garment entirely.
  { t: 'She is wearing nothing but a towel.', want: [] },
  { t: 'She stands there in nothing but a towel.', want: [] },
  { t: 'She had nothing on but her slip.', want: [] },
  // Known limits, asserted so they are visible rather than forgotten:
  // "nothing but a towel" correctly stops being NAKED, but the towel is not recorded as worn
  // either: no ON_RE branch matches a bare noun with no dressing verb. Not-naked is the more
  // important half, and a wrong garment would be worse than none.
  // An instruction followed by narration of it being obeyed is suppressed with the instruction.
  // Recording clothing nobody put on is the worse error, so this stays a deliberate false negative.
  { t: '"Put your coat on," she said, and he pulled it on.', want: [] },
  // A bare pronoun + non-possessive article ("a clean shirt", not "his") has no traceable owner,
  // so ownerOf drops it. With a possessive or a name it resolves — see the three cases above.
  { t: 'He pulls a clean shirt on.', want: [] },
  { t: 'She shrugs her cardigan on over the tank top.', want: ['cardigan'] },  // only the first garment in a clause
  // 23 Sep: a <details> planning block lists branches that have NOT happened. The engine was fed
  // text split at the first '<details', which is safe but discards real prose written after a
  // closed block; it now strips the blocks instead, like the mood and presence paths. A garment
  // named only inside a plan must never be recorded — 89 messages in the live chat put a garment
  // word inside one.
  { t: 'She puts her blue dress on.\n<details><summary>Plot</summary>- Path_A: she puts her red coat on</details>', want: ['blue dress'] },
  { t: 'She puts her blue dress on.\n<details><summary>Plot</summary>- Path_A: she puts her red coat on', want: ['blue dress'] },
  { t: '<details><summary>Plot</summary>- Path_A: she puts her red coat on</details>\nShe puts her blue dress on.', want: ['blue dress'] },
  // 23 Sep: adjusting a garment already worn is not putting one on. Making "pulls" a put-on verb
  // (the fix earlier that day) meant "he pulls his cap lower" recorded a NEW cap — in the live chat
  // that put a cap on a character who then wore it for 2,515 messages.
  { t: 'He pulls his cap lower.', want: [] },
  { t: 'She pulls her scarf tighter.', want: [] },
  { t: 'He pulls his collar straight.', want: [] },
  { t: 'She pulls her coat tighter around her.', want: [] },
  // ...without breaking the real put-ons that share the verb:
  { t: 'He pulls his cap on.', want: ['cap'] },
  { t: 'She pulls her boots on.', want: ['boots'] },
  // 23 Sep: undressing spared EVERY accessory, but the 'acc' category mixes items that plainly
  // survive it (hat, scarf, gloves) with clothing in its own right (apron, belt, tie, towel).
  // Sparing the second kind produced states that cannot be true — "apron, nothing" and
  // "belt, nothing" both occur in the live chat, and an apron stayed on for thousands of messages.
  { t: ['She puts her apron on.', 'She is naked.'], want: ['(nothing)'] },
  { t: ['She puts her belt on.', 'She is naked.'], want: ['(nothing)'] },
  // ...while a hat still survives, because it genuinely can:
  { t: ['She puts her hat on.', 'She is naked.'], want: ['(nothing)', 'hat'] },
];

const one = process.argv[2];
if (one) { console.log(JSON.stringify(wornAfter([one]))); process.exit(0); }

let fails = 0;
for (const c of CASES) {
  // `t` may be a single message or an ordered list, for cases that need state carried between them.
  const got = wornAfter(Array.isArray(c.t) ? c.t : [c.t]);
  const ok = JSON.stringify(got) === JSON.stringify(c.want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(got).padEnd(34)} want ${JSON.stringify(c.want).padEnd(26)} ${c.t}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

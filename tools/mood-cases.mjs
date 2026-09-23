#!/usr/bin/env node
// Case-based regression suite for the pure MoodEngine lexicon in index.js.
//
// Companion to tools/mood-harness.mjs, which is a different tool: that one replays a real saved
// chat and prints a verdict per message. This one takes no arguments and asserts fixed cases, so a
// lexicon edit can be checked in milliseconds without a chat file.
//
//   node tools/mood-cases.mjs                 # run the case set
//   node tools/mood-cases.mjs "She laughed."  # try one message
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.js'), 'utf8');
const begin = src.indexOf('// === MOOD ENGINE (pure) BEGIN ===');
const end = src.indexOf('// === MOOD ENGINE (pure) END ===');
if (begin < 0 || end < 0) { console.error('engine markers not found in index.js'); process.exit(2); }
const block = src.slice(begin, end).replace('// === MOOD ENGINE (pure) BEGIN ===', '');
const M = eval('(function(){' + block.replace(/^\s*const MoodEngine = /m, 'return ') + '})()');

const LX = M.compileLexicon();
const OPTS = { hex: '#c77', soloFemale: true };
const mood = t => (M.lexicon(M.extractOwn(t, OPTS), LX).top || 'none');

const CASES = [
  // Behavioural cues: the table's primary evidence, and the bias it should keep.
  { t: 'She laughed.', want: 'amusement' },
  { t: 'She was furious.', want: 'anger' },
  // Plain stated feeling. A dozen of the commonest words were absent until 23 Sep, so "She was sad."
  // produced no mood at all.
  { t: 'She was sad.', want: 'sadness' },
  { t: 'She was angry.', want: 'anger' },
  { t: 'She was upset.', want: 'annoyance' },
  { t: 'She was worried.', want: 'nervousness' },
  { t: 'She was surprised.', want: 'surprise' },
  { t: 'She was embarrassed.', want: 'embarrassment' },
  { t: 'She was glad.', want: 'joy' },
  { t: 'She was tired.', want: 'sadness' },
  { t: 'She felt a little lonely.', want: 'sadness' },
  // Stated feeling is weighted low on purpose: a real behavioural cue in the same message wins.
  { t: 'She was sad but she laughed anyway.', want: 'amusement' },
  // Subject-anchored, so someone else's feeling is not hers.
  { t: 'He was angry.', want: 'none' },
  { t: 'The dog was upset.', want: 'none' },
  // Negation must keep suppressing, including for the new entries.
  { t: 'She did not laugh.', want: 'none' },
  { t: 'She was not angry at all.', want: 'none' },
  { t: 'She was never afraid of him.', want: 'none' },
  { t: 'It was not that she was sad.', want: 'none' },
];

// npcVariant picks which portrait file a cast chip shows. Added 0.9.14: an exact per-mood file
// wins over the bucket map, so npc/bob-curiosity.png is used instead of collapsing to neutral.
// The last two cases are the ones that matter for existing users: with no per-mood files the
// behaviour must be exactly what it was before.
const VARIANT_CASES = [
  { label: 'curiosity', have: ['curiosity', 'happy'], want: 'curiosity' },   // exact file wins
  { label: 'curiosity', have: ['happy'], want: 'neutral' },                  // no file, no bucket
  { label: 'desire', have: ['flirty'], want: 'flirty' },                     // near neighbour
  { label: 'desire', have: [], want: 'neutral' },                            // desire has no bucket
  { label: 'anger', have: ['angry'], want: 'angry' },
  { label: 'neutral', have: ['neutral'], want: 'neutral' },
  { label: 'joy', have: null, want: 'happy' },                               // no set: old behaviour
  { label: 'sadness', have: null, want: 'sad' },
];

const one = process.argv[2];
if (one) { console.log(mood(one)); process.exit(0); }

let fails = 0;
for (const c of CASES) {
  const got = mood(c.t);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(14)} want ${c.want.padEnd(14)} ${c.t}`);
}
for (const c of VARIANT_CASES) {
  const got = M.npcVariant(c.label, c.have ? new Set(c.have) : null);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(14)} want ${c.want.padEnd(14)} npcVariant(${c.label}, ${c.have ? '[' + c.have.join(',') + ']' : 'none'})`);
}
const total = CASES.length + VARIANT_CASES.length;
console.log(fails ? `\n${fails} failing` : `\nall ${total} pass`);
process.exit(fails ? 1 : 0);

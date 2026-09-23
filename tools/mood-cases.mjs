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

const one = process.argv[2];
if (one) { console.log(mood(one)); process.exit(0); }

let fails = 0;
for (const c of CASES) {
  const got = mood(c.t);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(14)} want ${c.want.padEnd(14)} ${c.t}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

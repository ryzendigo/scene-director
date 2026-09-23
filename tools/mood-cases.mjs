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

// --src=<file> runs the suite against a DIFFERENT build (a mutant, or the private
// copy), which is what makes a mutation check possible. It deliberately does not use
// argv[2]: several of these suites already take a single probe string there.
const SRC_OVERRIDE = (process.argv.find((a) => a.startsWith('--src=')) || '').slice(6) || null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(SRC_OVERRIDE || join(root, 'index.js'), 'utf8');
const begin = src.indexOf('// === MOOD ENGINE (pure) BEGIN ===');
const end = src.indexOf('// === MOOD ENGINE (pure) END ===');
if (begin < 0 || end < 0) { console.error('engine markers not found in index.js'); process.exit(2); }
const block = src.slice(begin, end).replace('// === MOOD ENGINE (pure) BEGIN ===', '');
const M = eval('(function(){' + block.replace(/^\s*const MoodEngine = /m, 'return ') + '})()');

const LX = M.compileLexicon();
// 23 Sep: compileLexicon used `table || DEFAULT_LEXICON` — truthiness, not an array check — so a
// settings import carrying a number or object here threw "is not iterable" instead of falling back.
// Settings import copies any key present in defaultSettings with NO type check, so a hand-edited or
// truncated export reaches this. A malformed table must mean "use the built-in one", never a crash.
// These used to print FAIL and process.exit(1) directly, outside the `fails` counter, so
// a failure here produced no "N failing" line — which made the mutation sweep classify a
// broken compileLexicon as UNCOVERED when the check had caught it all along. Report them
// like every other case instead.
// A NON-array means "malformed, use the built-in table". An ARRAY is the user's own
// table, and an empty one legitimately means "no cues" — settings document
// `moodLexicon: null = built-in table; else [[regex, label, weight, [vetoes]], ...]`.
// I first asserted that [] should fall back too, which is wrong: that would make it
// impossible to turn the lexicon off.
const LEX_FALLBACK = [
  [42, 'built-in'], ['nonsense', 'built-in'], [{}, 'built-in'], [{ a: 1 }, 'built-in'],
  [true, 'built-in'], [null, 'built-in'], [undefined, 'built-in'],
  [[], 'empty'], [[null], 'empty'], [[['(', 'joy', 1]], 'empty'],   // rows that cannot compile
];
let lexFails = 0;
for (const [input, want] of LEX_FALLBACK) {
  let n = -1;
  try { n = M.compileLexicon(input).length; } catch (e) { /* stays -1 */ }
  const ok = want === 'built-in' ? n > 0 : n === 0;
  if (!ok) lexFails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  compileLexicon(${JSON.stringify(input)}) -> ${n} rows, want ${want}`);
}
const OPTS = { hex: '#c77', soloFemale: true };
// A case may pass `others: [/\bName\b/i]` to supply otherNameRes, which is what the extension does
// for every other cast member. Without it the "someone else is acting" guard cannot fire, and a
// case meant to test that guard passes for the wrong reason.
const mood = (t, others, solo) => (M.lexicon(M.extractOwn(t, { ...OPTS, ...(others ? { otherNameRes: others } : {}), ...(solo === false ? { soloFemale: false } : {}) }), LX).top || 'none');

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
  // 23 Sep: some characters narrate in the FIRST person. extractOwn only looked for her name or
  // she/her, so those messages extracted NOTHING and came back neutral no matter what they said —
  // 216 of her messages in the live chat. The mood path only ever runs on her own message
  // (getLastAiMessage returns null for a user message), so "I" in it is her.
  { t: '*I duck my head, but I am smiling too hard to hide it.*', want: 'joy' },
  { t: '*I laugh before I can stop myself.*', want: 'amusement' },
  { t: '*My cheeks flush and I look at the floor.*', want: 'embarrassment' },
  // ...but a sentence that names someone else is not about her:
  { t: '*Kate laughs at the joke and I watch her.*', want: 'none', others: [/\bKate\b/i] },
  // ...and first person is gated on soloFemale, which the MAIN-character path sets true and every
  // NPC path sets false. Without that gate an NPC picks up the narrator's first person: an NPC
  // scored joy from "I duck my head, smiling too hard to hide it", which is the main character.
  { t: '*I duck my head, but I am smiling too hard to hide it.*', want: 'none', solo: false },
];

// mapToAvailable picks the sprite when the folder has no file for the verdict. 23 Sep: the broad
// fallback list was warm-first for EVERY label, so with only warm sprites installed an angry or
// grieving character showed a CARING face — the opposite of what the prose said. Neutral is a
// better last resort than a contradiction.
const NEAR_CASES = [
  // Full set: NEAREST handles these before the broad list ever runs.
  { label: 'anger', have: ['neutral', 'caring', 'curiosity', 'joy', 'sadness', 'nervousness'], want: 'sadness' },
  { label: 'fear', have: ['neutral', 'caring', 'curiosity', 'joy', 'sadness', 'nervousness'], want: 'nervousness' },
  { label: 'love', have: ['neutral', 'caring', 'curiosity', 'joy', 'sadness', 'nervousness'], want: 'caring' },
  // Warm-only folder: a dark mood must NOT become caring while neutral is on the shelf.
  { label: 'anger', have: ['neutral', 'caring', 'joy'], want: 'neutral' },
  { label: 'grief', have: ['neutral', 'caring', 'joy'], want: 'neutral' },
  { label: 'disgust', have: ['neutral', 'caring', 'joy'], want: 'neutral' },
  // ...while a warm mood still takes the warm sprite rather than neutral.
  { label: 'love', have: ['neutral', 'caring', 'joy'], want: 'caring' },
  { label: 'orgasm', have: ['neutral', 'caring', 'joy'], want: 'joy' },
  // An exact file always wins, and an empty set means "install everything", so pass through.
  { label: 'anger', have: ['anger', 'caring'], want: 'anger' },
  { label: 'anger', have: [], want: 'anger' },
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

const one = process.argv.slice(2).find((a) => !a.startsWith('--src=')) || undefined;
if (one) { console.log(mood(one)); process.exit(0); }

let fails = lexFails;
for (const c of CASES) {
  const got = mood(c.t, c.others, c.solo);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(14)} want ${c.want.padEnd(14)} ${c.t}`);
}
for (const c of NEAR_CASES) {
  const got = M.mapToAvailable(c.label, new Set(c.have));
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(got).padEnd(14)} want ${c.want.padEnd(14)} mapToAvailable(${c.label}, [${c.have.join(',')}])`);
}
for (const c of VARIANT_CASES) {
  const got = M.npcVariant(c.label, c.have ? new Set(c.have) : null);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(14)} want ${c.want.padEnd(14)} npcVariant(${c.label}, ${c.have ? '[' + c.have.join(',') + ']' : 'none'})`);
}
// --- classifierText ----------------------------------------------------------------
// What the local classifier actually SEES. Heavy parts (the character's own dialogue,
// w >= 2) go first and light parts only fill the remaining budget, so a long narration
// can never crowd out her own words. A mutation sweep found that truncating this to
// five characters — type-correct and plausible — failed no suite, so nothing asserted
// any of it.
const CT_CASES = [
  {
    label: 'heavy first, light after',
    ext: { parts: [{ text: 'narration here', w: 1 }, { text: 'her words', w: 2 }] },
    cap: 1500, want: 'her words narration here',
  },
  {
    label: 'light dropped when heavy fills the cap',
    ext: { parts: [{ text: 'x'.repeat(30), w: 2 }, { text: 'narration', w: 1 }] },
    cap: 20, want: 'x'.repeat(20),
  },
  {
    label: 'cap truncates',
    ext: { parts: [{ text: 'abcdefghij', w: 2 }] },
    cap: 4, want: 'abcd',
  },
  {
    label: 'default cap applies when none given',
    ext: { parts: [{ text: 'y'.repeat(2000), w: 2 }] },
    cap: undefined, want: 'y'.repeat(1500),
  },
  {
    label: 'light only is still used',
    ext: { parts: [{ text: 'just narration', w: 1 }] },
    cap: 1500, want: 'just narration',
  },
  { label: 'no parts is empty', ext: { parts: [] }, cap: 1500, want: '' },
];
for (const c of CT_CASES) {
  const got = M.classifierText(c.ext, c.cap);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(got).slice(0, 30).padEnd(32)} want ${JSON.stringify(c.want).slice(0, 26).padEnd(28)} ${c.label}`);
}
const total = CASES.length + NEAR_CASES.length + VARIANT_CASES.length + CT_CASES.length + LEX_FALLBACK.length;
console.log(fails ? `\n${fails} failing` : `\nall ${total} pass`);
process.exit(fails ? 1 : 0);

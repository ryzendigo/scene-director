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

// --src=<file> runs the suite against a DIFFERENT build (a mutant, or the private
// copy), which is what makes a mutation check possible. It deliberately does not use
// argv[2]: several of these suites already take a single probe string there.
const SRC_OVERRIDE = (process.argv.find((a) => a.startsWith('--src=')) || '').slice(6) || null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(SRC_OVERRIDE || join(root, 'index.js'), 'utf8');
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
  // 23 Sep: a return was not an arrival. Every arrival cue wanted the verb and its particle
  // adjacent, so inserting "back" between them defeated all of them — and a return usually FOLLOWS
  // a departure, so the chip stayed hidden exactly when it mattered.
  { t: 'Beth came back in with the shopping.', want: true },
  { t: 'Beth walked back in.', want: true },
  { t: 'Beth stepped back inside.', want: true },
  { t: 'Beth went out to the car. She came back in and sat down.', want: true },
  // ...without turning every "back" into an arrival:
  { t: 'He put the kettle back on the bench.', want: false },
  { t: 'He leaned back in his chair.', want: false },
  // Real phrasings from the live chat: "back to work"/"back to sleep" are not arrivals at all.
  // 23 Sep, corrected: this asserted `false` on the reasoning that "came back in one piece" is an
  // idiom rather than an arrival. True, but beside the point — "Beth said" puts Beth in the room
  // speaking, so showing her is right, and the old expectation was wrong rather than the engine.
  // What must stay hidden is someone ELSE reporting about her, which the next two cases pin.
  { t: 'Beth said we came back in one piece.', want: true },
  { t: 'Kate said Beth came back in one piece.', want: false },
  { t: '"Beth said we came back in one piece," Kate told him.', want: false },
  { t: 'Beth got back to work on the accounts.', want: false },
  { t: 'Beth went back to sleep.', want: false },
  { t: 'Beth walked back in from the yard.', want: true },
  // 23 Sep: the absence table was entirely remote/reported contact (rang, said, told) with no
  // negation in it, so a flat statement of absence vetoed nothing. It only looked correct because
  // such a sentence usually scores 0 anyway — put a real arrival cue beside it and the absent
  // character was shown, credited with someone ELSE's arrival from inside the ±40 char window.
  { t: 'Beth was not there. Her brother came in instead and took the chair by the window.', want: false },
  { t: 'Beth had gone home. A long time afterwards, Tom walked in and sat down at the table.', want: false },
  { t: 'Beth is away for the week.', want: false },
  // ...and an ordinary present-tense scene must survive the new negation cues:
  { t: 'Beth was in the kitchen when he got home.', want: true },
  { t: 'Beth walked in, put the kettle on and took her coat off.', want: true },
  // 23 Sep, measured against the live chat: the action table was almost entirely GESTURES and had
  // none of the ordinary physical verbs that carry domestic prose, so a character doing plainly
  // present things scored zero. Hidden in 300 of the 329 messages that named her.
  { t: 'Beth takes the potato from the fork and chews slowly.', want: true },
  { t: 'Beth turns from the sink and lifts the pan off the stove.', want: true },
  { t: 'Beth leans against the doorway and pushes her hair back.', want: true },
  // ...but an action must be THIS member's. Scoring every verb in the sentence credited a character
  // with someone else's: expanding the table made a man named nearby "present" because a woman
  // leaned in and kissed him.
  { t: 'Tom watched from the door. She leans in and kisses him.', want: false },
  { t: 'Beth had gone home. Kate turns from the sink and lifts the pan.', want: false },
  // A speech verb is only absence when SOMEONE ELSE is talking (see the reported-speech cases
  // above); the member doing the talking is present.
  { t: 'Beth says she is tired and sets her cup down.', want: true },
  // KNOWN LIMIT, pre-dating the 23 Sep work and deliberately not fixed here: ARRIVAL cues are still
  // matched in a ±40 char window around the name with no regard for whose they are, so a character
  // merely mentioned in a scene someone else is acting in can be shown. Measured on the live chat,
  // this is the dominant remaining false positive. Actions are now subject-aware; cues are not.
  // Written with Beth's name so it actually exercises the member the harness uses: she is only
  // mentioned as the owner of the table, yet "stand" inside the ±40 char window scores her present.
  // This case documents the bug and is EXPECTED TO FAIL the day someone makes cues subject-aware —
  // flip it to false then.
  { t: 'I stand at the end of Beth\'s table with the dog on my boot.', want: true },
  // 23 Sep: <details> planning blocks list branches that have NOT happened ("Path_B: Beth walks in
  // and sits down"). They were stripped correctly only when the tag closed — the non-greedy regex
  // REQUIRED a </details>, so a truncated message leaked its whole plan and a hypothetical arrival
  // marked the character present. 14 such messages in the live chat.
  { t: 'Tom sat alone.\n<details><summary>Plot</summary>- Path_A: Beth walks in and sits down</details>', want: false },
  { t: 'Tom sat alone.\n<details><summary>Plot</summary>- Path_A: Beth walks in and sits down', want: false },
  // ...and real prose on either side of a block must survive:
  { t: '<details><summary>Plot</summary>- Path_A: nothing</details>\nBeth walks in and sits down.', want: true },
  // <think> reasoning carried the identical flaw — the strip required a closing tag. Only one live
  // message uses it and it closes cleanly, so this is latent rather than active, but reasoning
  // models truncate and it was the same one-character fix.
  { t: 'Tom sat alone.\n<think>Maybe Beth walks in and sits down</think>', want: false },
  { t: 'Tom sat alone.\n<think>Maybe Beth walks in and sits down', want: false },
];

const one = process.argv.slice(2).find((a) => !a.startsWith('--src=')) || undefined;
if (one) { console.log(shown(one) ? 'SHOWN' : 'hidden'); process.exit(0); }

let fails = 0;
for (const c of CASES) {
  const got = shown(c.t);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${(got ? 'SHOWN' : 'hidden').padEnd(8)} want ${(c.want ? 'SHOWN' : 'hidden').padEnd(8)} ${c.t}`);
}
// --- sentenceAround ----------------------------------------------------------------
// Bounds which sentence an index falls in. Everything that attributes a name, a garment
// or a prop to an actor works on the sentence around a match, so a wrong boundary
// attributes across sentences. A mutation sweep found that returning the WHOLE text with
// spans covering everything — type-correct and plausible — failed no suite at all.
const SA_CASES = [
  { t: 'She left. He stayed.', idx: 2, want: 'She left' },
  { t: 'She left. He stayed.', idx: 12, want: ' He stayed' },
  { t: 'One sentence only', idx: 4, want: 'One sentence only' },
  { t: 'Stop! Go on.', idx: 7, want: ' Go on' },
  { t: 'Ask? Answer.', idx: 6, want: ' Answer' },
  { t: 'Line one\nLine two', idx: 11, want: 'Line two' },
  { t: '', idx: 0, want: '' },
  { t: 'Trailing.', idx: 0, want: 'Trailing' },
];
for (const c of SA_CASES) {
  const r = P.sentenceAround(c.t, c.idx);
  const got = r && r.text;
  const spansOk = r && r.start <= c.idx && r.end >= c.idx && r.text === c.t.slice(r.start, r.end);
  const ok = got === c.want && spansOk;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(got).padEnd(22)} want ${JSON.stringify(c.want).padEnd(22)} sentenceAround(${JSON.stringify(c.t)}, ${c.idx})`);
}
// --- a place named after someone is not that person --------------------------------
// Measured on the real corpus: Caitlin is named in 75 messages and shown in none, and 9
// of those score exactly 3 — her name is in the LOCATION HEADER ("40 Roberts Road,
// Caitlin's Old Room") while the narration has Granty in the room. The threshold is what
// separates "a room named after her" from "she is here".
const PLACE_CASES = [
  // The header alone scores 3, under the threshold. NOTE: a narration ACTION CUE adds 4
  // regardless of who performs it, so "Granty sits on the bed" in Beth's room DOES show
  // Beth — presence is not passed the other cast names the way MoodEngine is. Measured
  // before leaving it: across the whole corpus a cast name appears only in the header 7
  // times and presence shows the chip in 0 of them, because those narrations carry no cue
  // verb. Theoretical, not live; changing the scoring on synthetic evidence would be worse.
  ['📍 40 Roberts Road, Beth\'s Old Room\n\nThe window slides up with a dry scrape.', false,
    'a room named after her, with no action cue, is not her'],
  ['📍 Beth Street\n\nHe walked to the corner and waited.', false,
    'a street named after her is not her'],
  // She is present when the NARRATION puts her there, header or not.
  ['📍 the kitchen\n\nBeth leans against the bench and watches him.', true,
    'narration carries presence'],
  ['📍 40 Roberts Road, Beth\'s Old Room\n\nBeth sits on the edge of the made bed.', true,
    'named place plus narration is still her'],
];
for (const [text, want, why] of PLACE_CASES) {
  const got = shown(text);
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${(got ? 'SHOWN' : 'hidden').padEnd(8)} want ${(want ? 'SHOWN' : 'hidden').padEnd(8)} ${why}`);
}
// The strongest property, verified across 16,350 corpus checks: presence never shows a
// chip for a character the message does not name at all.
const UNNAMED_CASES = [
  'He crossed the room and put the kettle on.',
  'She said nothing for a long moment.',
  '📍 the kitchen\n\nThe door opened and someone came in.',
  '"Beth is coming later," he said.',
];
for (const text of UNNAMED_CASES) {
  const names = /\bBeth\b/i.test(text);
  const got = shown(text);
  const ok = !got || names;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${(got ? 'SHOWN' : 'hidden').padEnd(8)} ${names ? '(named)  ' : '(unnamed)'} ${JSON.stringify(text.slice(0, 46))}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length + SA_CASES.length + PLACE_CASES.length + UNNAMED_CASES.length} pass`);
process.exit(fails ? 1 : 0);

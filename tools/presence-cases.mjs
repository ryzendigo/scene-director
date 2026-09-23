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

// detectMoodTag is layer 1 of the mood verdict: a trailing [MOOD: label] the model was
// asked to emit. Nothing covered it, and it is the one layer that can be WRONG rather
// than merely absent — a bad label here overrides the classifier and the lexicon.
//
//   node tools/moodtag-cases.mjs [path/to/index.js]
//
// Measured 2026-09-25: ZERO tags and zero near-misses across 5,334 real AI messages, so
// these cases are about correctness, not a live failure. (The instruction is injected at
// IN_CHAT depth 0 and the model ignores it — see the compliance note in the README.)
//
// The function, its regex and the label set are LIFTED from index.js so this cannot
// drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const reM = /const MOOD_TAG_RE = (\/[^\n]+?\/i);/.exec(src);
const labM = /const LABELS = (\[[\s\S]*?\]);/.exec(src);
const fnM = /function detectMoodTag\(rawText\) \{[\s\S]*?\n    \}/.exec(src);
if (!reM || !labM || !fnM) { console.error('detectMoodTag, MOOD_TAG_RE or LABELS not found in ' + file); process.exit(2); }

const setName = (/\b(EXPRESSION_LABEL_SET|EXPRESSION_LABELS)\.has\(/.exec(fnM[0]) || [, 'EXPRESSION_LABEL_SET'])[1];
const detectMoodTag = new Function('MOOD_TAG_RE', setName, `return (${fnM[0]});`)(
  eval(reM[1]), new Set(eval(labM[1])),
);

let fails = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};
const body = '*She set the cup down.*';

// --- the shapes a model plausibly emits, all of which must work ---
check('plain tag', detectMoodTag(`${body}\n\n[MOOD: joy]`), 'joy');
check('no space after colon', detectMoodTag(`${body}\n[MOOD:joy]`), 'joy');
check('lowercase key', detectMoodTag(`${body}\n[mood: joy]`), 'joy');
check('mixed case label', detectMoodTag(`${body}\n[MOOD: JOY]`), 'joy');
check('fullwidth colon', detectMoodTag(`${body}\n[MOOD： joy]`), 'joy');
check('CJK brackets', detectMoodTag(`${body}\n〔MOOD: joy〕`), 'joy');
check('trailing newline', detectMoodTag(`${body}\n[MOOD: joy]\n`), 'joy');
check('trailing spaces', detectMoodTag(`${body}\n[MOOD: joy]   `), 'joy');
check('trailing mixed whitespace', detectMoodTag(`${body}\n[MOOD: joy]  \n  `), 'joy');
// NOTE: dropping the `.trimEnd()` in detectMoodTag is an EQUIVALENT mutation, not a gap.
// MOOD_TAG_RE already ends in `\s*$`, so it matches through trailing whitespace by
// itself; and in the one case where the 300-char tail cap cuts into a long whitespace
// run, both forms fail alike. Do not invent a case to "catch" it.
check('inner padding', detectMoodTag(`${body}\n[ MOOD : joy ]`), 'joy');

// --- it must REJECT anything that is not a clean trailing tag ---
check('text after the tag', detectMoodTag(`[MOOD: joy]\n\n${body}`), null);
check('tag followed by a full stop', detectMoodTag(`${body}\n[MOOD: joy].`), null);
check('two-word label', detectMoodTag(`${body}\n[MOOD: very happy]`), null);
check('no tag at all', detectMoodTag(body), null);

// --- an UNKNOWN label must not reach /emote: the sprite set has 28 labels and an
//     invented one would ask for a file that does not exist (a blank sprite) ---
check('invented label rejected', detectMoodTag(`${body}\n[MOOD: ecstatic]`), null);
check('empty label rejected', detectMoodTag(`${body}\n[MOOD: ]`), null);
check('numeric label rejected', detectMoodTag(`${body}\n[MOOD: 42]`), null);

// --- every shipped label must actually be accepted, or the feature silently
//     half-works for whichever ones were mistyped in one list but not the other ---
{
  const labels = eval(labM[1]);
  const bad = labels.filter((l) => detectMoodTag(`${body}\n[MOOD: ${l}]`) !== l);
  check(`all ${labels.length} shipped labels are accepted`, bad.length === 0, true);
  if (bad.length) console.log('      rejected:', bad.join(', '));
}

// --- degenerate input must not throw ---
for (const [name, v] of [['null', null], ['undefined', undefined], ['empty string', ''], ['number', 42], ['object', {}]]) {
  let got; try { got = detectMoodTag(v); } catch (e) { fails++; console.log(`FAIL  ${name} threw`); continue; }
  check(`${name} returns null`, got, null);
}

// --- the tail cap: only the last 300 chars are searched, so a tag after a long
//     message still has to be found ---
check('tag after a very long message', detectMoodTag('x'.repeat(50000) + `\n[MOOD: joy]`), 'joy');

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

// detectUnknownSpeakers puts a chip on screen for a speaker who has NO cast card, by
// noticing a <font color> the settings do not claim. A wrong answer here is directly
// visible: a chip appears labelled with the wrong name, the wrong gender silhouette, or
// for someone who already has a card.
//
//   node tools/unknown-cases.mjs [path/to/index.js]
//
// PUBLIC BUILD ONLY — the private build's cast is a hardcoded constant and it has no
// such function, so this exits 2 there rather than reporting a false all-clear.
//
// The function is LIFTED from index.js. (An earlier suite in this repo reimplemented two
// lines instead of lifting them and two mutants survived — it was testing the copy.)
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const fnM = /function detectUnknownSpeakers\(scene, settings\) \{[\s\S]*?\n    \}/.exec(src);
const reM = /const FONT_SPAN_RE = (\/[^\n]+?\/[a-z]*);/.exec(src);
const notM = /const NOT_NAMES = (new Set\([\s\S]*?\));\n/.exec(src);
if (!fnM || !reM || !notM) { console.error('detectUnknownSpeakers, FONT_SPAN_RE or NOT_NAMES not found in ' + file); process.exit(2); }

// Real PresenceEngine.mask/nameGuess would pull in the whole engine; stub them so these
// cases isolate the CALLER. presence-cases.mjs already covers nameGuess itself.
function makeModule(nameGuess) {
  const mk = new Function('FONT_SPAN_RE', 'NOT_NAMES', 'PresenceEngine', 'compileRegex', 'SillyTavern', 'dbg', `
    const unknownInfo = new Map();
    const colourAlias = new Map();
    ${fnM[0]}
    return { detectUnknownSpeakers, unknownInfo, colourAlias };
  `);
  return mk(
    eval(reM[1]), [...eval(notM[1])],
    { mask: (t) => t, nameGuess: nameGuess || (() => null) },
    (p) => { try { return typeof p === 'string' && p ? new RegExp(p, 'i') : null; } catch { return null; } },
    { getContext: () => ({ name2: 'Elise Marks' }) },
    () => {},
  );
}
const scene = (text) => ({ text, lower: text.toLowerCase() });
const span = (hex, t) => `<font color="${hex}">${t}</font>`;

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};

// --- which colours count as unknown ---
{
  const M = makeModule();
  const s = scene(`${span('#aaaaaa', 'hello')} ${span('#bbbbbb', 'hi')}`);
  check('an unclaimed colour becomes an unknown', M.detectUnknownSpeakers(s, { cast: [] }).map((u) => u.hex), ['#aaaaaa', '#bbbbbb']);
}
{
  const M = makeModule();
  const s = scene(`${span('#aaaaaa', 'hello')} ${span('#bbbbbb', 'hi')}`);
  check('a cast-card colour is excluded',
    M.detectUnknownSpeakers(s, { cast: [{ colorHex: '#AAAAAA', label: 'Ben' }] }).map((u) => u.hex), ['#bbbbbb']);
}
{
  const M = makeModule();
  const s = scene(span('#aaaaaa', 'hello'));
  check('the main character\'s own colour is excluded',
    M.detectUnknownSpeakers(s, { cast: [], ownColorHex: '#AAAAAA' }), []);
}
{
  const M = makeModule();
  M.colourAlias.set('#aaaaaa', 'ben');
  check('a colour already aliased to a cast member is skipped',
    M.detectUnknownSpeakers(scene(span('#aaaaaa', 'hi')), { cast: [] }), []);
}
check('no font spans at all -> none', makeModule().detectUnknownSpeakers(scene('plain narration'), { cast: [] }), []);

// --- the name guess, and the alias it can create ---
{
  const M = makeModule(() => 'Tomas');
  const out = M.detectUnknownSpeakers(scene(span('#aaaaaa', 'hi')), { cast: [] });
  check('a guessed name is used as the label', out[0].label, 'Tomas');
}
{
  const M = makeModule(() => null);
  const out = M.detectUnknownSpeakers(scene(span('#aaaaaa', 'hi')), { cast: [] });
  check('no guess -> label "Unknown"', out[0].label, 'Unknown');
}
{
  // A guessed name matching a cast card's nameRegex binds the colour to that member,
  // so a drifted colour is credited to the right person instead of a stranger.
  const M = makeModule(() => 'Ben');
  M.detectUnknownSpeakers(scene(span('#aaaaaa', 'hi')), { cast: [{ key: 'ben', nameRegex: 'ben', colorHex: '#999999' }] });
  check('a guess matching a cast card creates a colour alias', M.colourAlias.get('#aaaaaa'), 'ben');
}

// --- gender heuristic: majority of gendered pronouns near the tag ---
{
  const mk = (around) => {
    const M = makeModule(() => 'X');
    return M.detectUnknownSpeakers(scene(`${span('#aaaaaa', 'hi')} ${around}`), { cast: [] })[0].gender;
  };
  check('mostly she/her -> female', mk('She turned. Her coat was wet. She smiled.'), 'female');
  check('mostly he/him -> male', mk('He turned. His coat was wet. He smiled.'), 'male');
  check('an even split -> neutral', mk('She turned. He turned.'), 'neutral');
  check('no pronouns -> neutral', mk('The kettle boiled.'), 'neutral');
}

// --- the cache: a hex is analysed once, then reused ---
{
  let guesses = 0;
  const M = makeModule(() => { guesses++; return 'Tomas'; });
  const s = scene(span('#aaaaaa', 'hi'));
  M.detectUnknownSpeakers(s, { cast: [] });
  M.detectUnknownSpeakers(s, { cast: [] });
  check('the name guess runs once per colour, not per message', guesses, 1);
}

// --- pos is the LAST mention, matching how the speaker is chosen ---
{
  const M = makeModule(() => 'X');
  const text = `${span('#aaaaaa', 'a')} ${span('#bbbbbb', 'b')} ${span('#aaaaaa', 'c')}`;
  const out = M.detectUnknownSpeakers(scene(text), { cast: [] });
  check('pos is the last occurrence of the colour',
    out.find((u) => u.hex === '#aaaaaa').pos, text.toLowerCase().lastIndexOf('#aaaaaa'));
}

// --- degenerate input must not throw ---
for (const [name, s] of [['empty text', scene('')], ['no cast array', { text: span('#aaaaaa', 'x'), lower: span('#aaaaaa', 'x') }]]) {
  let got; try { got = makeModule().detectUnknownSpeakers(s, name === 'no cast array' ? {} : { cast: [] }); }
  catch (e) { fails++; console.log(`FAIL  ${name} threw`); continue; }
  check(`${name} returns an array`, Array.isArray(got), true);
}

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

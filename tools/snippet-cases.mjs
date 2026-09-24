// The settings drawer offers PROMPT_SNIPPET for users whose preset does not emit a
// scene header. That snippet is a CONTRACT: whatever a model produces from it must
// parse with the five shipped regexes, or the extension tells users to configure
// something it cannot read.
//
//   node tools/snippet-cases.mjs [path/to/index.js]
//
// Both the snippet and the regexes are LIFTED from index.js, so editing either one
// without the other fails here rather than in someone's install.
//
// Rewritten 0.9.79: the previous snippet was a prose sentence with no evidence behind
// it. The new one follows the structure of a preset header block measured at 95%
// compliance over 1,280 real messages (XML-tagged, MUST_START_EVERY_RESPONSE, an
// explicit Syntax template). The glyphs are a suggestion — only the FIELDS matter, and
// the regexes already parse 217 distinct real-world header shapes.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const sm = /const PROMPT_SNIPPET = ([\s\S]*?);\n/.exec(src);
if (!sm) { console.error('PROMPT_SNIPPET not found in ' + file); process.exit(2); }
const SNIPPET = eval(sm[1]);

const d = /const defaultSettings = \{([\s\S]*?)\n    \};/.exec(src)[1];
const def = (k) => { const m = new RegExp(`^\\s+${k}: '((?:[^'\\\\]|\\\\.)*)'`, 'm').exec(d); return m ? m[1].replace(/\\\\/g, '\\') : ''; };
const RE = {
  location: new RegExp(def('locationRegex'), 'i'),
  time: new RegExp(def('timeRegex'), 'i'),
  date: new RegExp(def('dateRegex'), 'i'),
  weather: new RegExp(def('weatherRegex'), 'im'),
};

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.log(`FAIL  ${name}`); } else console.log(`PASS  ${name}`); };

// The snippet must actually name every field the extension reads, or a user following
// it produces a header we only half-understand.
// A mutation test showed the hand-written HEADERS below cannot catch a change to the
// snippet's OWN glyphs: swapping 🕰️ for ⏰ in the Syntax line left every case passing
// while real users would be told to emit an unparseable time. So build a header out of
// the snippet's Syntax template itself and parse that.
const syn = /Syntax = `([^`]+)`/.exec(SNIPPET);
check('snippet carries a Syntax template', Boolean(syn));
if (syn) {
  const derived = syn[1]
    .replace(/HH:MM AM\/PM/, '9:15 AM')
    .replace(/DayOfWeek, Month DD, YYYY/, 'Sunday, August 17, 2026')
    .replace(/Location - Specific Area/, 'the kitchen')
    .replace(/WeatherEmoji Weather, Temp°F/, '☀️ Clear, 64°F');
  const msg = derived + '\n\n*She put the kettle down.*';
  check('a header built from the snippet\'s OWN Syntax line parses',
    RE.location.test(msg) && RE.time.test(msg) && RE.date.test(msg));
  if (!RE.time.test(msg)) console.log(`      derived: ${derived}`);
}

check('snippet shows a time field', /🕰️|HH:MM/.test(SNIPPET));
check('snippet shows a date field', /🗓️|YYYY/.test(SNIPPET));
check('snippet shows a location field', SNIPPET.includes('📍'));
check('snippet shows a weather field', /Weather/i.test(SNIPPET));
check('snippet demands it come first', /FIRST|START/i.test(SNIPPET));

// Headers a model would plausibly emit from it — the literal reading, then the drift.
const HEADERS = [
  ['literal, padded hour', '[ 🕰️ 09:15 AM | 🗓️ Sunday, August 17, 2026 | 📍 Carter Farm - The Loft | ☀️ Clear, 72°F ]'],
  ['single-digit hour', '[ 🕰️ 9:15 AM | 🗓️ Sunday, August 17, 2026 | 📍 the kitchen | ☀️ Clear, 64°F ]'],
  ['PM and rain', '[ 🕰️ 11:40 PM | 🗓️ Monday, December 1, 2026 | 📍 Home - Bedroom | 🌧️ Rain, 54°F ]'],
  ['no sub-area', '[ 🕰️ 6:05 PM | 🗓️ Friday, March 3, 2028 | 📍 Office | 🌫️ Fog, 48°F ]'],
  ['date icon drift + Era', '[ 🕰️ 9:15 AM | ☀️ Sunday, August 17, 2026 AD | 📍 the kitchen | ☀️ 64°F ]'],
  ['no space before AM, no °', '[ 🕰️ 9:15AM | 🗓️ Sunday, August 17, 2026 | 📍 the kitchen | ☀️ Clear 64F ]'],
  ['em-dash separator', '[ 🕰️ 7:00 PM | 🗓️ Tuesday, January 6, 2026 | 📍 Kelso — The Bar | 🌩️ Storm, 60°F ]'],
];
for (const [name, h] of HEADERS) {
  const msg = h + '\n\n*She put the kettle down.*';
  const got = { location: RE.location.test(msg), time: RE.time.test(msg), date: RE.date.test(msg) };
  check(`parses (${name})`, got.location && got.time && got.date);
}

// The location capture must stop at the separator, not swallow the weather segment.
const m = RE.location.exec('[ 🕰️ 9:15 AM | 🗓️ Sunday, August 17, 2026 | 📍 the kitchen | ☀️ Clear, 64°F ]');
check('location capture excludes the weather segment', m && m[1].trim() === 'the kitchen');

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

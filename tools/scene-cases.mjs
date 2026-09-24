// parseScene turns a raw AI message into the scene every other feature reads:
// location, hour, date, weather, raining, and the derived night/dusk/rain state.
// It is 48 lines outside the pure engines and NO tool named it until now, despite
// everything downstream depending on it.
//
//   node tools/scene-cases.mjs [path/to/index.js]
//
// PUBLIC BUILD ONLY. The private build has no `compileRegex` (its regexes are
// constants), so this exits 2 there rather than reporting a false all-clear.
//
// Measured against 730 real headers on 2026-09-24: location, hour and date parse at
// 100%, weather at 99.7%. The two weather misses are headers that omit the `|`
// before the weather segment, which is a malformed header rather than a parser bug.
//
// parseScene and its helpers are LIFTED from index.js so this cannot drift.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const lift = (name, sig) => {
  const m = new RegExp(`function ${name}\\(${sig}\\) \\{[\\s\\S]*?\\n    \\}`).exec(src);
  if (!m) { console.error(`${name} not found in ${file}`); process.exit(2); }
  return m[0];
};
// Constants and helpers parseScene closes over.
const grab = (n) => { const m = new RegExp(`^\\s+const ${n} = ([\\s\\S]*?);$`, 'm').exec(src); return m ? m[1] : null; };
const prelude = `
  const MAX_SCAN = ${/const MAX_SCAN = (\d+)/.exec(src)?.[1] || 20000};
  const MONTHS = ${grab('MONTHS')};
  const WS_RE = ${grab('WS_RE')};
  const WX_ICON_RE = ${grab('WX_ICON_RE')};
  const regexCache = new Map(); const LOG = '[sd]'; const console = { error() {} };
  ${lift('compileRegex', 'source, flags')}
  ${lift('parseHourFromMatch', 'm')}
  ${lift('monthToNumber', 'raw')}
  ${lift('parseDateFromText', 'text, settings')}
`;
const parseScene = new Function(`${prelude}\nreturn (${lift('parseScene', 'rawText, settings')});`)();

// The extension's own shipped defaults, so the cases test what users actually get.
const d = /const defaultSettings = \{([\s\S]*?)\n    \};/.exec(src)[1];
const def = (k) => { const m = new RegExp(`^\\s+${k}: '((?:[^'\\\\]|\\\\.)*)'`, 'm').exec(d); return m ? m[1].replace(/\\\\/g, '\\') : ''; };
const S = {
  locationRegex: def('locationRegex'), timeRegex: def('timeRegex'),
  dateRegex: def('dateRegex'), weatherRegex: def('weatherRegex'), rainRegex: def('rainRegex'),
};

const H = (loc, time, date, wx) =>
  `[ 🕰️ ${time} | ☀️ ${date} | 📍 ${loc} | ${wx} ]\n\n*She put the kettle down.*`;

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};

// --- a normal header, the shape 100% of real messages use ---
const s1 = parseScene(H('the kitchen', '9:15 AM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S);
check('location', s1.location, 'the kitchen');
check('hour (AM)', s1.hour, 9);
check('date', [s1.date.year, s1.date.month, s1.date.day], [2026, 8, 17]);
check('weather', s1.weather, '☀️ 64°F');
check('not raining', s1.raining, false);
check('state neutral at 9am', s1.state, 'neutral');

// --- hour parsing and the state thresholds derived from it ---
check('PM converts', parseScene(H('x', '9:15 PM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).hour, 21);
check('noon is 12', parseScene(H('x', '12:05 PM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).hour, 12);
check('midnight is 0', parseScene(H('x', '12:05 AM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).hour, 0);
check('19:00 is night', parseScene(H('x', '7:00 PM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).state, 'night');
check('17:00 is dusk', parseScene(H('x', '5:00 PM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).state, 'dusk');
check('16:00 is NOT dusk', parseScene(H('x', '4:00 PM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).state, 'neutral');
check('18:59 is still dusk', parseScene(H('x', '6:59 PM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).state, 'dusk');
check('05:00 is night', parseScene(H('x', '5:00 AM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).state, 'night');
check('06:00 is not night', parseScene(H('x', '6:00 AM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S).state, 'neutral');

// --- rain beats dusk but night beats rain ---
check('rain state', parseScene(H('x', '2:00 PM', 'Sunday, August 17, 2026 AD', '🌧️ Rain, 54°F'), S).state, 'rain');
check('raining flag', parseScene(H('x', '2:00 PM', 'Sunday, August 17, 2026 AD', '🌧️ Rain, 54°F'), S).raining, true);
check('night outranks rain', parseScene(H('x', '11:00 PM', 'Sunday, August 17, 2026 AD', '🌧️ Rain, 54°F'), S).state, 'night');
check('rain outranks dusk', parseScene(H('x', '6:00 PM', 'Sunday, August 17, 2026 AD', '🌧️ Rain, 54°F'), S).state, 'rain');

// --- degenerate input must not throw ---
for (const [name, v] of [['empty string', ''], ['null', null], ['undefined', undefined]]) {
  let got; try { got = parseScene(v, S); } catch (e) { fails++; console.log(`FAIL  ${name} threw`); continue; }
  check(`${name} yields an empty scene`, [got.location, got.hour, got.state], [null, null, 'neutral']);
}
check('narration with no header', parseScene('*She put the kettle down.*', S).location, null);

// --- the weather segment must not echo the location back ---
const s2 = parseScene(H('the kitchen', '9:15 AM', 'Sunday, August 17, 2026 AD', '☀️ 64°F'), S);
check('weather is not the location', s2.weather === s2.location, false);

// --- headerLine is the line the location came from ---
check('headerLine captured', /📍/.test(String(s1.headerLine)), true);

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

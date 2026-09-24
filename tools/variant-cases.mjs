// applyVariants turns an already-picked background into its era / seasonal variant.
// It lives OUTSIDE the pure engines, so background-cases.mjs never touched it.
//
//   node tools/variant-cases.mjs [path/to/index.js]
//
// The bug this pins: `date.year >= rule.minYear` COERCES. A rule whose minYear is
// null, [] or true compares against 0 or 1 and fires on EVERY date — an era swap
// meant for "1998 onwards" applying to the whole story. The settings validator
// rejects those types, but the Import button bypasses every validator, and
// migrateSettings only drops non-object entries, never bad fields.
//
// The function is LIFTED from index.js so this cannot drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const m = /function applyVariants\(bg, location, date, settings\) \{[\s\S]*?\n    \}/.exec(src);
if (!m) { console.error('applyVariants not found in ' + file); process.exit(2); }
const applyVariants = new Function('compileRegex', `return (${m[0].replace(/^function /, 'function ')});`)(
  (p) => { try { return p ? new RegExp(p, 'i') : null; } catch { return null; } },
);

const S = (over) => Object.assign({ enableEra: true, enableSeasonal: true, eraRules: [], seasonalMap: [] }, over);
const ERA = (minYear) => [{ minYear, from: 'street.jpg', to: 'street-1990s.jpg' }];

// [name, settings, date, expected result]
const CASES = [
  // The rule is supposed to fire only from its minYear onwards.
  ['era fires at minYear',      S({ eraRules: ERA(1998) }), { year: 1998, month: 6 }, 'street-1990s.jpg'],
  ['era fires after minYear',   S({ eraRules: ERA(1998) }), { year: 2026, month: 6 }, 'street-1990s.jpg'],
  ['era silent before minYear', S({ eraRules: ERA(1998) }), { year: 1990, month: 6 }, 'street.jpg'],

  // Bad minYear types must NOT fire. Every one of these used to.
  ['minYear null',      S({ eraRules: ERA(null) }),      { year: 2026, month: 6 }, 'street.jpg'],
  ['minYear empty []',  S({ eraRules: ERA([]) }),        { year: 2026, month: 6 }, 'street.jpg'],
  ['minYear true',      S({ eraRules: ERA(true) }),      { year: 2026, month: 6 }, 'street.jpg'],
  ['minYear "1998"',    S({ eraRules: ERA('1998') }),    { year: 2026, month: 6 }, 'street.jpg'],
  ['minYear missing',   S({ eraRules: [{ from: 'street.jpg', to: 'street-1990s.jpg' }] }), { year: 2026, month: 6 }, 'street.jpg'],
  ['minYear NaN',       S({ eraRules: ERA(NaN) }),       { year: 2026, month: 6 }, 'street.jpg'],
  ['minYear Infinity',  S({ eraRules: ERA(Infinity) }),  { year: 2026, month: 6 }, 'street.jpg'],

  // Toggles and the no-date path.
  ['era off',           S({ enableEra: false, eraRules: ERA(1998) }), { year: 2026, month: 6 }, 'street.jpg'],
  ['no date at all',    S({ eraRules: ERA(1998) }), null, 'street.jpg'],

  // Seasonal uses ===, so it is immune to coercion — pin that it stays that way.
  ['seasonal fires on month', S({ seasonalMap: [{ month: 12, from: 'street.jpg', to: 'street-xmas.jpg' }] }), { year: 2026, month: 12 }, 'street-xmas.jpg'],
  ['seasonal month as string', S({ seasonalMap: [{ month: '12', from: 'street.jpg', to: 'street-xmas.jpg' }] }), { year: 2026, month: 12 }, 'street.jpg'],
  ['seasonal wrong month',     S({ seasonalMap: [{ month: 12, from: 'street.jpg', to: 'street-xmas.jpg' }] }), { year: 2026, month: 6 }, 'street.jpg'],
];

let fails = 0;
for (const [name, settings, date, want] of CASES) {
  let got;
  try { got = applyVariants('street.jpg', 'the street', date, settings); }
  catch (e) { fails++; console.log(`FAIL  ${name} -> THREW ${String(e).slice(0, 60)}`); continue; }
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${got}  want ${want}`}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

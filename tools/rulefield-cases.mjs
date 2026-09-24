// Rule-list FIELDS arrive unvalidated. migrateSettings drops non-object entries but
// never inspects their fields, and the Import button bypasses every validator, so any
// code reading rule.minYear / rule.fromHour / counter.date must cope with the wrong
// type. Three bugs have come through that door already (v0.9.68, v0.9.72, v0.9.76).
//
//   node tools/rulefield-cases.mjs [path/to/index.js]
//
// These four helpers live outside the pure engines and had NO coverage from any tool.
// Functions are LIFTED from index.js so this cannot drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const lift = (name, sig) => {
  const re = new RegExp(`function ${name}\\(${sig}\\) \\{[\\s\\S]*?\\n    \\}`);
  const m = re.exec(src);
  if (!m) { console.error(`${name} not found in ${file}`); process.exit(2); }
  return m[0];
};
const compileRegex = (p) => { try { return p ? new RegExp(p, 'i') : null; } catch { return null; } };

const hourInWindow = new Function(`return (${lift('hourInWindow', 'hour, fromHour, toHour')});`)();
const pickCostume = new Function('compileRegex', 'hourInWindow',
  `return (${lift('pickCostume', 'location, hour, settings')});`)(compileRegex, hourInWindow);
const buildCounters = new Function(`return (${lift('buildCounters', 'date, settings')});`)();

// compileRegex is lifted too: `new RegExp([])` is /(?:)/ — an empty regex matching
// EVERY location — so an imported place with pattern [] would claim every background.
const liveCompileRegex = new Function('regexCache', 'LOG', 'console',
  `return (${lift('compileRegex', 'source, flags')});`)(new Map(), '[sd]', { error() {} });

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};

// --- hourInWindow: real windows still work ---
check('window 8-17 contains 12', hourInWindow(12, 8, 17), true);
check('window 8-17 excludes 20', hourInWindow(20, 8, 17), false);
check('window wraps midnight (22-6) contains 2', hourInWindow(2, 22, 6), true);
check('window wraps midnight (22-6) excludes 12', hourInWindow(12, 22, 6), false);
check('equal hours = all day (0,0)', hourInWindow(12, 0, 0), true);
check('equal hours = all day (9,9)', hourInWindow(3, 9, 9), true);

// --- hourInWindow: bad field types must NOT match every hour ---
for (const [name, f, t] of [
  ['both missing', undefined, undefined], ['both null', null, null],
  ['both strings', '8', '17'], ['null and number', null, 17],
  ['number and null', 8, null], ['booleans', true, false],
  ['empty arrays', [], []], ['objects', {}, {}], ['NaN', NaN, NaN],
]) check(`hourInWindow rejects ${name}`, hourInWindow(12, f, t), false);

// --- pickCostume: a rule with bad hours must not swallow every message ---
const CR = (fromHour, toHour) => ({
  enableCostumes: true,
  costumeRules: [{ pattern: 'kitchen', fromHour, toHour, costume: 'apron' }],
  backgroundMap: [], places: [],
});
check('costume rule fires inside its window', pickCostume('the kitchen', 12, CR(8, 17)), 'apron');
check('costume rule silent outside its window', pickCostume('the kitchen', 3, CR(8, 17)), '');
check('costume rule with null hours does not fire', pickCostume('the kitchen', 12, CR(null, null)), '');
check('costume rule with missing hours does not fire', pickCostume('the kitchen', 12, CR(undefined, undefined)), '');
check('costume rule with string hours does not fire', pickCostume('the kitchen', 12, CR('8', '17')), '');
check('no hour parsed returns null (not "")', pickCostume('the kitchen', null, CR(8, 17)), null);

// --- buildCounters: already defensive; pin that it stays so ---
const CC = (counters) => ({ enableCounters: true, counters });
const D = { year: 2026, month: 7, day: 21 };
check('counter counts days', buildCounters(D, CC([{ label: 'x', date: '2026-07-11', mode: 'days' }])), '10 days');
check('counter weeks mode', buildCounters(D, CC([{ label: 'x', date: '2026-07-11', mode: 'weeks' }])), '1w3d');
for (const [name, d] of [['missing', undefined], ['null', null], ['object', {}], ['array', []],
  ['bool', true], ['number', 42], ['garbage', 'abc'], ['impossible date', '2026-13-45']])
  check(`counter with ${name} date is skipped`, buildCounters(D, CC([{ label: 'x', date: d }])), '');
check('counter anchored in the future is skipped', buildCounters(D, CC([{ label: 'x', date: '2027-01-01' }])), '');

// --- compileRegex: only a string is a pattern ---
check('compileRegex accepts a real pattern', String(liveCompileRegex('kitchen')), '/kitchen/i');
for (const [name, v] of [['empty array', []], ['object', {}], ['number', 42], ['true', true],
  ['null', null], ['undefined', undefined], ['empty string', '']])
  check(`compileRegex rejects ${name}`, liveCompileRegex(v), null);

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

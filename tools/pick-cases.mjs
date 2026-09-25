// pickBackground decides EVERY background change: which place card wins, and which of
// its five slots the scene selects. Its doc comment states a precise contract —
// "seasonal month > night > rain > dusk > day; empty slots fall back to day", first
// matching place wins, legacy backgroundMap rows checked after — and no tool covered
// any of it.
//
//   node tools/pick-cases.mjs [path/to/index.js]
//
// PUBLIC BUILD ONLY. The private build has no `pickBackground` (its place matching is
// hardcoded), so this exits 2 there rather than reporting a false all-clear.
//
// LIFTED from index.js so this cannot drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const m = /function pickBackground\(location, scene, settings\) \{[\s\S]*?\n    \}/.exec(src);
if (!m) { console.error('pickBackground not found in ' + file); process.exit(2); }
const pickBackground = new Function('compileRegex', `return (${m[0]});`)(
  (p) => { try { return typeof p === 'string' && p ? new RegExp(p, 'i') : null; } catch { return null; } },
);

const SLOTS = (o) => Object.assign({ day: '', night: '', dusk: '', rain: '', seasonal: '' }, o);
const P = (pattern, slots, extra) => Object.assign({ pattern, slots: SLOTS(slots) }, extra);
const S = (places, map) => ({ places, backgroundMap: map || [] });
const scene = (state, month) => ({ state, date: month ? { year: 2026, month } : null });

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};
const file_ = (r) => (r ? r.file : null);
const graded = (r) => (r ? r.graded : null);

const ALL = P('kitchen', { day: 'd.jpg', night: 'n.jpg', dusk: 'k.jpg', rain: 'r.jpg', seasonal: 's.jpg' }, { seasonalMonth: 12 });

// --- slot precedence, the documented order ---
check('seasonal beats everything in its month', file_(pickBackground('the kitchen', scene('night', 12), S([ALL]))), 's.jpg');
check('night when not the seasonal month', file_(pickBackground('the kitchen', scene('night', 6), S([ALL]))), 'n.jpg');
check('rain', file_(pickBackground('the kitchen', scene('rain', 6), S([ALL]))), 'r.jpg');
check('dusk', file_(pickBackground('the kitchen', scene('dusk', 6), S([ALL]))), 'k.jpg');
check('neutral falls to day', file_(pickBackground('the kitchen', scene('neutral', 6), S([ALL]))), 'd.jpg');

// --- branch selection with every slot available. NOTE: reordering the night/rain/dusk
// branches inside pickBackground is an EQUIVALENT mutation, not a coverage gap — each
// tests `scene.state === <its own value>`, so the conditions are mutually exclusive and
// only one can ever hold. The real precedence (night > rain > dusk) is decided by a
// single ternary in parseScene (index.js:2504) and is covered by scene-cases.mjs
// ("night outranks rain", "rain outranks dusk"). Do not chase that mutant here.
check('night state picks night even though a rain slot exists',
  file_(pickBackground('the kitchen', scene('night', 6), S([ALL]))), 'n.jpg');
check('rain state picks rain even though a night slot exists',
  file_(pickBackground('the kitchen', scene('rain', 6), S([ALL]))), 'r.jpg');
check('dusk state picks dusk even though night and rain slots exist',
  file_(pickBackground('the kitchen', scene('dusk', 6), S([ALL]))), 'k.jpg');

// --- the seasonalMonth DEFAULT (|| 12), which no explicit-month case can reach ---
const NOMONTH = P('kitchen', { day: 'd.jpg', seasonal: 's.jpg' });   // seasonalMonth omitted
check('omitted seasonalMonth defaults to December', file_(pickBackground('the kitchen', scene('neutral', 12), S([NOMONTH]))), 's.jpg');
check('omitted seasonalMonth does not fire in January', file_(pickBackground('the kitchen', scene('neutral', 1), S([NOMONTH]))), 'd.jpg');
check('omitted seasonalMonth does not fire in June', file_(pickBackground('the kitchen', scene('neutral', 6), S([NOMONTH]))), 'd.jpg');

// --- the graded flag: only a night/rain/dusk swap is "graded" ---
check('night is graded', graded(pickBackground('the kitchen', scene('night', 6), S([ALL]))), true);
check('seasonal is NOT graded', graded(pickBackground('the kitchen', scene('night', 12), S([ALL]))), false);
check('day is NOT graded', graded(pickBackground('the kitchen', scene('neutral', 6), S([ALL]))), false);

// --- empty slots fall back to day, and the fallback is not graded ---
const DAYONLY = P('kitchen', { day: 'd.jpg' });
check('no night slot -> day', file_(pickBackground('the kitchen', scene('night', 6), S([DAYONLY]))), 'd.jpg');
check('day fallback is not graded', graded(pickBackground('the kitchen', scene('night', 6), S([DAYONLY]))), false);
check('no rain slot -> day', file_(pickBackground('the kitchen', scene('rain', 6), S([DAYONLY]))), 'd.jpg');
check('seasonal month but no seasonal slot -> day', file_(pickBackground('the kitchen', scene('neutral', 12), S([DAYONLY]))), 'd.jpg');

// --- first matching place wins, in array order ---
const A = P('kitchen', { day: 'first.jpg' }), B = P('kitchen', { day: 'second.jpg' });
check('first matching place wins', file_(pickBackground('the kitchen', scene('neutral', 6), S([A, B]))), 'first.jpg');
check('order matters', file_(pickBackground('the kitchen', scene('neutral', 6), S([B, A]))), 'second.jpg');

// --- a matching place with NO usable file must not block a later one ---
check('empty place does not shadow a later match',
  file_(pickBackground('the kitchen', scene('neutral', 6), S([P('kitchen', {}), P('kitchen', { day: 'real.jpg' })]))), 'real.jpg');

// --- no match at all ---
check('no place matches -> null', pickBackground('the attic', scene('neutral', 6), S([ALL])), null);
check('no places at all -> null', pickBackground('the kitchen', scene('neutral', 6), S([])), null);

// --- legacy backgroundMap is checked AFTER places ---
check('legacy row used when no place matches',
  file_(pickBackground('the attic', scene('neutral', 6), S([ALL], [{ pattern: 'attic', background: 'legacy.jpg' }]))), 'legacy.jpg');
check('a place beats a legacy row',
  file_(pickBackground('the kitchen', scene('neutral', 6), S([ALL], [{ pattern: 'kitchen', background: 'legacy.jpg' }]))), 'd.jpg');
check('legacy row is never graded',
  graded(pickBackground('the attic', scene('night', 6), S([], [{ pattern: 'attic', background: 'legacy.jpg' }]))), false);

// --- degenerate input: rule fields arrive unvalidated via Import ---
check('bad pattern type is skipped', pickBackground('the kitchen', scene('neutral', 6), S([P([], { day: 'x.jpg' })])), null);
check('missing slots object does not throw',
  file_(pickBackground('the kitchen', scene('neutral', 6), S([{ pattern: 'kitchen' }]))), null);
check('no scene at all -> day slot', file_(pickBackground('the kitchen', null, S([ALL]))), 'd.jpg');

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

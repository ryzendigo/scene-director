// Carry-forward: on a message with no 📍 header, reuse the last STATED location so the
// stage (background, costume, overlays) does not go inert. The whole experience for a
// user whose preset emits no header, and for the ~5% of messages where a model that
// normally does simply lapses.
//
//   node tools/carry-cases.mjs [path/to/index.js]
//
// The invariants that matter:
//   - it CARRIES, never invents: no stated location ever => still inert
//   - a real header always wins over a carried value
//   - a carried value must NOT advance the anchor, or one header pins the location for
//     the rest of the chat with no way to age out
//   - off by default, and the toggle genuinely disables it
//
// The logic is LIFTED from index.js's onMessage so this cannot drift.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const pick = /let location = scene\.location;\n\s*let carried = false;\n\s*(if \(!location && settings\.carryLocation && lastParsedLoc\) \{[^}]*\})/.exec(src);
if (!pick) { console.error('carry-forward block not found in ' + file); process.exit(2); }
const anchor = /if \(!carried\) lastParsedLoc = location;/.test(src);

// Rebuild the exact decision, then a whole-chat simulation over it.
const step = new Function('scene', 'settings', 'lastParsedLoc', `
  let location = scene.location;
  let carried = false;
  ${pick[1]}
  if (!location) return { inert: true, location: null, carried, anchor: lastParsedLoc };
  ${anchor ? 'if (!carried) lastParsedLoc = location;' : 'lastParsedLoc = location;'}
  return { inert: false, location, carried, anchor: lastParsedLoc };
`);

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};
const ON = { carryLocation: true }, OFF = { carryLocation: false };

check('off by default: no carry', step({ location: null }, OFF, 'the kitchen').inert, true);
check('header always wins over the anchor', step({ location: 'the porch' }, ON, 'the kitchen').location, 'the porch');
check('a real header is not marked carried', step({ location: 'the porch' }, ON, 'the kitchen').carried, false);
check('carries when headerless', step({ location: null }, ON, 'the kitchen').location, 'the kitchen');
check('carried value is flagged', step({ location: null }, ON, 'the kitchen').carried, true);
check('never invents: nothing stated yet', step({ location: null }, ON, null).inert, true);
check('never invents: empty anchor', step({ location: null }, ON, '').inert, true);

// The anchor invariant, over a realistic run: one header, then a long headerless stretch,
// then a NEW header. The new header must take over immediately.
const chat = ['the kitchen', null, null, null, 'the porch', null, null];
let anchorVal = null; const seen = [];
for (const loc of chat) {
  const r = step({ location: loc }, ON, anchorVal);
  anchorVal = r.anchor;
  seen.push(r.inert ? '—' : (r.carried ? `(${r.location})` : r.location));
}
check('carries across a gap and a new header takes over',
  seen, ['the kitchen', '(the kitchen)', '(the kitchen)', '(the kitchen)', 'the porch', '(the porch)', '(the porch)']);

// With the toggle off the same chat must go inert in every gap.
let a2 = null; const seen2 = [];
for (const loc of chat) { const r = step({ location: loc }, OFF, a2); a2 = r.anchor; seen2.push(r.inert ? '—' : r.location); }
check('toggle off leaves every gap inert',
  seen2, ['the kitchen', '—', '—', '—', 'the porch', '—', '—']);

check('a carried value does not advance the anchor (guard present)', anchor, true);

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

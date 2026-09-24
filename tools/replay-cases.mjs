// replay.mjs must stay faithful to onMessage. These pin the specific caller behaviours
// that four earlier measurement attempts got wrong — each one produced a plausible-looking
// "finding" that was really a modelling slip.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { replay, loadEngines, defaultRegex, stripPlanning } from './replay.mjs';

const SRC_OVERRIDE = (process.argv.find((a) => a.startsWith('--src=')) || '').slice(6) || null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(SRC_OVERRIDE || join(root, 'index.js'), 'utf8');
let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)}${ok ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const M = (mes, extra = {}) => ({ mes, name: 'Her', is_user: false, is_system: false, ...extra });
const HDR = (loc) => `[ 🕰️ 9:00 AM | ☀️ Monday, August 3, 2026 | 📍 ${loc} | ☀️ 20°C ]`;

// --- lastBgLoc advances even when the engine declines -------------------------------
// index.js assigns it OUTSIDE the `if (v.file)` block. Modelling it inside changed the
// corpus change-count, and modelling it as "only when the header is non-empty" reported
// 23 unguarded headerless changes when the real number is 3.
{
  // Three messages: a header, then two headerless. With lastBgLoc advancing correctly the
  // second headerless message sees loc === lastBgLoc === '' and cannot claim "the location
  // changed". `changes.length <= 2` passed either way — a hollow assertion — so this
  // asserts the exact set.
  const changes = [];
  replay(src, [
    M(`${HDR('the kitchen')}\n\nShe put the kettle on.`),
    // Both headerless, both scoring 3 for DIFFERENT rooms. With lastBgLoc advancing
    // correctly, message 2 sees loc === lastBgLoc === '' and is blocked. Modelled as
    // "only advance on a non-empty header", lastBgLoc stays 'the kitchen' and message 2
    // looks like a location change — which is how 3 real headerless changes became 23.
    M('She put the kettle on the stove and rinsed the pan in the sink.'),
    M('He set the mug on the desk beside the keyboard and the filing cabinet.'),
  ], (e) => { if (e.bgChanged) changes.push(e.i); });
  eq('message 2 cannot re-claim "location changed"', changes.includes(2), false);
}
// --- the wardrobe rebuild includes the caller's day rollover ------------------------
// Calling WARDROBE.scan directly skips it, which reported accessories and shoes as the
// stalest categories — exactly the ones the rollover clears.
{
  let last = '';
  replay(src, [
    M(`${HDR('the kitchen')}\n\nShe pulled her coat on.`),
    M(`[ 🕰️ 9:00 AM | ☀️ Tuesday, August 4, 2026 | 📍 the kitchen | ☀️ 20°C ]\n\nShe poured the tea.`),
  ], (e) => { last = e.worn; });
  eq('the day rollover runs in the replay', /coat/.test(last), false);
}
// --- planning blocks are stripped before any engine sees the text -------------------
{
  let worn = '';
  replay(src, [M(`${HDR('the kitchen')}\n\n<details>she pulls on a red coat</details>She poured the tea.`)],
    (e) => { worn = e.worn; });
  eq('a <details> block cannot dress her', /coat/.test(worn), false);
}
// --- user and system messages are skipped ------------------------------------------
{
  const seen = [];
  replay(src, [
    M(`${HDR('the kitchen')}\n\nShe put the kettle on.`),
    M('I said something.', { is_user: true }),
    M('System note.', { is_system: true }),
  ], (e) => seen.push(e.i));
  eq('only AI messages are visited', seen, [0]);
}
// --- the engines are the shipped ones, not copies -----------------------------------
{
  const E = loadEngines(src);
  eq('all six engines load', Object.keys(E).sort(),
    ['ATLAS', 'BACKGROUND', 'MOOD', 'POSE', 'PRESENCE', 'WARDROBE']);
  eq('locationRegex is the shipped default', Boolean(defaultRegex(src, 'locationRegex')), true);
  eq('stripPlanning drops an unclosed block', stripPlanning('a <details>b').trim(), 'a');
}
console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

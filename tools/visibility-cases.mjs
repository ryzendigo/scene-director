// Hiding the tab calls clearAllTimeouts() (twice over: onVisibilityChange, and
// applyPrivacy when hideWhenTabHidden is on). Cancelling pending work for a page
// nobody is looking at is right — but assertExpression()'s blank-sprite retry is the
// ONLY recovery path for a sprite that failed to draw, and it waits 3.2s.
//
//   node tools/visibility-cases.mjs [path/to/index.js]
//
// Hiding inside that window — common while a page is still loading, which is exactly
// when a sprite is most likely to be blank — killed the retry, and nothing re-checked
// on the way back, so the sprite stayed blank for the rest of the session.
//
// The restore branch is LIFTED from index.js so this cannot drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const m = /function onVisibilityChange\(\) \{[\s\S]*?\n    \}/.exec(src);
if (!m) { console.error('onVisibilityChange not found in ' + file); process.exit(2); }

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.log(`FAIL  ${name}`); } else console.log(`PASS  ${name}`); };

// Run the real handler against a fake page.
function run({ hidden, blank, label }) {
  const calls = { asserted: null, idleStarted: false, cleared: false, kenBurns: false };
  const fn = new Function(
    'document', 'stopIdleLoop', 'clearAllTimeouts', 'startIdleLoop', 'getSettings',
    'updateKenBurns', 'SillyTavern', 'lastMoodLabel', 'lastMoodLabelFromChat',
    'spriteIsBlank', 'assertExpression', 'dbg', 'lastActivityTs',
    `return (${m[0]});`,
  )(
    { hidden },
    () => {}, () => { calls.cleared = true; }, () => { calls.idleStarted = true; },
    () => ({ enableIdlePresence: true, enableTypingPresence: false }),
    () => { calls.kenBurns = true; },
    { getContext: () => ({}) },
    label, () => label,
    () => blank,
    (ctx, l) => { if (!l) return; calls.asserted = l; },   // mirrors assertExpression's own `if (!label) return`
    () => {}, 0,
  );
  fn();
  return calls;
}

// Hiding still cancels — the saving is the point, do not regress it.
check('hiding cancels pending timers', run({ hidden: true, blank: true, label: 'joy' }).cleared === true);
check('hiding does not re-assert', run({ hidden: true, blank: true, label: 'joy' }).asserted === null);

// Restoring recovers a blank sprite.
check('restore re-asserts a BLANK sprite', run({ hidden: false, blank: true, label: 'joy' }).asserted === 'joy');

// ...but must not touch a healthy one, or it would cause a visible swap on every
// tab switch, which is worse than the bug.
check('restore leaves a healthy sprite alone', run({ hidden: false, blank: false, label: 'joy' }).asserted === null);

// With no known label there is nothing to assert — must not guess. NOTE: dropping the
// `label &&` from the caller is an EQUIVALENT mutation, because assertExpression itself
// starts `if (!label) return;`. The contract being pinned is the OUTCOME (nothing is
// asserted), not which of the two guards enforces it.
check('restore does nothing with no label', run({ hidden: false, blank: true, label: null }).asserted === null);

// The existing restore behaviour must survive.
check('restore still starts the idle loop', run({ hidden: false, blank: false, label: 'joy' }).idleStarted === true);
check('restore still refreshes ken burns', run({ hidden: false, blank: false, label: 'joy' }).kenBurns === true);

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

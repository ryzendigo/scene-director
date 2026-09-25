// `await sleep(n)` must never be cancellable. A timer routed through sdTimeout goes into
// the registry, and clearAllTimeouts() — which applyPrivacy() calls every time the tab
// hides — cancels it. If that timer was the promise's only resolver, the promise is left
// PERMANENTLY unresolved and the awaiting function never continues.
//
//   node tools/sleep-cases.mjs [path/to/index.js]
//
// Concretely: applyBackground() awaits a 200ms crossfade pause. Before this fix, hiding
// the tab mid-message abandoned everything after that await — the weather overlay, the
// sprite filter and the costume switch — silently, for that message. Four other sites
// (prefetch retries, the prefetch pacer, the starter-pack pacer) had the same shape.
//
// Both the helper and the registry are LIFTED from index.js so this cannot drift.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const lift = (re, what) => { const m = re.exec(src); if (!m) { console.error(`${what} not found in ${file}`); process.exit(2); } return m[0]; };
const sleepFn = lift(/function sleep\(ms\) \{[\s\S]*?\n    \}/, 'sleep()');
const tn = /function (sdTimeout|rTimeout)\(fn, ms\) \{/.exec(src);
if (!tn) { console.error('no tracked-timer helper found in ' + file); process.exit(2); }
const TIMER = tn[1];
const sdFn = lift(new RegExp(`function ${TIMER}\\(fn, ms\\) \\{[\\s\\S]*?\\n    \\}`), TIMER + '()');
const clearFn = lift(/function clearAllTimeouts\(\) \{[\s\S]*?\n    \}/, 'clearAllTimeouts()');

const env = new Function(`
  const pendingTimeouts = new Set();
  ${sdFn}
  ${clearFn}
  ${sleepFn}
  return { sleep, sdTimeout: ${TIMER}, clearAllTimeouts, size: () => pendingTimeouts.size };
`)();

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.log(`FAIL  ${name}`); } else console.log(`PASS  ${name}`); };

// 1. sleep() resolves normally.
{
  const t0 = Date.now();
  await env.sleep(40);
  check('sleep resolves', Date.now() - t0 >= 35);
}

// 2. sleep() does NOT enter the cancellable registry.
{
  const before = env.size();
  const p = env.sleep(60);
  const during = env.size();
  await p;
  check('sleep does not register a cancellable timer', during === before);
}

// 3. The invariant: a clearAllTimeouts() mid-sleep must not hang the awaiting code.
{
  let finished = false;
  const work = (async () => { await env.sleep(150); finished = true; return 'done'; })();
  setTimeout(() => env.clearAllTimeouts(), 40);          // a tab-hide 40ms in
  const race = await Promise.race([work, new Promise((r) => setTimeout(() => r('HUNG'), 600))]);
  check('a tab-hide mid-sleep does not hang the awaiting function', race === 'done' && finished);
  if (race === 'HUNG') console.log('      the promise was never resolved — the bug is back');
}

// 4. Contrast: the OLD shape really does hang, so case 3 is meaningful rather than vacuous.
{
  let finished = false;
  const work = (async () => { await new Promise((r) => env.sdTimeout(r, 150)); finished = true; return 'done'; })();
  setTimeout(() => env.clearAllTimeouts(), 40);
  const race = await Promise.race([work, new Promise((r) => setTimeout(() => r('HUNG'), 600))]);
  check('the old sdTimeout shape DOES hang (proves the test is not vacuous)', race === 'HUNG' && !finished);
}

// 5. No awaited sleep may still be routed through sdTimeout anywhere in the file.
{
  const re = new RegExp(`await new Promise\\([^)]*\\)\\s*=>\\s*${TIMER}|await new Promise\\(function \\([^)]*\\) \\{ ${TIMER}`, 'g');
  const bad = [...src.matchAll(re)];
  check(`no awaited promise resolved by ${TIMER} (${bad.length} found)`, bad.length === 0);
}

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

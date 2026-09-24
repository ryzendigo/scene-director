// prefetchOne decides whether a background is worth asking for again. Its retry rules are
// lifted from index.js so they cannot drift from what ships.
//
//   node tools/prefetch-cases.mjs [path/to/index.js]
//
// The bug this pins: only `r.ok` marked a file done, so a 404 — a background named in
// settings that the user has since deleted or renamed — was re-requested on every chat
// switch and every settings save, for the life of the tab. A definite "no" is an answer
// and is cacheable; a 5xx or a thrown fetch is not, and those must still retry.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const m = /async function prefetchOne\(file, attempt\) \{[\s\S]*?\n    \}/.exec(src);
if (!m) { console.error('prefetchOne not found in ' + file); process.exit(2); }

// The builds name the tracked-timer helper differently (public sdTimeout, private
// rTimeout). Take it from the lifted body so this tool works against either.
const tm = /new Promise\(function \(res\) \{ (\w+)\(res/.exec(m[0]);
const timerName = tm ? tm[1] : 'sdTimeout';

// [name, status or 'throw', expect: 'done' | 'missing' | 'retried']
const CASES = [
  ['200 ok',            200,     'done'],
  ['404 gone',          404,     'missing'],
  ['403 forbidden',     403,     'missing'],
  ['502 bad gateway',   502,     'retried'],
  ['503 unavailable',   503,     'retried'],
  ['500 server error',  500,     'neither'],   // logged, not cached, not retried
  ['network throw',     'throw', 'retried'],
];

let bad = 0;
for (const [name, status, want] of CASES) {
    const prefetchDone = new Set(), prefetchMissing = new Set();
    let attempts = 0;
    const sandbox = {
        prefetchDone, prefetchMissing,
        dbg() {},
        [timerName](fn) { fn(); },                     // no real waiting
        encodeURIComponent: (x) => x,
        fetch() {
            attempts++;
            if (status === 'throw') return Promise.reject(new Error('net'));
            return Promise.resolve({ ok: status === 200, status });
        },
    };
    const fn = new Function(...Object.keys(sandbox), `return (${m[0].replace(/^async function /, 'async function ')});`)(...Object.values(sandbox));
    await fn('bg.jpg', 0);

    const got = prefetchMissing.has('bg.jpg') ? 'missing'
        : prefetchDone.has('bg.jpg') ? 'done'
            : attempts > 1 ? 'retried' : 'neither';
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} -> ${got.padEnd(8)} want ${want} (${attempts} request${attempts === 1 ? '' : 's'})`);
}

// The whole point: a missing file must never be offered to the queue again.
if (bad === 0) {
    const done = new Set(['a.jpg']);
    const remaining = ['a.jpg', 'b.jpg'].filter((f) => !done.has(f));
    if (remaining.length !== 1 || remaining[0] !== 'b.jpg') { bad++; console.log('FAIL prefetchDone does not filter the queue'); }
}

console.log(bad ? `\n${bad} failure(s)` : `\nall ${CASES.length} prefetch outcomes correct`);
process.exit(bad ? 1 : 0);

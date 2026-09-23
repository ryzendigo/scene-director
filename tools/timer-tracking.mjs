// Every setTimeout must either go through the tracked sdTimeout registry, or be
// a deliberate exception that says why. The registry exists so CHAT_CHANGED and
// page-hide can cancel pending work (index.js: "every setTimeout is tracked").
//
// Two legitimate reasons to opt out, and the code must state one of them:
//   - the timer holds its id in a named variable and is explicitly clearTimeout'd
//     (it manages its own lifetime, and cancelling it from outside would strand state);
//   - the timer performs cleanup that MUST still run after a chat change —
//     cancelling it would orphan a DOM node or leave a flag stuck.
//
// A bare setTimeout with neither property is a leak: it survives clearAllTimeouts()
// and fires against a chat the user has already left.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

// A call is exempt if the line assigns the id to something we can later clear,
// or the 3 lines above it carry an explicit untracked-on-purpose note.
// Structural, not name-based: the id is stored somewhere it can be cleared from.
const ASSIGNS = /(?:(?:const|let|var)\s+)?[\w$]+(?:\.[\w$]+)*\s*=\s*setTimeout\(/;
// `await new Promise(r => setTimeout(r, n))` — the awaiting code is what gets abandoned,
// and the timer only resolves a promise; there is nothing stale to act on.
const AWAITED = /new Promise\([^)]*\)\s*=>\s*setTimeout\(|new Promise\(function\s*\([^)]*\)\s*\{\s*setTimeout\(/;
// A deliberate marker phrase, not merely prose mentioning tracking — an explanatory
// comment that happens to use the word "untracked" must NOT exempt the line below it.
const NOTE = /\bUntracked on purpose\b/;

const offenders = [];
lines.forEach((line, i) => {
    if (!/\bsetTimeout\(/.test(line)) return;
    if (/function sdTimeout/.test(line)) return;
    if (/const id = setTimeout/.test(line)) return;      // sdTimeout's own body
    if (ASSIGNS.test(line)) return;                       // self-managing
    if (AWAITED.test(line)) return;                       // promise resolver only
    const above = lines.slice(Math.max(0, i - 4), i).join('\n');
    if (NOTE.test(above)) return;                         // documented exception
    offenders.push([i + 1, line.trim().slice(0, 100)]);
});

if (offenders.length) {
    console.log(`untracked setTimeout calls with no stated reason: ${offenders.length}`);
    for (const [n, t] of offenders) console.log(`  ${file.split('/').pop()}:${n}  ${t}`);
    console.log('\nEither route it through sdTimeout(), hold the id and clearTimeout it,');
    console.log('or add a comment saying why it must survive a chat change.');
    process.exit(1);
}
console.log('all setTimeout calls tracked or documented');

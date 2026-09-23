// Every `gen !== chatGen` guard needs a `const gen = chatGen` capture in the SAME
// function, taken before the first await. A guard without its capture is a
// ReferenceError at runtime, and a capture without a guard is dead weight.
//
// This exists because a .replace() that matched nothing once left a guard behind
// with no capture — the file still parsed, and only a grep caught it.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

// Function starts at any top-level `function name(` / `async function name(`.
const starts = [];
lines.forEach((l, i) => { if (/^\s{4}(async )?function [a-zA-Z_]/.test(l)) starts.push(i); });
const fnOf = (i) => { let f = -1; for (const s of starts) { if (s <= i) f = s; else break; } return f; };

const captures = new Set(), guards = new Map();
lines.forEach((l, i) => {
    if (/const gen = chatGen\s*;/.test(l)) captures.add(fnOf(i));
    if (/gen !== chatGen/.test(l)) guards.set(i + 1, fnOf(i));
});

const problems = [];
for (const [line, fn] of guards) {
    if (!captures.has(fn)) {
        problems.push(`line ${line}: guard with no "const gen = chatGen" in ${fn < 0 ? '(top level)' : lines[fn].trim().slice(0, 60)}`);
    }
}
for (const fn of captures) {
    if (![...guards.values()].includes(fn)) {
        problems.push(`${lines[fn].trim().slice(0, 60)}: captures chatGen but never checks it`);
    }
}
// The counter has to actually move, or every guard is a no-op.
if (guards.size && !/chatGen\+\+/.test(src)) problems.push('chatGen is never incremented — every guard is a no-op');

// The invariant the guards exist for: inside a function that captures chatGen, an
// `await` must not be followed by a write to per-chat state without a guard in
// between. getContext()/chatMeta() resolve live, so such a write lands on whatever
// chat is open when the handler resumes.
const PER_CHAT_WRITE = /^\s*(lastBg|lastBgLoc|lastBgGraded|lastCostume|trailDateKey|trailLocs)\s*=[^=]|^\s*meta\.(lastCostume|trailDateKey|trailLocs)\s*=/;
for (const fnStart of captures) {
    // Walk this function's body to its end (next function start, or EOF).
    const next = starts.find((x) => x > fnStart);
    const end = next === undefined ? lines.length : next;
    let sawAwait = false, guardSince = true;
    for (let i = fnStart; i < end; i++) {
        const l = lines[i];
        if (/\bawait\b/.test(l)) { sawAwait = true; guardSince = false; }
        if (/gen !== chatGen/.test(l)) guardSince = true;
        if (sawAwait && !guardSince && PER_CHAT_WRITE.test(l)) {
            problems.push(`line ${i + 1}: "${l.trim().slice(0, 50)}" writes per-chat state after an await with no guard`);
            guardSince = true;   // report once per run of writes
        }
    }
}

if (problems.length) {
    console.log(`chat-generation guard problems: ${problems.length}`);
    for (const p of problems) console.log('  ' + p);
    process.exit(1);
}
console.log(`chat-gen guards consistent (${guards.size} guard(s), ${captures.size} capture(s))`);

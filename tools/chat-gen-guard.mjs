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

if (problems.length) {
    console.log(`chat-generation guard problems: ${problems.length}`);
    for (const p of problems) console.log('  ' + p);
    process.exit(1);
}
console.log(`chat-gen guards consistent (${guards.size} guard(s), ${captures.size} capture(s))`);

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
// Capture the target so we can check it is clearable from OUTSIDE its own
// rescheduling site. `x = setTimeout(...)` right after `clearTimeout(x)` is only a
// DEBOUNCE, not a cancellable timer: nothing else can stop it, so it still fires
// against a chat the user has left. That is exactly how moodState.pending shipped
// a stale /emote across a chat switch (v0.9.66).
const ASSIGNS = /(?:(?:const|let|var)\s+)?([\w$]+(?:\.[\w$]+)*)\s*=\s*setTimeout\(/;
// `await new Promise(r => setTimeout(r, n))` — the awaiting code is what gets abandoned,
// and the timer only resolves a promise; there is nothing stale to act on.
const AWAITED = /new Promise\([^)]*\)\s*=>\s*setTimeout\(|new Promise\(function\s*\([^)]*\)\s*\{\s*setTimeout\(/;
// A deliberate marker phrase, not merely prose mentioning tracking — an explanatory
// comment that happens to use the word "untracked" must NOT exempt the line below it.
const NOTE = /\bUntracked on purpose\b/;

// Is `name` clearTimeout'd from OUTSIDE the function that schedules it? A clear in
// the same function is the timer cancelling its own previous self — a debounce.
// Nothing else can stop it, so it still fires against a chat the user has left.
const fnStarts = [];
lines.forEach((l, i) => { if (/^\s{0,8}(async )?function [a-zA-Z_$]/.test(l)) fnStarts.push(i); });
const fnOf = (i) => { let f = -1; for (const s of fnStarts) { if (s <= i) f = s; else break; } return f; };
function clearedElsewhere(name, schedIdx) {
    const re = new RegExp('clearTimeout\\(\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\)');
    const home = fnOf(schedIdx);
    return lines.some((l, i) => re.test(l) && fnOf(i) !== home);
}

const offenders = [];
lines.forEach((line, i) => {
    if (!/\bsetTimeout\(/.test(line)) return;
    if (/function sdTimeout/.test(line)) return;
    if (/const id = setTimeout/.test(line)) return;      // sdTimeout's own body
    const asg = ASSIGNS.exec(line);
    if (asg && clearedElsewhere(asg[1], i)) return;       // genuinely cancellable
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
// The INVERSE mistake, which shipped three times before being noticed (v0.9.83): a
// TRACKED timer whose body only hides or removes something. clearAllTimeouts() then
// strands the thing it was going to clean up — the opposite of saving work. Cleanup
// timers belong untracked, with the marker, like the sprite ghost's removal.
// The builds name the tracked-timer helper differently (public sdTimeout, private
// rTimeout). Hardcoding one made this check pass on a build that had the very bug.
const TRACKED = (/function (sdTimeout|rTimeout)\(/.exec(src) || [, 'sdTimeout'])[1];
const CLEANUP_BODY = /\.remove\(\)|display = 'none'|classList\.add\('[^']*-out'\)|revokeObjectURL/;
const suspects = [];
lines.forEach((line, i) => {
    if (!new RegExp('\\b' + TRACKED + '\\(').test(line) || new RegExp('function ' + TRACKED).test(line)) return;
    const body = lines.slice(i, i + 3).join(' ');
    if (!CLEANUP_BODY.test(body)) return;
    // A cleanup that only touches the settings panel's own transient text is fine:
    // the next save overwrites it, so a cancel costs nothing.
    if (/textContent/.test(body) && /Saved\./.test(body)) return;
    suspects.push([i + 1, line.trim().slice(0, 90)]);
});
if (suspects.length) {
    console.log(`tracked timers that only clean up (cancelling strands the thing): ${suspects.length}`);
    for (const [n, t] of suspects) console.log(`  ${file.split('/').pop()}:${n}  ${t}`);
    console.log('\nA cleanup timer belongs on a bare setTimeout with the marker — clearAllTimeouts()');
    console.log('would otherwise orphan the element or leave the overlay on screen.');
    process.exit(1);
}

console.log('all setTimeout calls tracked or documented');

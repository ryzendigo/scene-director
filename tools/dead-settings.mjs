#!/usr/bin/env node
// A settings key that the panel exposes but nothing reads is worse than dead code:
// the user types into it and reasonably expects an effect. `moodKeywords` shipped that
// way from 23 Sep to 24 Sep — the commit "Remove dead code left behind by the 0.6.0
// mood-engine rewrite" deleted detectMoodLegacy(), its only reader, and left the
// default, the validator, the settings row and the save path in place.
//
//   node tools/dead-settings.mjs [path/to/index.js]
//
// PUBLIC BUILD ONLY. The private build uses a different settings mechanism
// (SETTINGS_KEY / setting()) with no `defaultSettings` literal, so this exits 2
// there rather than reporting a false all-clear. Both stranded keys found on
// 24 Sep were public-only anyway — the private build never had either.
//
// A key counts as READ if it appears anywhere outside the four scaffolding sites:
// the defaultSettings literal, the VALIDATORS table, the settings-row tables, and
// the save loop. That is deliberately generous — this should never cry wolf over a
// key read in some form the regex did not predict.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

// Every top-level key of defaultSettings, with the line it is declared on.
const dm = /const defaultSettings = (\{[\s\S]*?\n    \});/.exec(src);
if (!dm) { console.error('defaultSettings not found'); process.exit(2); }
const declStart = src.slice(0, dm.index).split('\n').length;
const declEnd = declStart + dm[0].split('\n').length;
// PARSE the literal rather than regexing it. A line-anchored /^\s{8}(\w+):/ captures only
// the FIRST key on each line, so the five settings that share a line with a neighbour were
// never checked; and a nesting-blind regex is worse, it dives into moodEmoji's mood labels.
let keys;
try { keys = Object.keys((0, eval)('(' + dm[1] + ')')); }
catch (e) { console.error('could not parse defaultSettings: ' + e.message); process.exit(2); }

// Scaffolding regions: the declaration, the validator table, and the row tables.
// A mention inside these does not prove anyone consumes the value.
const regions = [[declStart, declEnd]];
const missing = [];
for (const re of [/\bconst validators = \{/, /\bconst JSON_FIELDS = \[/, /\bconst TOGGLE_FIELDS = \[/, /\bconst REGEX_FIELDS = \[/, /\bconst NUMBER_FIELDS = \[/]) {
    const m = re.exec(src);
    if (!m) { missing.push(String(re)); continue; }
    const start = src.slice(0, m.index).split('\n').length;
    // Walk to the matching close at the same indent.
    let depth = 0, end = start;
    for (let i = start - 1; i < lines.length; i++) {
        for (const c of lines[i]) { if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') depth--; }
        if (depth <= 0 && i > start - 1) { end = i + 2; break; }
    }
    regions.push([start, end]);
}
const inScaffold = (ln) => regions.some(([a, b]) => ln >= a && ln < b);

// The save loop names keys in a ternary; that is scaffolding too, not a read.
const SAVE_LINE = /document\.getElementById\(`sd_\$\{key\}`\)/;

const dead = [];
for (const key of keys) {
    const re = new RegExp(`\\b${key}\\b`);
    let read = false;
    for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const ln = i + 1;
        if (inScaffold(ln)) continue;
        if (SAVE_LINE.test(lines[i])) continue;
        if (/^\s*\/\//.test(lines[i])) continue;      // a comment is not a reader
        if (/id="sd_|id=`sd_|getElementById\('sd_/.test(lines[i])) continue; // the panel input itself
        read = true;
        break;
    }
    if (!read) dead.push(key);
}

// A scaffold table this tool could not find means its mentions count as reads, which
// is how the first version of this check passed on the very bug it was written for.
if (missing.length) {
    console.log('scaffold table(s) not found — the check would under-report:');
    for (const r of missing) console.log('  ' + r);
    process.exit(2);
}

// The inverse: a key READ off settings but never declared in defaultSettings is
// permanently undefined, so a `!== false` test is stuck true and getSettings() cannot
// backfill it. That is how `userIsMale` shipped with no way to turn it off.
const readNotDeclared = new Set();
for (const mm of src.matchAll(/\bsettings\.([A-Za-z_$][\w$]*)\b/g)) {
    if (!keys.includes(mm[1])) readNotDeclared.add(mm[1]);
}
if (readNotDeclared.size) {
    console.log(`settings read but never declared in defaultSettings: ${readNotDeclared.size}`);
    for (const k of readNotDeclared) console.log(`  settings.${k}`);
    console.log('\nSuch a key is always undefined — add it to defaultSettings (and a row, if the user should control it).');
    process.exit(1);
}

if (dead.length) {
    console.log(`settings keys the panel exposes but nothing reads: ${dead.length}`);
    for (const k of dead) console.log(`  ${k}`);
    console.log('\nEither wire up a reader, or remove the default, validator, row and save entry.');
    process.exit(1);
}
console.log(`every settings key has a reader (${keys.length} checked)`);

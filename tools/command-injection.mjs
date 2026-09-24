// Every slash command this extension runs is built by interpolation, and all three
// interpolated values are user-controlled:
//   /bg ${file}                  — background filenames come from settings
//   /emote ${label}              — mapped from the installed sprite set
//   /costume ${name}/${folder}   — character name from the card, folder from settings
//
// The settings Import button accepts a places/seasonalMap/eraRules blob without running
// any validator (see tools/import-typecheck.mjs), so a shared settings export could put
// `a.jpg | /send owned` in a background slot. ST's parser treats `|` as a command
// separator and `{{...}}` as macro substitution, so that ran a second command.
//
//   node tools/command-injection.mjs [path/to/index.js]
//
// The guard is LIFTED from index.js so this cannot drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const m = /const CMD_UNSAFE_RE = (\/[^\n]+?\/);/.exec(src);
if (!m) { console.error('CMD_UNSAFE_RE not found in ' + file + ' — is the guard still there?'); process.exit(2); }
const UNSAFE = eval(m[1]);
const safe = (v) => !UNSAFE.test(String(v == null ? '' : v));

// Every call site must route through the guard, or a new one silently reopens this.
const callSites = [...src.matchAll(/runCommand\(ctx,/g)].length;
const guardInRunCommand = /async function runCommand\([\s\S]{0,600}?cmdArgIsSafe\(cmd\)/.test(src);

const CASES = [
  // [command, must be allowed]
  ['/bg bedroom-night.jpg', true],
  ['/bg Living Room (day).jpg', true],      // spaces and parens are real, and fine
  ['/bg generic-cafe-day.jpg', true],
  ['/emote joy', true],
  ['/emote neutral', true],
  ['/costume Elise/nightgown', true],
  ['/costume', true],
  ['/bg a.jpg | /send owned', false],       // the original injection
  ['/bg a.jpg || /run x', false],
  ['/bg {{user}}.jpg', false],              // macro substitution
  ['/emote joy\n/send hi', false],          // newline as a separator
  ['/emote joy\r/send hi', false],
  ['/costume Bob|/run x/nightgown', false], // injection via the CHARACTER NAME
  ['/costume {{char}}/nightgown', false],
];

let bad = 0;
for (const [cmd, want] of CASES) {
  const got = safe(cmd);
  if (got !== want) { bad++; console.log(`FAIL ${JSON.stringify(cmd)} -> ${got ? 'allowed' : 'refused'}, want ${want ? 'allowed' : 'refused'}`); }
}
if (!guardInRunCommand) { bad++; console.log('FAIL runCommand does not call cmdArgIsSafe(cmd) — the guard is not on the chokepoint'); }
if (callSites < 3) { bad++; console.log(`FAIL expected the known runCommand call sites, found ${callSites}`); }

console.log(bad ? `\n${bad} failure(s)` : `all ${CASES.length} commands classified correctly, guard on the chokepoint (${callSites} call sites)`);
process.exit(bad ? 1 : 0);

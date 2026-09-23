// Patterns that exist in more than one place must not drift apart. v0.9.62 happened
// exactly this way: rainRegex was taught to see 🌧 in defaultSettings while an identical
// copy inside the BACKGROUND engine was missed, so the rain overlay came on while the
// background stayed dry — the two halves of one feature disagreeing.
//
// Some duplication is deliberate: each pure engine is self-contained so it can be lifted
// on its own, which means MOOD and PRESENCE both carry their own <details> stripper. That
// is fine as long as the copies MATCH. This checks the pairs that must agree.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

// Each entry: a name, and the regexes that extract every copy. All copies must be equal.
const PAIRS = [
  // The private build names its copy RAIN_RE rather than holding it in settings, so accept
  // either spelling — otherwise this reports SKIP there and the real check never runs.
  { name: 'rain matcher', note: 'scene.raining vs the -rain FILE pick (engine)',
    finds: [/rainRegex: '([^']+)'/, /const RAIN_RE = \/([^/]+)\//,
      /const rain = \/([^/]+)\/\.test\(weatherLower/] },
  { name: 'graded variant', note: 'baseOf() in the engine vs the overlay suppression test',
    finds: [/const GRADED_VARIANT_RE = \/([^/]+)\//, /const VARIANT_RE = \/([^/]+)\//] },
  { name: 'details strip', note: 'module stripPlanning vs the MOOD and PRESENCE copies',
    finds: [/function stripPlanning\(raw\) \{ return String\(raw \|\| ''\)\.replace\(\/([^/]+)\//,
      /const DETAILS_RE = \/([^/]+)\//g] },
  { name: 'think strip', note: 'MOOD vs PRESENCE',
    finds: [/const THINK_RE = \/([^/]+)\//g] },
  // Only the two ENGINE copies must match. The private build also has a module-level
  // HEADER_LINE_RE = /📍/ — a different job (a cheap "does this line contain a header"
  // test, used per-line) that happens to share the name, so an unqualified search
  // reported it as drift. Anchor on the engines' 8-space indentation.
  { name: 'header line', note: 'MOOD vs PRESENCE (engine copies only)',
    finds: [/\n {8}const HEADER_LINE_RE = \/([^/]+)\//g] },
  { name: 'font colour', note: 'MOOD vs PRESENCE',
    finds: [/const FONT_ANY_RE = \/([^/]+)\//g] },
];

let bad = 0;
for (const p of PAIRS) {
  const found = [];
  for (const re of p.finds) {
    if (re.global) { for (const m of src.matchAll(re)) found.push(m[1]); }
    else { const m = re.exec(src); if (m) found.push(m[1]); }
  }
  if (found.length < 2) {
    console.log(`SKIP  ${p.name.padEnd(16)} found ${found.length} cop${found.length === 1 ? 'y' : 'ies'} — pattern moved or renamed?`);
    bad++;
    continue;
  }
  const same = found.every((f) => f === found[0]);
  if (!same) bad++;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${p.name.padEnd(16)} ${found.length} copies  ${p.note}`);
  if (!same) for (const f of found) console.log(`        /${f.slice(0, 70)}/`);
}
console.log(bad ? `\n${bad} pattern group(s) have drifted or gone missing` : `\nall ${PAIRS.length} duplicated patterns agree`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
// Report keywords claimed by more than one scene key in the BackgroundEngine tables.
//
// Both tables are ORDERED lists of [key, 'alt|alt|alt'] — "specific venues first, broad room and
// street words last". That ordering is the whole tie-break: whichever row matches first wins. So a
// token claimed by two keys is a latent bug, because the winner is decided by table position rather
// than by meaning, and nothing fails when it is wrong.
//
// Found on 23 Sep, all four shipping: 'bench' scored park in a kitchen scene, 'monitor' scored
// hospital in an office, '📍 dorm room' resolved to the campus exterior, and '📍 university campus'
// resolved to a classroom interior.
//
// A collision is not automatically wrong — 'resort' is shared by hotel and snow, and "ski resort"
// correctly reaches snow because snow is ordered first. Check each one against the engine before
// changing it; background-cases.mjs pins the ones that matter.
//
//   node tools/keyword-collisions.mjs [path/to/index.js]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || join(root, 'index.js');
const src = readFileSync(file, 'utf8');

let total = 0;
for (const name of ['DEFAULT_GENERIC', 'DEFAULT_NOUNS']) {
  const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n        \\];').exec(src);
  if (!m) { console.log(`${name}: table not found`); continue; }
  const rows = [...m[1].matchAll(/\['(.*?)',\s*'(.*?)'\]/g)].map(r => [r[1], r[2]]);
  const owner = {};
  for (const [key, pat] of rows) for (const tok of pat.split('|')) (owner[tok] ||= []).push(key);
  const dup = Object.entries(owner).filter(([, k]) => new Set(k).size > 1);
  total += dup.length;
  console.log(`${name}: ${rows.length} keys, ${Object.keys(owner).length} tokens, ${dup.length} shared`);
  for (const [t, k] of dup) {
    const keys = [...new Set(k)];
    // Name the earlier row, but do NOT claim it always wins: a longer, more specific alternative on
    // a later row can still beat it ("resort" is listed first by hotel, yet "ski resort" reaches
    // snow). This flags candidates to check against the engine; it does not predict the verdict.
    console.log(`    ${JSON.stringify(t).padEnd(20)} ${keys.join(', ')}   (earlier row: "${keys[0]}")`);
  }
}
console.log(total ? `\n${total} shared keywords — confirm each resolves correctly before changing it`
                  : '\nno shared keywords');

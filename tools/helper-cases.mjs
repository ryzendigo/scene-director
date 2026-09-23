#!/usr/bin/env node
// Case suite for the pure helpers that live OUTSIDE the engine blocks.
//
//   node tools/helper-cases.mjs [path/to/index.js]
//
// The six engine suites lift a `=== X ENGINE (pure) ===` block, so nothing they do reaches a helper
// defined at module scope. Several of those helpers are pure functions with real edge cases, and
// until 23 Sep none of them had a single test.
//
// Each helper is LIFTED from index.js rather than reimplemented, so this cannot drift from what
// ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(process.argv[2] || join(root, 'index.js'), 'utf8');

function lift(name, args) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(' + args + '\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) { console.error(`${name}() not found in index.js`); process.exit(2); }
  let i = m.index + m[0].length - 1, depth = 0, body = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; body += c; if (depth === 0) break; continue; }
    body += c;
  }
  return eval(`(function (${args}) ${body})`);
}

const spriteFolderAndExt = lift('spriteFolderAndExt', 'src');
const slugify = lift('slugify', 'name');
const uniqueCastKey = lift('uniqueCastKey', 'base, cast');

const CASES = [];
const eq = (label, got, want) => CASES.push([label, JSON.stringify(got), JSON.stringify(want)]);

// spriteFolderAndExt — 23 Sep: the query string was stripped AFTER the last dot was located, so a
// cache-buster containing a dot took the extension from it. SillyTavern's own buster is a plain
// timestamp, so this never fired in practice, but any other value would have sent every variant
// lookup after a file that cannot exist.
eq('plain png', spriteFolderAndExt('/characters/E/neutral.png'), { folder: '/characters/E/', ext: '.png' });
eq('ST cache-buster', spriteFolderAndExt('/characters/E/neutral.png?t=20260913063132'), { folder: '/characters/E/', ext: '.png' });
eq('dotted query', spriteFolderAndExt('/characters/E/neutral.webp?v=1.5'), { folder: '/characters/E/', ext: '.webp' });
eq('dotted query, png', spriteFolderAndExt('/characters/E/happy.png?cache=v2.1.3'), { folder: '/characters/E/', ext: '.png' });
eq('fragment', spriteFolderAndExt('/characters/E/neutral.png#x'), { folder: '/characters/E/', ext: '.png' });
eq('no extension', spriteFolderAndExt('/characters/E/neutral?t=1'), { folder: '/characters/E/', ext: '.png' });
eq('empty', spriteFolderAndExt(''), { folder: '', ext: '.png' });

// slugify + uniqueCastKey — every lookup is cast.find(m => m.key === k) and presence is a Map keyed
// by it, so a collision makes the second member permanently unreachable.
eq('slug basic', slugify('New member'), 'new-member');
eq('slug punctuation', slugify('Anne-Marie'), 'anne-marie');
eq('slug spaces match punctuation', slugify('Anne Marie'), 'anne-marie');
eq('slug no latin letters', slugify('李'), 'member');
eq('slug empty', slugify(''), 'member');

const cast = [];
for (const label of ['New member', 'New member', 'New member', 'Anne-Marie', 'Anne Marie']) {
  cast.push({ key: uniqueCastKey(slugify(label), cast), label });
}
eq('keys are unique', cast.map(m => m.key), ['new-member', 'new-member-2', 'new-member-3', 'anne-marie', 'anne-marie-2']);
eq('first keeps its key', cast[0].key, 'new-member');   // sprite folders are named after it
eq('empty cast', uniqueCastKey('bob', []), 'bob');
eq('non-array cast', uniqueCastKey('bob', null), 'bob');

let fails = 0;
for (const [label, got, want] of CASES) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)}${ok ? '' : ` got ${got} want ${want}`}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

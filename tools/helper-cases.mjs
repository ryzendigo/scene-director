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

// Some helpers close over module-level constants. Pull those in first so a lifted function can see
// them, the same way it does in the running extension.
let CONSTS = '';
for (const c of ['DAY_NAMES', 'MON_NAMES', 'MONTHS', 'WS_RE', 'WX_ICON_RE']) {
  const m = new RegExp('^\\s+const ' + c + ' = ([\\s\\S]*?);$', 'm').exec(src);
  if (m) CONSTS += `const ${c} = ${m[1]};\n`;
}

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
  return eval(`(function(){${CONSTS} return function (${args}) ${body};})()`);
}

const spriteFolderAndExt = lift('spriteFolderAndExt', 'src');
const parseHourFromMatch = lift('parseHourFromMatch', 'm');
const buildHudParts = lift('buildHudParts', 'scene');
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

// The header clock. 23 Sep: the default timeRegex required a literal ':' and a mandatory AM/PM.
// Measured against 1,548 real headers, 2 used a DOT ("10.05 PM") and produced no time at all.
// parseHourFromMatch already treats a missing meridiem as a 24-hour clock, so the suffix is
// optional now too. These cases drive the SHIPPED default pattern, not a copy of it.
const timeSrc = (/^\s+timeRegex: '((?:[^'\\]|\\.)*)'/m.exec(src) || [])[1];
if (!timeSrc) { console.error('timeRegex default not found'); process.exit(2); }
const timeRe = new RegExp(timeSrc.replace(/\\\\/g, '\\'), 'i');
const hourOf = t => parseHourFromMatch(timeRe.exec(t));
eq('12-hour PM', hourOf('\u{1F570}\uFE0F 10:05 PM'), 22);
eq('12-hour AM', hourOf('\u{1F570}\uFE0F 8:15 AM'), 8);
eq('noon', hourOf('\u{1F570}\uFE0F 12:05 PM'), 12);
eq('midnight', hourOf('\u{1F570}\uFE0F 12:30 AM'), 0);
eq('dot separator', hourOf('\u{1F570}\uFE0F 10.05 PM'), 22);
eq('dot, no space before AM', hourOf('\u{1F570}\uFE0F 6.01AM'), 6);
eq('24-hour, no meridiem', hourOf('\u{1F570}\uFE0F 14:05'), 14);
eq('hour out of range', hourOf('\u{1F570}\uFE0F 25:00'), null);
eq('13 PM is not a time', hourOf('\u{1F570}\uFE0F 13:00 PM'), null);
eq('no clock at all', hourOf('no time here'), null);

// The HUD date label. 23 Sep: new Date(2026, 1, 31) is NOT invalid — it rolls to 3 March — so a
// header reading "February 31" produced "Tue Feb 31 2026", a weekday borrowed from a different
// date printed beside a day that does not exist. parseDateFromText only range-checks 1..31, not
// whether the day exists in that month. The weekday is dropped now rather than invented.
const hudFor = scene => buildHudParts({ headerLine: '[ hdr ]', ...scene });
const dateLabel = (year, month, day) => hudFor({ date: { year, month, day } }).date;
eq('real date keeps its weekday', dateLabel(2026, 1, 15), 'Thu Jan 15 2026');
eq('real leap day keeps it', dateLabel(2024, 2, 29), 'Thu Feb 29 2024');
eq('31 Feb loses the weekday', dateLabel(2026, 2, 31), 'Feb 31 2026');
eq('31 Apr loses the weekday', dateLabel(2026, 4, 31), 'Apr 31 2026');
eq('29 Feb in a common year', dateLabel(2026, 2, 29), 'Feb 29 2026');
eq('month only, no day', hudFor({ date: { year: 2026, month: 8, day: null } }).date, 'Aug 2026');

let fails = 0;
for (const [label, got, want] of CASES) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)}${ok ? '' : ` got ${got} want ${want}`}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

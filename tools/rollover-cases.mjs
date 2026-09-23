// The day-rollover cleanup lives in rebuildWardrobe, NOT in the wardrobe engine, so the
// engine suite cannot reach it: outerwear, accessories and shoes put on before a date
// change come off, while tops and dresses stay until the text says otherwise.
//
// It matters. Replaying the real corpus with and without it changes the answer at 17 of
// 115 sampled positions — a towel still worn hours later, shoes still on the next day.
// Nothing tested it, because it is caller-side.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC_OVERRIDE = (process.argv.find((a) => a.startsWith('--src=')) || '').slice(6) || null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(SRC_OVERRIDE || join(root, 'index.js'), 'utf8');

function engine(tag) {
  const b = `// === ${tag} ENGINE (pure) BEGIN ===`, e = `// === ${tag} ENGINE (pure) END ===`;
  const i = src.indexOf(b);
  if (i < 0) { console.error(tag + ' engine not found'); process.exit(2); }
  return src.slice(i + b.length, src.indexOf(e));
}
const P = 'const LOG="[sd]"; const MAX_SCAN=20000; const console={error(){},warn(){}};\n'
  + 'function dbg(){} function compileRegex(p){try{return new RegExp(p,"i");}catch(e){return null;}}\n';
const W = eval('(function(){' + P + engine('WARDROBE') + '\nreturn WardrobeEngine;})()');

// Lift the caller's rollover condition from index.js so this cannot drift from it.
const cond = /const c = WardrobeEngine\.category\(g\);\s*\n\s*if \(\((c === '[^']+'[^)]*)\)/.exec(src);
if (!cond) { console.log('FAIL  could not find the rollover condition in rebuildWardrobe'); process.exit(1); }
const CLEARS = (cond[1].match(/'(\w+)'/g) || []).map((x) => x.replace(/'/g, ''));

// The private build has no defaultSettings block (different settings mechanism) and its
// date pattern is a constant, so accept either shape rather than crashing on --src.
const d = /const defaultSettings = \{([\s\S]*?)\n    \};/.exec(src);
const fromSettings = d && /^\s+dateRegex: '((?:[^'\\]|\\.)*)'/m.exec(d[1]);
const fromConst = /const DATE_RE = \/([^/]+)\//.exec(src);
if (!fromSettings && !fromConst) {
  console.log('SKIP  no dateRegex in this build — the rollover needs one, so there is nothing to test');
  process.exit(0);
}
const dateRe = new RegExp(fromSettings ? fromSettings[1].replace(/\\\\/g, '\\') : fromConst[1], 'i');

// Replay a short scripted chat through the real rollover logic.
function run(messages) {
  const state = Object.create(null);
  let lastDay = null;
  messages.forEach((text, i) => {
    dateRe.lastIndex = 0;
    const dm = dateRe.exec(text);
    const day = dm ? String(dm[0]).toLowerCase().replace(/\s+/g, ' ') : null;
    if (day && lastDay && day !== lastDay) {
      for (const who of Object.keys(state)) for (const g of Object.keys(state[who])) {
        if (CLEARS.includes(W.category(g)) && state[who][g].at < i) delete state[who][g];
      }
    }
    if (day) lastDay = day;
    W.scan(text, [], state, { at: i, speaker: 'main' });
  });
  return W.describe(state.main) || '';
}
const DAY1 = '📍 the kitchen | Monday, August 3, 2026';
const DAY2 = '📍 the kitchen | Tuesday, August 4, 2026';
let fails = 0;
const CASES = [
  { label: 'coat comes off overnight',
    msgs: [`${DAY1} She pulled her coat on.`, `${DAY2} She poured the tea.`], want: '' },
  { label: 'shoes come off overnight',
    msgs: [`${DAY1} She pulled her boots on.`, `${DAY2} She poured the tea.`], want: '' },
  { label: 'a dress stays across the night',
    msgs: [`${DAY1} She wore a green dress.`, `${DAY2} She poured the tea.`], want: 'green dress' },
  { label: 'a shirt stays across the night',
    msgs: [`${DAY1} She pulled on a white shirt.`, `${DAY2} She poured the tea.`], want: 'white shirt' },
  { label: 'same day keeps the coat',
    msgs: [`${DAY1} She pulled her coat on.`, `${DAY1} She poured the tea.`], want: 'coat' },
  { label: 'a coat put on AFTER the change survives',
    msgs: [`${DAY1} She poured the tea.`, `${DAY2} She pulled her coat on.`], want: 'coat' },
];
for (const c of CASES) {
  const got = run(c.msgs);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(got).padEnd(22)} want ${JSON.stringify(c.want).padEnd(20)} ${c.label}`);
}
console.log(`\nrollover clears: ${CLEARS.join(', ')}`);
console.log(fails ? `${fails} failing` : `all ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

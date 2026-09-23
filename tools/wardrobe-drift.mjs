#!/usr/bin/env node
// Carry wardrobe state across a whole real chat and look for states that cannot be true.
//
//   node tools/wardrobe-drift.mjs <chat.jsonl> [MainName] [UserName]
//
// The case suites check one message at a time and soak.mjs reports rates, so neither can see a bug
// that only emerges over hundreds of messages: a garment nothing ever takes off, "(nothing)" sitting
// beside real clothes, two dresses at once. Both bugs found on 23 Sep were of that kind.
//
// What to look at:
//   impossible states  "(nothing)" with garments beside it, or two of one category at once. These
//                      are always bugs — the engine's own rules say they cannot happen.
//   longest worn       a garment on for hundreds of messages usually means the text that should
//                      have removed it was never matched, OR something recorded a garment that was
//                      never put on. "He pulls his cap lower" recorded a cap worn for 2,515.
//   final state        should read like a person who could walk into a room.
//
// This mirrors the extension's day-rollover cleanup (outerwear, accessories and shoes come off when
// the scene header's date changes). Leaving that out inflates every duration — the first version of
// this probe reported a 6,909-message apron purely because it skipped the rollover.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const chatPath = process.argv[2];
if (!chatPath) { console.error('usage: node tools/wardrobe-drift.mjs <chat.jsonl> [MainName] [UserName]'); process.exit(2); }
const mainName = process.argv[3] || 'her';
const userName = process.argv[4] || 'him';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.js'), 'utf8');
const b = src.indexOf('// === WARDROBE ENGINE (pure) BEGIN ===');
const e = src.indexOf('// === WARDROBE ENGINE (pure) END ===');
if (b < 0 || e < 0) { console.error('wardrobe engine markers not found'); process.exit(2); }
const W = eval('(function(){' + src.slice(b, e).replace('// === WARDROBE ENGINE (pure) BEGIN ===', '').replace(/^\s*const WardrobeEngine = /m, 'return ') + '})()');
const strip = t => String(t || '').replace(/<details[\s\S]*?(?:<\/details>|$)/gi, ' ');

const msgs = [];
for (const l of readFileSync(chatPath, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const o = JSON.parse(l); if (typeof o.mes === 'string' && o.mes.trim()) msgs.push(o); } catch { /* metadata */ }
}

// The extension's default dateRegex.
const dateRe = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i;
const OPTS = {
  mainRe: new RegExp('\\b' + mainName + '\\b', 'i'),
  userRe: new RegExp('\\b' + userName + '\\b', 'i'),
  otherFemale: true, userIsMale: true,
};
const state = {};
let lastDay = null, maxWorn = 0, maxAt = 0, contradictions = 0, dupes = 0;
const firstContradiction = [];
const wornSince = {};
const longest = {};

msgs.forEach((o, i) => {
  const text = strip(o.mes);
  const dm = dateRe.exec(text);
  const day = dm ? dm[0].toLowerCase().replace(/\s+/g, ' ') : null;
  if (day && lastDay && day !== lastDay) {
    for (const who of Object.keys(state)) for (const g of Object.keys(state[who])) {
      const c = W.category(g);
      if ((c === 'outer' || c === 'acc' || c === 'feet') && state[who][g].at < i) delete state[who][g];
    }
  }
  if (day) lastDay = day;
  W.scan(text, [], state, { ...OPTS, at: i, speaker: o.is_user ? 'user' : 'main' });

  for (const who of Object.keys(state)) {
    const keys = Object.keys(state[who]);
    const items = keys.filter(g => g !== '(nothing)');
    if (items.length > maxWorn) { maxWorn = items.length; maxAt = i; }
    // A hat, cap, scarf or gloves genuinely survive undressing, so "(nothing)" beside one of those
    // is the legal "hat and nothing else" state, not a contradiction. Anything ELSE beside it is.
    const KEEP_WHEN_BARE = /\b(?:hat|beanie|cap|scarf|gloves)$/i;
    const clothed = items.filter(g => !KEEP_WHEN_BARE.test(g));
    if (keys.includes('(nothing)') && clothed.length) {
      contradictions++;
      if (firstContradiction.length < 3) firstContradiction.push(`#${i} ${who}: ${W.describe(state[who])}`);
    }
    const cats = {};
    for (const g of items) {
      const c = W.category(g);
      if (c !== 'acc' && c !== 'other') (cats[c] ||= []).push(g);
      const key = who + '|' + g;
      if (wornSince[key] === undefined) wornSince[key] = i;
      const age = i - wornSince[key];
      if (age > (longest[key] || 0)) longest[key] = age;
    }
    for (const gs of Object.values(cats)) if (gs.length > 1) dupes++;
    for (const key of Object.keys(wornSince)) {
      const [w, g] = key.split('|');
      if (w === who && !keys.includes(g)) delete wornSince[key];
    }
  }
});

console.log(`${msgs.length} messages, ${lastDay ? 'dates parsed' : 'NO dates parsed — durations will be inflated'}\n`);
console.log('final state:');
for (const [who, s] of Object.entries(state)) console.log(`  ${who.padEnd(6)} ${W.describe(s) || '(unknown)'}`);
console.log(`\nmost garments at once: ${maxWorn} (message ${maxAt})`);
console.log(`"(nothing)" beside real garments: ${contradictions}${contradictions ? '  <-- always a bug' : ''}`);
for (const f of firstContradiction) console.log('   ' + f);
console.log(`two garments of one category at once: ${dupes}${dupes ? '  <-- always a bug' : ''}`);
console.log('\nlongest a garment stayed on (messages):');
for (const [k, v] of Object.entries(longest).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
process.exit(contradictions || dupes ? 1 : 0);

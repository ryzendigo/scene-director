// A safety cap must bound the worst case WITHOUT changing any real result. This runs the
// shipped wardrobe engine against a copy with MAX_SENT truncation removed, over every
// message in the chat files given, and fails if any result differs.
//
// It exists because v0.9.52 added the cap on a measurement ("no real sentence reaches
// 1000 chars") rather than on a comparison. A bound justified by a percentile is a
// prediction; this is the check.
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.log('usage: node tools/cap-equivalence.mjs <chat.jsonl> [more.jsonl ...]');
  process.exit(0);
}
const src = readFileSync(new URL('../index.js', import.meta.url).pathname, 'utf8');
function engineSrc(tag) {
  const b = `// === ${tag} ENGINE (pure) BEGIN ===`, e = `// === ${tag} ENGINE (pure) END ===`;
  const i = src.indexOf(b), j = src.indexOf(e);
  if (i < 0 || j < 0) throw new Error(tag + ' engine not found');
  return src.slice(i + b.length, j);
}
const PRELUDE = 'const LOG="[sd]"; const MAX_SCAN=20000; const console={error(){},warn(){},log(){}};\n'
  + 'function dbg(){} function compileRegex(p){ try { return new RegExp(p,"i"); } catch(e){ return null; } }\n';
const TRUNC = 'if (sent.length > MAX_SENT) sent = sent.slice(0, MAX_SENT);';
const body = engineSrc('WARDROBE');
if (!body.includes(TRUNC)) { console.log('FAIL  the MAX_SENT truncation is gone from the engine'); process.exit(1); }
const load = (b) => eval('(function(){' + PRELUDE + b + '\nreturn WardrobeEngine;})()');
const capped = load(body);
const uncapped = load(body.replace(TRUNC, ''));

let msgs = 0, diffs = 0, longest = 0;
const examples = [];
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (typeof o.mes !== 'string' || !o.mes.trim()) continue;
    const text = o.mes.replace(/<details[\s\S]*?(?:<\/details>|$)/gi, ' ').slice(0, 20000);
    for (const s of text.split(/(?<=[.!?])\s+|\n+/)) if (s.trim().length > longest) longest = s.trim().length;
    msgs++;
    const a = Object.create(null), b = Object.create(null);
    capped.scan(text, [], a, { at: 0, speaker: 'main' });
    uncapped.scan(text, [], b, { at: 0, speaker: 'main' });
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs++;
      if (examples.length < 3) examples.push(text.slice(0, 90));
    }
  }
}
const cap = Number((/const MAX_SENT = (\d+);/.exec(src) || [])[1]);
console.log(`${msgs} messages, longest real sentence ${longest} chars, cap ${cap} (${(100 * longest / cap).toFixed(0)}% of it)`);
if (diffs) {
  console.log(`FAIL  ${diffs} message(s) scan differently with the cap — it is changing real results`);
  for (const e of examples) console.log('   ' + JSON.stringify(e));
  process.exit(1);
}
console.log('the cap changes no real result');

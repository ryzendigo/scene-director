#!/usr/bin/env node
// Have the shared engine blocks drifted between two builds of the extension?
//
//   node tools/engine-parity.mjs <other-index.js> [this-index.js]
//
// The pure engines are designed to be portable: the same block can live in more than one build of
// the extension. When it does, a fix ported to one copy and not the other is invisible — both
// still pass their own suites, because each suite lifts the block out of the file it was given.
//
// This compares the blocks directly. It ignores comments and blank lines: a comment is where a
// build's own vocabulary lives and is expected to differ, and flagging those would bury the
// differences that matter. Only executable lines are compared.
//
// An engine present in one build and absent from the other is reported, not failed — the atlas
// engine is deliberately public-only.
//
// Found on 23 Sep: a dead `longest()` helper removed from one copy the day before was still in the
// other. Four of five engines were already byte-identical, which is the point — the one that was
// not stood out immediately.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const other = process.argv[2];
if (!other) {
  console.error('usage: node tools/engine-parity.mjs <other-index.js> [this-index.js]');
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = readFileSync(process.argv[3] || join(root, 'index.js'), 'utf8');
const B = readFileSync(other, 'utf8');

function block(src, name) {
  const b = src.indexOf(`// === ${name} ENGINE (pure) BEGIN ===`);
  const e = src.indexOf(`// === ${name} ENGINE (pure) END ===`);
  return (b < 0 || e < 0) ? null : src.slice(b, e);
}
const codeOnly = t => t.split('\n')
  .map(l => l.replace(/\/\/.*$/, '').trimEnd())
  .filter(l => l.trim())
  .join('\n');

const ENGINES = ['MOOD', 'PRESENCE', 'WARDROBE', 'POSE', 'BACKGROUND', 'ATLAS'];
let drifted = 0, compared = 0;
for (const name of ENGINES) {
  const a = block(A, name), b = block(B, name);
  if (!a && !b) continue;
  if (!a || !b) { console.log(`${name.padEnd(11)} only in ${a ? 'this' : 'the other'} build — not compared`); continue; }
  compared++;
  const ca = codeOnly(a), cb = codeOnly(b);
  if (ca === cb) { console.log(`${name.padEnd(11)} identical`); continue; }
  drifted++;
  const la = ca.split('\n'), lb = cb.split('\n');
  console.log(`${name.padEnd(11)} DRIFTED  (${la.length} vs ${lb.length} code lines)`);
  let shown = 0;
  for (let i = 0; i < Math.max(la.length, lb.length) && shown < 3; i++) {
    if (la[i] === lb[i]) continue;
    shown++;
    console.log(`   first difference at code line ${i + 1}`);
    console.log(`     this : ${String(la[i] ?? '(end)').trim().slice(0, 96)}`);
    console.log(`     other: ${String(lb[i] ?? '(end)').trim().slice(0, 96)}`);
    break;
  }
}
console.log(drifted
  ? `\n${drifted} of ${compared} shared engines have drifted — a fix reached one copy and not the other`
  : `\nall ${compared} shared engines are identical`);
process.exit(drifted ? 1 : 0);

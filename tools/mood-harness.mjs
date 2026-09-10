#!/usr/bin/env node
// Runs the pure MoodEngine (extracted from index.js) over the last N assistant
// messages of a SillyTavern chat .jsonl and prints the verdicts.
//   node tools/mood-harness.mjs <chat.jsonl> <ownHex> [name] [count]
// Layer 2 (the classifier) is not available outside SillyTavern; this shows
// L0 extraction, L1 tag, L3 lexicon and the verdict without L2.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'index.js'), 'utf8');
const a = src.indexOf('// === MOOD ENGINE (pure) BEGIN ==='); const b = src.indexOf('// === MOOD ENGINE (pure) END ===');
const MoodEngine = new Function(src.slice(a, b) + '\nreturn MoodEngine;')();
const pa = src.indexOf('// === PRESENCE ENGINE (pure) BEGIN ==='); const pb = src.indexOf('// === PRESENCE ENGINE (pure) END ===');
export const PresenceEngine = new Function(src.slice(pa, pb) + '\nreturn PresenceEngine;')();
const [file, hex, name = '', count = '5'] = process.argv.slice(2);
if (!file || !hex) { console.error('usage: mood-harness.mjs <chat.jsonl> <#hex> [name] [count]'); process.exit(1); }
const msgs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const ai = msgs.filter(m => !m.is_user && !m.is_system && m.mes).slice(-Number(count));
const nameRe = name ? new RegExp('\\b' + name + '\\b', 'i') : null;
const lex = MoodEngine.compileLexicon();
let prev = null;
ai.forEach((m, i) => {
    const ext = MoodEngine.extractOwn(m.mes, { hex, nameRe, aliasRe: null, otherNameRes: [], soloFemale: true });
    const tag = MoodEngine.detectTag(m.mes, m.extra && m.extra.reasoning);
    const lx = MoodEngine.lexicon(ext, lex);
    const out = MoodEngine.verdict({ tag, local: null, lex: lx, prev });
    console.log(`#${i} [${ext.dialogue} dlg/${ext.narration} narr] ` + MoodEngine.describe(tag, null, lx, out));
    if (out.final) prev = out.final;
});

#!/usr/bin/env node
// Presence verdicts for one saved chat: prints, per assistant message, each
// cast member's evidence/vetoes and whether a chip would show.
//   node tools/presence-harness.mjs <chat.jsonl> <cast.json> [count]
// cast.json = [{ "key": "june", "label": "June", "colorHex": "#B0BEC5", "nameRegex": "june", "aliasRegex": "aunt" }, ...]
import fs from 'fs';
import { PresenceEngine } from './mood-harness.mjs';
const [file, castFile, count = '5'] = process.argv.slice(2);
if (!file || !castFile) { console.error('usage: presence-harness.mjs <chat.jsonl> <cast.json> [count]'); process.exit(1); }
const cast = JSON.parse(fs.readFileSync(castFile, 'utf8')).map(m => ({ key: m.key, label: m.label, hex: m.colorHex || null,
    nameRe: m.nameRegex ? new RegExp(m.nameRegex, 'i') : null, aliasRe: m.aliasRegex ? new RegExp(m.aliasRegex, 'i') : null }));
const msgs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const ai = msgs.filter(m => !m.is_user && !m.is_system && m.mes).slice(-Number(count));
const T = PresenceEngine.compileTables();
ai.forEach((m, i) => {
    const masked = PresenceEngine.mask(m.mes);
    console.log(`#${i}`);
    for (const c of cast) { const r = PresenceEngine.evaluate(masked, c, { tables: T }); if (r.score || r.vetoes.length) console.log('   ' + r.detail); }
});

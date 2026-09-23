#!/usr/bin/env node
// Run every pure engine over every message of a REAL chat and report what they decide.
//
//   node tools/soak.mjs <chat.jsonl> [Name,Name,...] [path/to/index.js]
//
// The case suites test what the author imagined; this tests what a model actually writes. One pass
// over a real chat found the largest bug in the extension: the main character was named in 329
// messages and scored present in 29, because the action table was almost entirely GESTURES (nods,
// shrugs, waves) and had none of the physical verbs ordinary prose runs on.
//
// What to look at, in order:
//   exceptions    must be 0 — anything else is a crash on real input
//   presence rate per name, against how often the name appears. A main character scoring present in
//                 a tenth of their scenes is a bug; a dead or absent character scoring HIGH is the
//                 opposite bug. Both matter: widening a matcher trades one for the other.
//   slow          per-message engine cost (ONE scan per message), against the 60ms budget
//   full rebuild  what rebuildWardrobe actually costs: WARDROBE_LOOKBACK messages re-scanned
//                 worth a look.
//
// Verdict counts are not assertions — no chat is labelled. Read them as rates and compare before
// and after a change, which is how the trade-off above becomes visible.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const chatPath = process.argv[2];
if (!chatPath) { console.error('usage: node tools/soak.mjs <chat.jsonl> [Name,Name] [index.js]'); process.exit(2); }
const names = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(process.argv[4] || join(root, 'index.js'), 'utf8');

function lift(name, ctor) {
  const b = src.indexOf(`// === ${name} ENGINE (pure) BEGIN ===`);
  const e = src.indexOf(`// === ${name} ENGINE (pure) END ===`);
  if (b < 0 || e < 0) return null;
  const block = src.slice(b, e).replace(`// === ${name} ENGINE (pure) BEGIN ===`, '');
  return eval('(function(){' + block.replace(new RegExp(`^\\s*const ${ctor} = `, 'm'), 'return ') + '})()');
}
const Mood = lift('MOOD', 'MoodEngine');
const Presence = lift('PRESENCE', 'PresenceEngine');
const Wardrobe = lift('WARDROBE', 'WardrobeEngine');
const Background = lift('BACKGROUND', 'BackgroundEngine');
const Pose = lift('POSE', 'PoseEngine');
if (!Presence) { console.error('PRESENCE engine not found — is this an index.js?'); process.exit(2); }

const msgs = [];
for (const line of readFileSync(chatPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const o = JSON.parse(line); if (typeof o.mes === 'string' && o.mes.trim()) msgs.push(o.mes); } catch { /* metadata line */ }
}
console.log(`messages: ${msgs.length}`);

// Mood's entry point is NOT evaluate(): the chain is extractOwn -> lexicon -> verdict.
const MOOD_TABLE = Mood && Mood.compileLexicon(null);
const P_T = Presence.compileTables();
const B_T = Background && Background.compileTables();
const cast = names.map(n => ({ key: n.toLowerCase(), name: n, nameRe: new RegExp('\\b' + n + '\\b', 'i'), hex: '#c77', female: true }));

const errs = [], slow = [], moods = {}, pres = {}, named = {}, was = {};
const lat = [];   // every per-message time, for percentiles
const wstate = {};
let bgCount = 0, poseCount = 0;

// Warm the engines before timing anything. These matchers are large regexes built at runtime, and
// compiling them costs ~200ms once. Without this the FIRST message absorbs all of it and gets
// reported as pathologically slow — 23 Sep that sent me hunting a catastrophic-backtracking bug
// that does not exist. The same message costs 0.03ms once the regexes are compiled.
for (const m of msgs.slice(0, 40)) {
  try {
    const masked = Presence.mask(m);
    for (const M of cast) Presence.evaluate(masked, M, { tables: P_T });
    if (Wardrobe) Wardrobe.scan(m, [], {}, { at: 0, otherFemale: true, userIsMale: true, speaker: 'main' });
    if (Background) Background.evaluate({ tables: B_T, header: '', narr: masked.narr, available: null });
    if (Pose && Pose.detect) Pose.detect(m);
    if (Mood) Mood.lexicon(Mood.extractOwn(m, { hex: '#c77', nameRe: cast[0] ? cast[0].nameRe : null, aliasRe: null, otherNameRes: [], soloFemale: true }), MOOD_TABLE);
  } catch { /* warm-up only */ }
}

msgs.forEach((m, i) => {
  const t0 = process.hrtime.bigint();
  try {
    const masked = Presence.mask(m);
    if (Mood) {
      // extractOwn needs a nameRe to know whose text to pull out; with null it finds nothing and
      // every message comes back neutral. soloFemale MATTERS just as much: with it false, a
      // she/her sentence is not credited to her unless her name is in it, and 38% of her own
      // messages extract NOTHING — prose like "Her cheeks flush a deeper crimson" never names her.
      // The extension computes it as !(femaleNamesRegex matches), and that setting is empty by
      // default, so true is what actually ships. Passing false here halved the reported mood rate
      // and sent me looking for a bug in the lexicon that was not there.
      // Use the first name given, which is normally the character whose moods you care about.
      const ext = Mood.extractOwn(m, { hex: '#c77', nameRe: cast[0] ? cast[0].nameRe : null, aliasRe: null, otherNameRes: [], soloFemale: true });
      const out = Mood.verdict({ tag: null, local: null, lex: Mood.lexicon(ext, MOOD_TABLE), prev: null });
      if (out && out.final && out.final !== 'neutral') moods[out.final] = (moods[out.final] || 0) + 1;
    }
    for (const M of cast) {
      if (M.nameRe.test(m)) named[M.key] = (named[M.key] || 0) + 1;
      const r = Presence.evaluate(masked, M, { tables: P_T, wasPresent: !!was[M.key] });
      was[M.key] = !!(r && r.present);
      if (r && r.present) pres[M.key] = (pres[M.key] || 0) + 1;
    }
    if (Wardrobe) Wardrobe.scan(m, [], wstate, { at: i, otherFemale: true, userIsMale: true, speaker: 'main' });
    if (Background) { const r = Background.evaluate({ tables: B_T, header: '', narr: masked.narr, available: null }); if (r && r.file) bgCount++; }
    if (Pose && Pose.detect && Pose.detect(m)) poseCount++;
  } catch (e) {
    errs.push({ i, msg: m.slice(0, 90), err: String(e).slice(0, 140) });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  lat.push(ms);
  if (ms > 60) slow.push({ i, ms: ms.toFixed(0), len: m.length });
});

if (cast.length) {
  console.log('presence (present / named):');
  for (const M of cast) {
    const n = named[M.key] || 0, p = pres[M.key] || 0;
    console.log(`  ${M.name.padEnd(12)} ${String(p).padStart(4)} / ${String(n).padStart(4)}  ${n ? (100 * p / n).toFixed(0) + '%' : '-'}`);
  }
} else {
  console.log('(pass a comma-separated name list as argv[3] for presence rates)');
}
console.log(`background: ${bgCount}   pose: ${poseCount}`);
console.log('mood:', JSON.stringify(Object.fromEntries(Object.entries(moods).sort((a, b) => b[1] - a[1]).slice(0, 12))));
console.log('exceptions:', errs.length);
for (const e of errs.slice(0, 8)) console.log(`  #${e.i} ${e.err}\n     ${JSON.stringify(e.msg)}`);
console.log('slow (>60ms):', slow.length);
// The per-message numbers above time ONE scan per message. The extension does not do that:
// rebuildWardrobe re-scans the last WARDROBE_LOOKBACK messages from scratch on every message,
// edit and swipe, and that is the dominant cost. This header used to claim the soak measured
// the rebuild; it did not, so a 240-message window could have been raised on latency figures
// that never included it.
if (Wardrobe) {
  const LOOK = Number((/const WARDROBE_LOOKBACK = (\d+);/.exec(src) || [])[1]) || 80;
  const rebuildAt = (end) => {
    const st = Object.create(null);
    for (let i = Math.max(0, end - LOOK); i < end; i++) {
      Wardrobe.scan(msgs[i], [], st, { at: i, otherFemale: true, userIsMale: true, speaker: 'main' });
    }
  };
  for (let w = 0; w < 2 && msgs.length > LOOK; w++) rebuildAt(msgs.length);
  const times = [];
  for (let end = Math.min(msgs.length, LOOK); end <= msgs.length; end += Math.max(1, Math.floor(msgs.length / 20))) {
    const t0 = process.hrtime.bigint();
    rebuildAt(end);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  if (times.length) {
    // A single max is noise: repeated runs of this exact measurement ranged 46-63ms on
    // the same chat, so one sample cannot tell a regression from scheduling jitter.
    // Report p90 as the headline and keep max as the worst seen.
    times.sort((a, b) => a - b);
    const q = (f) => times[Math.min(times.length - 1, Math.floor(times.length * f))].toFixed(1);
    const max = times[times.length - 1].toFixed(1);
    console.log(`full rebuild (window ${LOOK}, runs per message): median ${q(0.5)}ms  p90 ${q(0.9)}ms  max ${max}ms  budget 60ms`);
  }
}
// A pass/fail threshold hides whether there is headroom or we are sitting just under it.
if (lat.length) {
  const xs = lat.slice().sort(function (a, b) { return a - b; });
  const q = function (f) { return xs[Math.min(xs.length - 1, Math.floor(xs.length * f))].toFixed(1); };
  console.log('latency ms: p50 ' + q(0.5) + '  p90 ' + q(0.9) + '  p99 ' + q(0.99) + '  max ' + xs[xs.length - 1].toFixed(1));
}
for (const s of slow.slice(0, 8)) console.log(`  #${s.i} ${s.ms}ms for ${s.len} chars`);
process.exit(errs.length ? 1 : 0);

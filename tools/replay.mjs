// A faithful replay of what onMessage does to per-message state, for measuring the
// extension against a real chat.
//
// It exists because four consecutive measurement attempts were WRONG in the same way:
// they called the pure engines directly and skipped the caller's surrounding logic. That
// produced, in turn: accessories reported as the stalest wardrobe category (the caller's
// day-rollover clears them), a 145-message-old apron (the engine's own .at said 14), and
// 23 unguarded background changes (the caller assigns lastBgLoc unconditionally, so it is
// 3). Every one looked like a finding.
//
// The rule this encodes: an engine verdict is not what the user sees. The caller filters
// it again, and the caller's state updates are part of the behaviour.
import { readFileSync } from 'node:fs';

export function loadEngines(src) {
  const P = 'const LOG="[sd]"; const MAX_SCAN=20000; const console={error(){},warn(){}};\n'
    + 'function dbg(){} function compileRegex(p){try{return new RegExp(p,"i");}catch(e){return null;}}\n';
  const out = {};
  for (const tag of ['MOOD', 'PRESENCE', 'WARDROBE', 'POSE', 'BACKGROUND', 'ATLAS']) {
    const b = `// === ${tag} ENGINE (pure) BEGIN ===`, e = `// === ${tag} ENGINE (pure) END ===`;
    const i = src.indexOf(b);
    if (i < 0) continue;
    const name = tag[0] + tag.slice(1).toLowerCase() + 'Engine';
    out[tag] = eval('(function(){' + P + src.slice(i + b.length, src.indexOf(e)) + '\nreturn ' + name + ';})()');
  }
  return out;
}

export function defaultRegex(src, key) {
  const d = /const defaultSettings = \{([\s\S]*?)\n    \};/.exec(src);
  if (!d) return null;
  const m = new RegExp("^\\s+" + key + ": '((?:[^'\\\\]|\\\\.)*)'", 'm').exec(d[1]);
  return m ? new RegExp(m[1].replace(/\\\\/g, '\\'), 'i') : null;
}

export function readChat(file) {
  const msgs = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (typeof o.mes === 'string' && o.mes.trim()) msgs.push(o);
  }
  return msgs;
}

// Strip planning blocks exactly as the caller does before any engine sees the text.
export const stripPlanning = (raw) =>
  String(raw || '').replace(/<details[\s\S]*?(?:<\/details>|$)/gi, ' ');

/**
 * Replay a chat message by message, maintaining the same state onMessage does.
 * onEach({ i, msg, text, loc, scene, bg, bgChanged, worn }) is called per AI message.
 */
export function replay(src, msgs, onEach, opts = {}) {
  const E = loadEngines(src);
  const locRe = defaultRegex(src, 'locationRegex');
  const dateRe = defaultRegex(src, 'dateRegex');
  const LOOK = Number((/const WARDROBE_LOOKBACK = (\d+);/.exec(src) || [])[1]) || 160;
  const T = E.BACKGROUND.compileTables();
  const texts = msgs.map((m) => stripPlanning(m.mes).slice(0, 20000));

  // Caller state, named as in index.js.
  let lastBg = null, lastBgLoc = null;

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (msg.is_user || msg.is_system) continue;
    const text = texts[i];
    const line = msg.mes.split('\n').find((x) => x.includes('📍')) || '';
    locRe.lastIndex = 0;
    const lm = locRe.exec(line);
    const loc = lm ? lm[1].trim() : '';

    // --- wardrobe: a full rebuild over the lookback, WITH the caller's day rollover ---
    const state = Object.create(null);
    const from = Math.max(0, (i + 1) - LOOK);
    let lastDay = null;
    for (let j = from; j <= i; j++) {
      if (dateRe) {
        dateRe.lastIndex = 0;
        const dm = dateRe.exec(texts[j]);
        const day = dm ? String(dm[0]).toLowerCase().replace(/\s+/g, ' ') : null;
        if (day && lastDay && day !== lastDay) {
          for (const who of Object.keys(state)) for (const g of Object.keys(state[who])) {
            const c = E.WARDROBE.category(g);
            if ((c === 'outer' || c === 'acc' || c === 'feet') && state[who][g].at < j) delete state[who][g];
          }
        }
        if (day) lastDay = day;
      }
      E.WARDROBE.scan(texts[j], [], state, { at: j, speaker: msgs[j].is_user ? 'user' : 'main' });
    }

    // --- background: engine verdict, then the caller's hysteresis ---
    const masked = E.PRESENCE.mask(msg.mes);
    const v = E.BACKGROUND.evaluate({ tables: T, header: loc, narr: masked.narr, available: opts.available || null });
    let bgChanged = false;
    if (v && v.file) {
      const locChangedBg = loc !== lastBgLoc;
      if (v.file !== lastBg && (locChangedBg || v.score >= 8 || !lastBg)) { lastBg = v.file; bgChanged = true; }
    }
    // index.js assigns lastBgLoc OUTSIDE the `if (v.file)` block, so it advances even when
    // the engine declined. Putting it inside gave 233 changes instead of 231 — small, but
    // it is exactly the class of modelling slip these measurements keep tripping on.
    lastBgLoc = loc;

    onEach({ i, msg, text, loc, masked, verdict: v, bg: lastBg, bgChanged, state, worn: E.WARDROBE.describe(state.main) || '' });
  }
}

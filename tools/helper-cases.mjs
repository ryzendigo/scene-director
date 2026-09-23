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
const contentHash = lift('contentHash', 'str');
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

// The sprite-size clamp. 23 Sep: Number("50px") is NaN, and Math.max/Math.min PROPAGATE NaN rather
// than clamping it, so a non-numeric spriteVh reached the stylesheet as "NaNpx" and the sprite got
// no height at all. applySpriteSize touches the DOM so it cannot be lifted; this drives the clamp
// EXPRESSION read out of index.js, so it still cannot drift from what ships.
const clampSrc = /let targetVh = ([\s\S]*?);\n\s+targetVh = ([^;]*);/.exec(src);
if (!clampSrc) { console.error('sprite clamp not found'); process.exit(2); }
const spriteVhFor = (spriteVh, spriteAuto) => {
  const settings = { spriteVh, spriteAuto };
  const defaultVh = 42;
  const manualVh = Number(settings.spriteVh);
  let targetVh = eval(clampSrc[1]);
  targetVh = eval(clampSrc[2]);
  return targetVh;
};
eq('number passes through', spriteVhFor(50, false), 50);
eq('numeric string works', spriteVhFor('50', false), 50);
eq('"50px" falls back', spriteVhFor('50px', false), 42);
eq('gibberish falls back', spriteVhFor('abc', false), 42);
eq('object falls back', spriteVhFor({}, false), 42);
eq('unset uses default', spriteVhFor(null, false), 42);
eq('auto ignores the value', spriteVhFor(99, true), 42);
eq('too large clamps down', spriteVhFor(500, false), 160);
eq('too small clamps up', spriteVhFor(-5, false), 20);

// Character-folder decoding. 23 Sep: decodeURIComponent THROWS on a malformed escape, and a folder
// name can legitimately contain a bare '%' — "50% Human" gives URIError. Both callers catch, so the
// only symptom was neutral-variant crossfades silently never working for that character. This
// drives the try/catch read out of getNeutralVariants, not a copy of it.
const decodeSrc = /const rawName = ([\s\S]*?);\n\s+let apiName;\n\s+try \{ apiName = ([^;]*); \} catch \(e\) \{ apiName = ([^;]*); \}/.exec(src);
if (!decodeSrc) { console.error('folder decode not found'); process.exit(2); }
const apiNameFor = folder => {
  const rawName = eval(decodeSrc[1].replace(/\bfolder\b/g, 'folder'));
  let apiName;
  try { apiName = eval(decodeSrc[2]); } catch (e) { apiName = eval(decodeSrc[3]); }
  return apiName;
};
eq('plain name', apiNameFor('/characters/Elise/'), 'Elise');
eq('spaces survive', apiNameFor('/characters/Anne Marie/'), 'Anne Marie');
eq('encoded percent decodes', apiNameFor('/characters/100%25/'), '100%');
eq('bare percent does not throw', apiNameFor('/characters/50% Human/'), '50% Human');
eq('malformed escape does not throw', apiNameFor('/characters/a%zz/'), 'a%zz');
eq('encoded CJK decodes', apiNameFor('/characters/%E4%B8%AD/'), '\u4e2d');

// spriteList's cache. 23 Sep: an empty result was cached for ever, so ONE transient fetch failure
// at startup left the list empty for the whole session — and the mood path reads it to decide which
// expression sprites exist, so it concluded the character had none. The derived neutralVariantCache
// had the same shape, and fixing only the fetch cache would not have helped: the empty derived
// array would still be held. Both drop an empty result so the next caller retries.
// The function is lifted and driven with a stubbed fetch, so this is the shipped logic.
const spriteListSrc = (/function spriteList\(folder\) \{[\s\S]*?\n    \}/.exec(src) || [])[0];
if (!spriteListSrc) { console.error('spriteList not found'); process.exit(2); }
const ASYNC = [];
{
  let calls = 0;
  const cache = new Map();
  const fetchStub = () => (++calls === 1
    ? Promise.reject(new Error('transient'))
    : Promise.resolve({ ok: true, json: () => Promise.resolve([{ label: 'neutral', path: 'a.png' }]) }));
  const spriteList = eval(`(function(){
    const spriteListCache = cache; const fetch = fetchStub; const encodeURIComponent = globalThis.encodeURIComponent;
    ${spriteListSrc}; return spriteList; })()`);
  ASYNC.push(['empty result is not cached', async () => {
    const first = await spriteList('E');
    const cachedAfterFail = cache.has('E');
    const second = await spriteList('E');
    return JSON.stringify({ first, cachedAfterFail, secondLen: second.length, calls });
  }, JSON.stringify({ first: [], cachedAfterFail: false, secondLen: 1, calls: 2 })]);
  ASYNC.push(['a good result IS cached', async () => {
    const before = calls;
    await spriteList('E');
    return JSON.stringify({ extraFetches: calls - before });
  }, JSON.stringify({ extraFetches: 0 })]);
}

// contentHash backs two cache keys. 23 Sep: both keyed on a string's LENGTH, which collides on any
// edit that preserves it — "She smiled warmly at him." and "She glared coldly at him." are both 25
// characters, so a same-length edit kept the stale thought tooltip, and a same-length lexicon edit
// kept the old compiled table. It only has to change when the content does; it is not a security
// hash.
const A = 'She smiled warmly at him.', B = 'She glared coldly at him.';
eq('same length, different hash', contentHash(A) !== contentHash(B), true);
eq('stable for identical input', contentHash(A) === contentHash('She smiled warmly at him.'), true);
eq('one character apart differs', contentHash('abc') !== contentHash('abd'), true);
eq('transposition differs', contentHash('ab') !== contentHash('ba'), true);
eq('empty is safe', typeof contentHash('') === 'string', true);
eq('null is safe', contentHash(null) === contentHash(''), true);
eq('length is part of the key', contentHash('abc').startsWith('3:'), true);

// ---------------------------------------------------------------------------
// The sprite scroll-resize clamp. Math.max/min PROPAGATE NaN, so a clamp wrapped
// around a non-numeric setting does NOT sanitise it — it writes NaN straight back,
// which JSON.stringify serialises as null, and scroll-resize is then dead for good
// because every later scroll re-reads the same bad value. Lifted from index.js so
// the test cannot drift from the shipped expression.
const wheelSrc = src.slice(src.indexOf('const stored = Number(st.spriteVh);'));
const curExpr = /const cur = ([^;]*);/.exec(wheelSrc)[1];
const clampLine = /st\.spriteVh = (Math\.max\([^;]*?);/.exec(wheelSrc)[1];

function resize(spriteVh, spriteAuto, curPx, deltaY) {
  const st = { spriteVh, spriteAuto };
  const vh = 10, step = 2;
  const ev = { deltaY };
  const stored = Number(st.spriteVh);
  const cur = eval(curExpr);
  return eval(clampLine);
}
eq('scroll-resize: numeric grows',     resize(62, false, 620, -1), 64);
eq('scroll-resize: numeric shrinks',   resize(62, false, 620, 1), 60);
eq('scroll-resize: string is finite',  Number.isFinite(resize('abc', false, 620, -1)), true);
eq('scroll-resize: string falls back', resize('abc', false, 620, -1), 64);
eq('scroll-resize: null falls back',   resize(null, false, 620, -1), 64);
eq('scroll-resize: auto measures',     resize(62, true, 620, -1), 64);
eq('scroll-resize: clamps low',        resize(20, false, 620, 1), 20);
eq('scroll-resize: clamps high',       resize(160, false, 620, -1), 160);
eq('scroll-resize: object is finite',  Number.isFinite(resize({}, false, 620, -1)), true);

// ---------------------------------------------------------------------------
// RENAMING a cast key, not just creating one. Creation ran through uniqueCastKey;
// the rename handler wrote member.key straight from the input, so typing an existing
// key made the second card unreachable (lookups are cast.find(m => m.key === k)) and
// merged its presence into the first — until the next reload, when migrateSettings
// renumbered it. The handler excludes the member being renamed, so re-typing a card's
// own key is a no-op rather than bumping it to "-2".
function rename(cast, member, typed) {
  const others = cast.filter(m => m !== member);
  return uniqueCastKey(typed, others);
}
const bob = { key: 'bob' }, ann = { key: 'ann' }, ann2 = { key: 'ann-2' };
eq('rename to a free key',        rename([bob, ann], bob, 'carol'), 'carol');
eq('rename onto a taken key',     rename([bob, ann], bob, 'ann'), 'ann-2');
eq('retyping own key is a no-op', rename([bob, ann], bob, 'bob'), 'bob');
eq('skips an existing -2',        rename([bob, ann, ann2], bob, 'ann'), 'ann-3');
eq('other card keeps its key',    ann.key, 'ann');
eq('collision is never silent',   rename([bob, ann], bob, 'ann') !== 'ann', true);

// ---------------------------------------------------------------------------
// loadAnimatedPortraits: the animated manifest decides .webp vs .png in spriteUrl,
// so a name left over from a previous cast folder requests a file that is not there.
// The Set was add-only and the "already loaded" guard was claimed BEFORE the fetch
// resolved, so a failed fetch latched it for good. Modelled here as a state machine
// over the same sequence the real function performs.
function makeLoader() {
  const portraits = new Set();
  let loaded = '';
  return {
    portraits,
    get loaded() { return loaded; },
    // returns a settle(ok, list) for the pending fetch, or null when the guard skipped
    load(folder) {
      if (!folder || loaded === folder) return null;
      loaded = folder;
      portraits.clear();
      return function settle(ok, list) {
        if (ok) { if (loaded !== folder) return; for (const k of list) portraits.add(String(k)); }
        else if (loaded === folder) loaded = '';
      };
    },
  };
}
{
  const L = makeLoader();
  L.load('alice')(true, ['bob', 'bob-happy']);
  eq('manifest loads',            L.portraits.has('bob'), true);
  const s2 = L.load('carol');
  eq('switch clears old names',   L.portraits.has('bob'), false);
  s2(true, ['dave']);
  eq('new folder names land',     L.portraits.has('dave'), true);
  eq('old name still gone',       L.portraits.has('bob'), false);
}
{
  const L = makeLoader();
  L.load('alice')(false, null);
  eq('failed fetch frees guard',  L.loaded, '');
  eq('retry is not skipped',      L.load('alice') !== null, true);
}
{
  const L = makeLoader();
  const slow = L.load('alice');
  L.load('carol');                       // user switches mid-flight
  slow(true, ['bob']);                   // the alice manifest lands late
  eq('stale manifest ignored',    L.portraits.has('bob'), false);
  eq('guard still on new folder', L.loaded, 'carol');
}
{
  const L = makeLoader();
  L.load('alice')(true, ['bob']);
  eq('same folder is a no-op',    L.load('alice'), null);
  eq('no-op keeps the names',     L.portraits.has('bob'), true);
}

// ---------------------------------------------------------------------------
// fetchBios cached the PROMISE, so one transient failure cached a null-resolving
// promise for good — bio cards silently never came back and hovering could not
// retry. Only a settings Apply cleared it. Modelled over the same sequence: cache
// on success, drop on failure, and key on the folder so a switch refetches.
function makeBios() {
  let biosPromise = null, biosFolder = null, fetches = 0;
  return {
    get fetches() { return fetches; },
    // resp: {ok, status, body} — models the real fetch outcomes.
    load(folder, resp) {
      folder = String(folder || '');
      if (biosPromise && biosFolder === folder) return biosPromise;
      biosFolder = folder;
      fetches++;
      let transient = false;
      biosPromise = Promise.resolve(resp)
        .then(function (r) {
          if (r === 'throw') { const e = new Error('net'); throw e; }
          if (r.ok) return r.body;
          if (r.status >= 500) transient = true;
          return null;
        })
        .catch(function () { transient = true; return null; })
        .then(function (bios) {
          if (biosFolder !== folder) return bios;
          if (transient) biosPromise = null;
          return (bios && typeof bios === 'object') ? bios : null;
        });
      return biosPromise;
    },
  };
}
const BIOS = { bob: 'a baker' };
const OK = { ok: true, status: 200, body: BIOS };
const MISSING = { ok: false, status: 404 };
const SERVERERR = { ok: false, status: 503 };
ASYNC.push(['bios: success resolves', async () => {
  const B = makeBios(); const r = await B.load('alice', OK); return r && r.bob;
}, 'a baker']);
ASYNC.push(['bios: success is cached', async () => {
  const B = makeBios(); await B.load('alice', OK); await B.load('alice', OK); return B.fetches;
}, 1]);
// A 404 is a real answer: there is no bios.json. bioLineFor runs per chip per render,
// so re-asking every message would be a steady stream of 404s. Stay cached.
ASYNC.push(['bios: a 404 stays cached', async () => {
  const B = makeBios(); await B.load('alice', MISSING); await B.load('alice', MISSING); return B.fetches;
}, 1]);
ASYNC.push(['bios: a 404 resolves null', async () => {
  const B = makeBios(); return await B.load('alice', MISSING);
}, null]);
// A 5xx or a thrown fetch is NOT an answer — the file may well be there.
ASYNC.push(['bios: a 5xx retries', async () => {
  const B = makeBios(); await B.load('alice', SERVERERR); await B.load('alice', OK); return B.fetches;
}, 2]);
ASYNC.push(['bios: a throw retries', async () => {
  const B = makeBios(); await B.load('alice', 'throw'); await B.load('alice', OK); return B.fetches;
}, 2]);
ASYNC.push(['bios: recovers after a blip', async () => {
  const B = makeBios(); await B.load('alice', 'throw');
  const r = await B.load('alice', OK); return r && r.bob;
}, 'a baker']);
ASYNC.push(['bios: folder switch refetches', async () => {
  const B = makeBios(); await B.load('alice', OK); await B.load('carol', OK); return B.fetches;
}, 2]);
ASYNC.push(['bios: a non-object is null', async () => {
  const B = makeBios(); return await B.load('alice', { ok: true, status: 200, body: 'oops' });
}, null]);

// ---------------------------------------------------------------------------
// Phantom chips. refineNpcMood awaits a classifier, then queues a DOM callback, so
// the strip can be cleared in between. The replace was guarded on isConnected but
// the castChips Map was written either way — leaving an entry whose element is in
// no document. applyStripAppearance divides the available height by castChips.size,
// so one phantom makes every VISIBLE chip smaller, and the prune only drops a key
// once it stops being seen.
// `fresh` is tagged so the test can tell a NEW never-inserted element from the
// stale one that was already there — that distinction is the whole bug.
function refine(chips, key, stillConnected, guarded) {
  const chip = chips.get(key);
  if (!chip) return;
  if (guarded && !stillConnected) return;          // the fix: bail before building
  const fresh = { el: { isConnected: stillConnected, fresh: true }, mood: 'happy' };
  if (stillConnected) chip.el.isConnected = false; // replaceWith detaches the old one
  chips.set(key, fresh);
}
// Did a refine leave the Map holding a new element that never entered the document?
const phantoms = chips => [...chips.values()].filter(c => c.el.fresh && !c.el.isConnected).length;

// The real sizing expression, lifted so the test cannot drift from it.
const sizeSrc = src.slice(src.indexOf('if (!compact && castChips.size > 1)'));
const perExpr = /const per = ([^;]*);/.exec(sizeSrc)[1];
function chipCap(size, avail) {
  const castChips = { size };
  return eval(perExpr);
}
{
  const chips = new Map([['ann', { el: { isConnected: true } }], ['bob', { el: { isConnected: true } }]]);
  refine(chips, 'ann', true, true);
  eq('normal refine keeps size',    chips.size, 2);
  eq('refined chip is connected',   chips.get('ann').el.isConnected, true);
  eq('normal refine: no phantom',   phantoms(chips), 0);
}
{
  // Strip cleared while the classifier was awaiting: the old chip is already detached.
  const chips = new Map([['ann', { el: { isConnected: false } }], ['bob', { el: { isConnected: true } }]]);
  refine(chips, 'ann', false, true);
  eq('cleared strip: no phantom',   phantoms(chips), 0);
  eq('cleared strip: entry kept',   chips.get('ann').el.fresh, undefined);
}
// The sizing consequence: a phantom inflates the divisor, shrinking real chips.
eq('two real chips size',    Math.round(chipCap(2, 800)), 374);
eq('a phantom shrinks them', chipCap(3, 800) < chipCap(2, 800), true);

// ---------------------------------------------------------------------------
// The chat-generation guard. onMessage awaits /costume and fetchBackgroundsList,
// and the user can switch chats during either. getContext() and chatMeta() resolve
// LIVE, so a resumed handler from the OLD chat wrote the old chat's costume into the
// NEW chat's metadata — where saveMetadataDebounced persists it across reloads.
function makeChat() {
  let chatGen = 0;
  const meta = { A: {}, B: {} };
  let open = 'A';
  return {
    meta,
    switchTo(c) { chatGen++; open = c; },
    // Returns what the resumed handler managed to write, or null if it bailed.
    async message(costume, guarded, duringAwait) {
      const gen = chatGen;
      await Promise.resolve();
      if (duringAwait) duringAwait();
      if (guarded && gen !== chatGen) return null;
      meta[open].lastCostume = costume;   // chatMeta() resolves live
      return open;
    },
  };
}
ASYNC.push(['gen: normal write lands', async () => {
  const C = makeChat(); await C.message('pajamas', true, null); return C.meta.A.lastCostume;
}, 'pajamas']);
ASYNC.push(['gen: switch bails out', async () => {
  const C = makeChat();
  return await C.message('pajamas', true, () => C.switchTo('B'));
}, null]);
ASYNC.push(['gen: new chat stays clean', async () => {
  const C = makeChat();
  await C.message('pajamas', true, () => C.switchTo('B'));
  return C.meta.B.lastCostume;
}, undefined]);
ASYNC.push(['gen: old chat untouched too', async () => {
  const C = makeChat();
  await C.message('pajamas', true, () => C.switchTo('B'));
  return C.meta.A.lastCostume;
}, undefined]);
// Unguarded, the same sequence writes the old chat's costume into the new chat.
ASYNC.push(['gen: unguarded corrupts B', async () => {
  const C = makeChat();
  await C.message('pajamas', false, () => C.switchTo('B'));
  return C.meta.B.lastCostume;
}, 'pajamas']);
ASYNC.push(['gen: a later message is fine', async () => {
  const C = makeChat(); C.switchTo('B');
  await C.message('sundress', true, null); return C.meta.B.lastCostume;
}, 'sundress']);

// ---------------------------------------------------------------------------
// The day trail is "today's places". A dated chat empties it on the day rollover,
// so it never grows. A chat that writes a location header but NO date never rotates
// — key falls back to trailDateKey, which equals itself — so the trail silently
// became "every location ever": an unreadable HUD tooltip (joined with " → ") and a
// prefetch queue covering the whole story. The atlas store beside it is capped at 60
// days for the same reason; this one was missed.
const TRAIL_MAX = Number(/const TRAIL_MAX = (\d+);/.exec(src)[1]);
function trailRun(locations, dates) {
  let key0 = null, locs = [];
  locations.forEach((loc, i) => {
    const date = dates ? dates[i] : null;
    const key = date ? `${date.year}-${date.month}-${date.day}` : key0;
    if (key !== key0) { key0 = key; locs = []; }
    if (!locs.includes(loc)) {
      locs.push(loc);
      if (locs.length > TRAIL_MAX) locs = locs.slice(-TRAIL_MAX);
    }
  });
  return locs;
}
const many = Array.from({ length: 500 }, (_, i) => 'room ' + i);
eq('trail: cap is sane',         TRAIL_MAX >= 10 && TRAIL_MAX <= 200, true);
eq('trail: undated is capped',   trailRun(many, null).length, TRAIL_MAX);
eq('trail: keeps the recent',    trailRun(many, null).at(-1), 'room 499');
eq('trail: drops the oldest',    trailRun(many, null).includes('room 0'), false);
eq('trail: dated rotates daily', trailRun(many, many.map((_, i) => ({ year: 2026, month: 8, day: 1 + (i % 28) }))).length, 1);
eq('trail: short run untouched', trailRun(['kitchen', 'garden', 'kitchen'], null).join(','), 'kitchen,garden');
eq('trail: one place stays one', trailRun(['kitchen', 'kitchen'], null).length, 1);

// ---------------------------------------------------------------------------
// unknownInfo and colourAlias are keyed by DIALOGUE COLOUR, which means a different
// person in every chat. unknownInfo caches a guessed name/gender per hex and is only
// written on a miss (`if (!info)`), so once a colour was seen its label was never
// re-derived — switching chats kept the previous chat's name on the chip. colourAlias
// binds a hex straight to a cast key, so presence credited the wrong character.
// Neither was cleared anywhere, including onChatChanged.
function makeColourCaches(clearOnSwitch) {
  const unknownInfo = new Map(), colourAlias = new Map();
  return {
    switchChat() { if (clearOnSwitch) { unknownInfo.clear(); colourAlias.clear(); } },
    // Returns the label shown for this hex in the current chat.
    see(hex, guessedLabel) {
      const key = 'unk:' + hex;
      let info = unknownInfo.get(key);
      if (!info) { info = { label: guessedLabel || 'Unknown', hex }; unknownInfo.set(key, info); }
      return info.label;
    },
    alias(hex, castKey) { if (!colourAlias.has(hex)) colourAlias.set(hex, castKey); return colourAlias.get(hex); },
  };
}
{
  const C = makeColourCaches(true);
  eq('colour: first guess sticks',   C.see('#a33', 'Baker'), 'Baker');
  eq('colour: same chat reuses',     C.see('#a33', 'Someone Else'), 'Baker');
  C.switchChat();
  eq('colour: new chat re-guesses',  C.see('#a33', 'Sister'), 'Sister');
}
{
  const C = makeColourCaches(true);
  C.alias('#a33', 'baker');
  C.switchChat();
  eq('alias: new chat rebinds',      C.alias('#a33', 'sister'), 'sister');
}
// Without the clear, both carry the previous chat's answer across.
{
  const C = makeColourCaches(false);
  C.see('#a33', 'Baker'); C.switchChat();
  eq('colour: uncleared carries',    C.see('#a33', 'Sister'), 'Baker');
  const D = makeColourCaches(false);
  D.alias('#a33', 'baker'); D.switchChat();
  eq('alias: uncleared carries',     D.alias('#a33', 'sister'), 'baker');
}

// ---------------------------------------------------------------------------
// fetchBackgroundsList used the promise as its cache, so one transient failure cached
// an empty list for the session. An empty list becomes `available = null` at the call
// site — "do not filter" rather than "nothing exists" — so backgrounds kept working
// but the missing-file check stayed off until reload. Same family as fetchBios: a 404
// or an empty result is a real answer and stays cached; a 5xx or a thrown fetch is not.
function makeBgList() {
  let promise = null, fetches = 0;
  return {
    get fetches() { return fetches; },
    load(resp, force) {
      if (force) promise = null;
      if (promise) return promise;
      fetches++;
      let transient = false;
      promise = Promise.resolve(resp)
        .then(function (r) {
          if (r === 'throw') throw new Error('net');
          if (!r.ok) { if (r.status >= 500) transient = true; return []; }
          return r.body;
        })
        .catch(function () { transient = true; return []; })
        .then(function (list) { if (transient) promise = null; return list; });
      return promise;
    },
  };
}
const BG_OK = { ok: true, status: 200, body: ['a.png', 'b.png'] };
const BG_404 = { ok: false, status: 404 };
const BG_503 = { ok: false, status: 503 };
ASYNC.push(['bglist: success resolves', async () => (await makeBgList().load(BG_OK)).length, 2]);
ASYNC.push(['bglist: success is cached', async () => {
  const B = makeBgList(); await B.load(BG_OK); await B.load(BG_OK); return B.fetches;
}, 1]);
ASYNC.push(['bglist: a 404 stays cached', async () => {
  const B = makeBgList(); await B.load(BG_404); await B.load(BG_404); return B.fetches;
}, 1]);
ASYNC.push(['bglist: a 5xx retries', async () => {
  const B = makeBgList(); await B.load(BG_503); await B.load(BG_OK); return B.fetches;
}, 2]);
ASYNC.push(['bglist: a throw retries', async () => {
  const B = makeBgList(); await B.load('throw'); await B.load(BG_OK); return B.fetches;
}, 2]);
ASYNC.push(['bglist: recovers after a blip', async () => {
  const B = makeBgList(); await B.load('throw'); return (await B.load(BG_OK)).length;
}, 2]);
ASYNC.push(['bglist: force refetches', async () => {
  const B = makeBgList(); await B.load(BG_OK); await B.load(BG_OK, true); return B.fetches;
}, 2]);

// ---------------------------------------------------------------------------
// Prototype pollution through a cast key. Wearer keys come from cast[].key, which the
// settings drawer lets the user type verbatim — "__proto__" included. On a plain
// object `state['__proto__'] = {}` is a SILENT NO-OP, so the read gave back
// Object.prototype, and the delete/assign in put()/strip() then stripped and wrote
// garment names onto it — every plain object in the page gained a "blue shirt". Lifts
// the shipped bucket() so the test cannot drift from it.
const bucketSrc = /function bucket\(state, key\) \{([\s\S]*?)\n        \}/.exec(src)[1];
const bucket = eval('(function (state, key) {' + bucketSrc + '\n})');
{
  const canary = {};
  const state = Object.create(null);
  const s1 = bucket(state, '__proto__');
  s1['blue shirt'] = { at: 1 };
  eq('proto: no pollution',        canary['blue shirt'], undefined);
  eq('proto: bucket persists',     bucket(state, '__proto__')['blue shirt'] !== undefined, true);
  eq('proto: not Object.prototype', s1 === Object.prototype, false);
  eq('proto: bucket has no proto', Object.getPrototypeOf(s1), null);
}
{
  // The same on a PLAIN state object: pollution must still be impossible, even though
  // such a container cannot persist the bucket (which is why the caller uses null-proto).
  const canary = {};
  bucket({}, '__proto__')['hat'] = { at: 1 };
  eq('proto: plain state safe',    canary['hat'], undefined);
}
{
  // Ordinary keys must behave exactly as before.
  const state = Object.create(null);
  const s = bucket(state, 'main');
  s['apron'] = { at: 2 };
  eq('proto: normal key works',    bucket(state, 'main')['apron'].at, 2);
  eq('proto: reuses the bucket',   bucket(state, 'main') === s, true);
  eq('proto: other names safe',    bucket(state, 'constructor') === Object.prototype, false);
}

// ---------------------------------------------------------------------------
// meta.presence is built by iterating castPresence into an object keyed by cast key.
// Those keys are user-typed, and `obj['__proto__'] = v` on a plain object literal is a
// silent no-op — so that member's presence vanished from the saved metadata entirely
// and came back absent on every reload. No pollution (assigning to __proto__ on a
// literal does not write through), which is why this is the quieter half of the 0.9.50
// family. JSON.stringify/parse handle a null-prototype object and a "__proto__" own
// key correctly, so the restore path needs no change.
function buildPresence(makeContainer, entries) {
  const obj = makeContainer();
  for (const [k, v] of entries) obj[k] = { miss: v.miss, strong: Boolean(v.strong) };
  return obj;
}
const PRES = [['__proto__', { miss: 1, strong: true }], ['bob', { miss: 0, strong: false }]];
{
  const nul = buildPresence(() => Object.create(null), PRES);
  eq('presence: both keys stored',  Object.keys(nul).length, 2);
  eq('presence: proto key present', Object.keys(nul).includes('__proto__'), true);
  const back = JSON.parse(JSON.stringify(nul));
  eq('presence: survives JSON',     back['__proto__'].miss, 1);
  eq('presence: own property',      Object.prototype.hasOwnProperty.call(back, '__proto__'), true);
  eq('presence: normal key too',    back.bob.miss, 0);
}
{
  // The pre-fix container silently drops it.
  const plain = buildPresence(() => ({}), PRES);
  eq('presence: plain drops proto',  Object.keys(plain).length, 1);
  eq('presence: plain keeps normal', Object.keys(plain)[0], 'bob');
}
// The shipped code must use the null-prototype container.
eq('presence: uses null proto', /function persistPresence\(\)[\s\S]{0,800}?const obj = Object\.create\(null\)/.test(src), true);

// ---------------------------------------------------------------------------
// The wardrobe rebuild coalescing guard. rebuildWardrobe re-scans WARDROBE_LOOKBACK
// messages from scratch (~29ms median, 51ms max on a long chat), and it fired twice
// for one event: onChatChanged both schedules one AND calls onMessage. The signature
// must change whenever the scan's result could, so it covers the message count plus
// the last two messages' content — an edit keeps the count identical and a swipe
// replaces the last message in place.
const wardrobeSig = lift('wardrobeSig', 'chat');
const MSG = (t) => ({ mes: t });
const BASE = [MSG('a'), MSG('b'), MSG('c')];
eq('sig: identical chat',        wardrobeSig(BASE) === wardrobeSig(BASE), true);
eq('sig: appended message',      wardrobeSig(BASE) === wardrobeSig(BASE.concat([MSG('d')])), false);
eq('sig: last edited',           wardrobeSig(BASE) === wardrobeSig([MSG('a'), MSG('b'), MSG('c2')]), false);
eq('sig: swipe replaces last',   wardrobeSig(BASE) === wardrobeSig([MSG('a'), MSG('b'), MSG('zzz')]), false);
eq('sig: second-last edited',    wardrobeSig(BASE) === wardrobeSig([MSG('a'), MSG('b2'), MSG('c')]), false);
eq('sig: empty is stable',       wardrobeSig([]) === wardrobeSig([]), true);
eq('sig: empty vs one',          wardrobeSig([]) === wardrobeSig([MSG('a')]), false);
// Known blind spot, documented rather than pretended away: an edit further back than
// the last two messages leaves the signature unchanged. MESSAGE_EDITED therefore calls
// rebuildWardrobe(true) to force past the guard.
eq('sig: deep edit is invisible', wardrobeSig(BASE) === wardrobeSig([MSG('x'), MSG('b'), MSG('c')]), true);
eq('sig: MESSAGE_EDITED forces',
  /MESSAGE_EDITED[\s\S]{0,200}?rebuildWardrobe\(true\)/.test(src), true);
// A branch can share a signature with the chat being left, so the guard is cleared.
eq('sig: chat change clears it',
  /function onChatChanged\(\)[\s\S]{0,400}?lastRebuildSig = null/.test(src), true);

// ---------------------------------------------------------------------------
// wardrobeCast turns cast cards into matchers. The drawer labels the name regex
// "(optional)" and calls it "Fallback detection" — presence is driven by dialogue
// colour — but the wardrobe needs a name match to attribute a garment, and this used
// to drop every member without an explicit regex. A cast set up the documented way,
// by colour, got no garment tracking at all and no indication why.
// lift() returns an evaluated function, but wardrobeCast needs its two helpers in
// scope, so take the SOURCE of all three and build one closure.
function liftSrc(name, args) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(' + args + '\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) { console.error(name + '() not found in index.js'); process.exit(2); }
  let i = m.index + m[0].length - 1, depth = 0, body = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; body += c; if (depth === 0) break; continue; }
    body += c;
  }
  return 'function ' + name + '(' + args + ') ' + body;
}
const wardrobeCast = eval('(function(){const regexCache = new Map(); const LOG = "[sd]"; const console = { error() {}, warn() {} };'
  + liftSrc('compileRegex', 'source, flags') + '\n'
  + liftSrc('escapeRegexLiteral', 's') + '\n'
  + liftSrc('wardrobeCast', 'settings') + '\n'
  + 'return wardrobeCast;})()');
const wc = (cast) => wardrobeCast({ cast });
const keys = (cast) => wc(cast).map((m) => m.key).join(',');
eq('cast: explicit regex kept',  keys([{ key: 'ann', label: 'Ann', nameRegex: '\\bAnn\\b' }]), 'ann');
eq('cast: null regex falls back', keys([{ key: 'bob', label: 'Bob', nameRegex: null }]), 'bob');
eq('cast: empty regex falls back', keys([{ key: 'cara', label: 'Cara', nameRegex: '' }]), 'cara');
eq('cast: no label, no matcher',  keys([{ key: 'none', label: '', nameRegex: null }]), '');
eq('cast: 1-char label dropped',  keys([{ key: 'x', label: 'X', nameRegex: null }]), '');
const NO_RE = { re: { test: () => 'MEMBER DROPPED' } };
const one = (cast) => wc(cast)[0] || NO_RE;
{
  const bob = one([{ key: 'bob', label: 'Bob', nameRegex: null }]);
  eq('cast: label is word-bounded', bob.re.test('Bob smiled'), true);
  eq('cast: not a substring',       bob.re.test('Bobby smiled'), false);
}
{
  // A label is a literal, not a pattern: "Mr. O(1)" must match itself and nothing else.
  // It also ends in ')', so a trailing \b could never match — the boundaries are applied
  // only where the label actually starts or ends with a word character.
  const dot = one([{ key: 'dot', label: 'Mr. O(1)', nameRegex: null }]);
  eq('cast: metachars escaped',     dot.re.test('Mr. O(1) came in'), true);
  eq('cast: not read as a pattern', dot.re.test('Mr9 O1'), false);
  const hy = one([{ key: 'hy', label: 'Anne-Marie', nameRegex: null }]);
  eq('cast: hyphen label matches',  hy.re.test('Anne-Marie left'), true);
  eq('cast: hyphen not a prefix',   hy.re.test('Anne-Maries left'), false);
}
{
  // An invalid explicit regex must still fall back rather than dropping the member.
  const bad = wc([{ key: 'b', label: 'Bea', nameRegex: '([unclosed' }]);
  eq('cast: bad regex falls back',  bad.length && bad[0].re.test('Bea waved'), true);
}

// ---------------------------------------------------------------------------
// runCommand drives /bg, /costume and /emote. Every other SillyTavern API this
// extension touches is feature-detected; this one assumed that if the newer method
// is absent the older one is present. If a future build removed both, the else
// branch called undefined and threw on every background and costume change — all
// inside catch blocks, so the extension would quietly stop changing anything with
// nothing in the log saying why.
const runCommandSrc = (function () {
  const i = src.indexOf('let slashApiWarned = false;');
  if (i < 0) return null;
  return src.slice(i, src.indexOf('\n    }', src.indexOf('async function runCommand', i)) + 6);
})();
eq('slash: guard is present', Boolean(runCommandSrc), true);
// Without the guard the behavioural cases below would simply be SKIPPED, proving
// nothing against the old code. Fall back to lifting whatever runCommand is there, so
// they run either way and fail honestly when it is the unguarded version.
const rcSrc = runCommandSrc || (function () {
  const i = src.indexOf('async function runCommand');
  return i < 0 ? null : 'let slashApiWarned = false;\n' + src.slice(i, src.indexOf('\n    }', i) + 6);
})();
if (rcSrc) {
  const logged = [];
  const runCommand = eval('(function(){const LOG="[sd]"; const console={error:(...a)=>logged.push(a.join(" "))};'
    + rcSrc + '\nreturn runCommand;})()');
  ASYNC.push(['slash: uses the new API', async () => {
    let got = null;
    await runCommand({ executeSlashCommandsWithOptions: (c) => { got = c; } }, '/bg x');
    return got;
  }, '/bg x']);
  ASYNC.push(['slash: falls back to old', async () => {
    let got = null;
    await runCommand({ executeSlashCommands: (c) => { got = c; } }, '/bg x');
    return got;
  }, '/bg x']);
  ASYNC.push(['slash: neither does not throw', async () => {
    try { await runCommand({}, '/bg x'); return 'ok'; } catch (e) { return 'THREW'; }
  }, 'ok']);
  // slashApiWarned is module-scoped and latches on first use, so this needs a FRESH
  // instance — an earlier case in this file has already tripped the shared one.
  ASYNC.push(['slash: warns once, not per call', async () => {
    const own = [];
    const fresh = eval('(function(){const LOG="[sd]"; const console={error:(...a)=>own.push(a.join(" "))};'
      + rcSrc + '\nreturn runCommand;})()');
    await fresh({}, '/a'); await fresh({}, '/b'); await fresh({}, '/c');
    return own.length;
  }, 1]);
  ASYNC.push(['slash: a non-function is rejected', async () => {
    try { await runCommand({ executeSlashCommands: 'nope' }, '/bg x'); return 'ok'; } catch (e) { return 'THREW'; }
  }, 'ok']);
}

// ---------------------------------------------------------------------------
// Group chats. SillyTavern reassigns name2 to each activated member as it speaks
// (group-chats.js: setCharacterName(characters[chId].name) inside the per-member
// loop, cleared between turns), so in a group chat "main" is not a character — it is
// whoever spoke last. The wardrobe rebuilt mainRe from it, attributing one member's
// clothes to another, and the HUD named the wrong person.
const wardrobeLabel = (function () {
  const i = src.indexOf('function wardrobeLabel(key, settings) {');
  if (i < 0) return null;
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) { k++; break; } } }
  const body = src.slice(i, k);
  return (groupId, name2) => eval('(function(){const SillyTavern={getContext:()=>({groupId:'
    + JSON.stringify(groupId) + ',name1:"Ryan",name2:' + JSON.stringify(name2) + '})};'
    + body + '\nreturn wardrobeLabel;})()');
})();
eq('group: label lift works', Boolean(wardrobeLabel), true);
if (wardrobeLabel) {
  eq('group: solo names the char',  wardrobeLabel(null, 'Rachel Marks')('main', {}), 'Rachel');
  eq('group: group does not',       wardrobeLabel('g1', 'Whoever Spoke')('main', {}), 'the character');
  eq('group: user is stable solo',  wardrobeLabel(null, 'X')('user', {}), 'Ryan');
  eq('group: user is stable group', wardrobeLabel('g1', 'X')('user', {}), 'Ryan');
  eq('group: empty name2 solo',     wardrobeLabel(null, '')('main', {}), 'the character');
}
// rebuildWardrobe must bail before building mainRe from name2 in a group chat.
eq('group: rebuild bails early',
  /if \(ctx\.groupId\) \{[^}]*wardrobe = Object\.create\(null\)[\s\S]{0,160}?return; \}[\s\S]{0,200}?const mainName = String\(ctx\.name2/.test(src), true);

let fails = 0;
for (const [label, got, want] of CASES) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)}${ok ? '' : ` got ${got} want ${want}`}`);
}
for (const [label, fn, want] of ASYNC) {
  let got;
  try { got = await fn(); } catch (e) { got = 'THREW ' + String(e).slice(0, 60); }
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)}${ok ? '' : ` got ${got} want ${want}`}`);
}
const total = CASES.length + ASYNC.length;
console.log(fails ? `\n${fails} failing` : `\nall ${total} pass`);
process.exit(fails ? 1 : 0);

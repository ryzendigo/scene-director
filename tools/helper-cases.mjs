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

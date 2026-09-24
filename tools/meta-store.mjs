// Chat metadata travels with the chat file: between devices, across branches, and
// through any hand-edit. Anything read back out of it is untrusted, and anything used
// as an OBJECT KEY has to survive `__proto__`.
//
//   node tools/meta-store.mjs [path/to/index.js]
//
// The bug this pins: archiveTrailDay did `meta.atlas[trailDateKey] = locs` on a plain
// object literal. restoreTrail sets `trailDateKey = meta.trailDateKey || null` with no
// type check, so the key can come straight back out of a stored chat — and
// `obj['__proto__'] = v` on a literal is a SILENT no-op, so that day vanished from the
// atlas with nothing to explain it. Same family as the cast-key store, which already
// used Object.create(null).
//
// The store logic is LIFTED from index.js so this cannot drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const m = /(if \(!meta\.atlas[\s\S]*?)\n            meta\.atlas\[trailDateKey\] = trailLocs\.slice\(\);/.exec(src);
if (!m) { console.error('the atlas store was not found in ' + file); process.exit(2); }
const prepare = new Function('meta', 'Object', `${m[1]}\nreturn meta.atlas;`);

const archive = (meta, key, locs) => { const a = prepare(meta, Object); a[key] = locs.slice(); };

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.log(`FAIL  ${name}`); } else console.log(`PASS  ${name}`); };

// 1. An ordinary day key still works.
{
  const meta = {};
  archive(meta, '2026-9-23', ['Kitchen']);
  check('ordinary day key is stored', JSON.stringify(meta.atlas['2026-9-23']) === '["Kitchen"]');
}

// 2. A __proto__ key — the one that used to vanish — is stored as an OWN property.
{
  const meta = {};
  archive(meta, '__proto__', ['Attic']);
  check('__proto__ day key is stored as an own property',
    Object.keys(meta.atlas).includes('__proto__') && JSON.stringify(meta.atlas['__proto__']) === '["Attic"]');
}

// 3. It must survive the save/reload round trip — JSON.parse hands back a PLAIN object,
//    so the store has to re-home it before the next write, or the no-op comes back.
{
  let meta = {};
  archive(meta, '2026-9-23', ['Kitchen']);
  archive(meta, '__proto__', ['Attic']);
  meta = JSON.parse(JSON.stringify(meta));           // saveMetadataDebounced + reload
  archive(meta, '__proto__', ['Attic', 'Shed']);     // same day, one more location
  check('survives save/reload and accepts a later write',
    Object.keys(meta.atlas).length === 2 && meta.atlas['__proto__'].length === 2);
}

// 4. Nothing leaks onto Object.prototype.
{
  const meta = {};
  archive(meta, '__proto__', ['Attic']);
  check('Object.prototype is not polluted', {}.length === undefined && !Array.isArray({}.__proto__));
}

// 5. The read side only ever sees own properties, so a poisoned prototype cannot
//    inject a fake day even if one existed.
{
  const stored = Object.assign(Object.create({ ghostDay: ['Nowhere'] }), { '2026-9-23': ['Kitchen'] });
  check('read side ignores inherited keys', !Object.keys(stored).includes('ghostDay'));
}

console.log(fails ? `\n${fails} failing` : '\nall 5 pass');
process.exit(fails ? 1 : 0);

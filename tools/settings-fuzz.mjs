// Fuzz the REAL migrateSettings with hostile settings objects. Anything that throws,
// or leaves a shape a later reader would choke on, is a bug: migrateSettings is the
// only thing standing between a hand-edited settings file and every engine.
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2] || new URL('../index.js', import.meta.url).pathname, 'utf8');

function lift(name, args) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(' + args + '\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) throw new Error(name + ' not found');
  let i = m.index + m[0].length - 1, d = 0, b = '';
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; b += c; if (d === 0) break; continue; } b += c; }
  return b;
}
const defaults = /const defaultSettings = \{[\s\S]*?\n    \};/.exec(src)[0];
const prelude = defaults + '\nconst LOG="[sd]"; const console={error(){},warn(){},log(){}};\n'
  + 'function compileRegex(p){ try { return new RegExp(p,"i"); } catch(e){ return null; } }\n'
  + 'function prettyNameFromPattern(){ return "x"; }\n'
  + 'function slugify(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-"); }\n';
const migrate = eval('(function(){' + prelude + 'return function (s) ' + lift('migrateSettings', 's') + ';})()');

const HOSTILE = [
  ['null cast', { cast: null }],
  ['cast of nulls', { cast: [null, null] }],
  ['cast of scalars', { cast: [1, 'x', true] }],
  ['cast without keys', { cast: [{}, {}] }],
  ['cast duplicate keys', { cast: [{ key: 'a' }, { key: 'a' }, { key: 'a' }] }],
  ['cast key non-string', { cast: [{ key: 42 }, { key: 42 }] }],
  ['places null', { places: null }],
  ['places of nulls', { places: [null] }],
  ['places no slots', { places: [{ pattern: 'x' }] }],
  ['rule lists scalar', { eraRules: 5, seasonalMap: 'x', costumeRules: true, counters: 1 }],
  ['rule lists of nulls', { eraRules: [null], costumeRules: [null] }],
  ['backgroundMap junk', { backgroundMap: [null, 1, { pattern: 'p' }] }],
  ['deeply nested', { cast: [{ key: 'a', bio: { a: { b: { c: 1 } } } }] }],
  ['huge cast', { cast: Array.from({ length: 500 }, () => ({ key: 'dup' })) }],
  ['prototype-ish key', { cast: [{ key: '__proto__' }, { key: '__proto__' }] }],
  ['empty object', {}],
];

let fails = 0;
for (const [label, obj] of HOSTILE) {
  const s = { ...JSON.parse(JSON.stringify(eval('(' + defaults.replace(/^const defaultSettings = /, '') .replace(/;$/, '') + ')'))), ...obj };
  let verdict = 'ok';
  try {
    migrate(s);
    if (!Array.isArray(s.cast)) verdict = 'BAD: cast is not an array after migrate';
    else if (s.cast.some((m) => !m || typeof m !== 'object')) verdict = 'BAD: non-object left in cast';
    else {
      const keys = s.cast.map((m) => m.key);
      if (new Set(keys).size !== keys.length) verdict = 'BAD: duplicate keys survived';
    }
    if (verdict === 'ok' && !Array.isArray(s.places)) verdict = 'BAD: places is not an array';
    if (verdict === 'ok' && s.places.some((p) => !p || typeof p !== 'object')) verdict = 'BAD: non-object left in places';
  } catch (e) { verdict = 'THREW ' + (e && e.message); }
  if (verdict !== 'ok') fails++;
  console.log((verdict === 'ok' ? 'PASS  ' : 'FAIL  ') + label.padEnd(22) + (verdict === 'ok' ? '' : verdict));
}
console.log(fails ? `\n${fails} failing` : `\nall ${HOSTILE.length} hostile inputs survived`);
process.exit(fails ? 1 : 0);

// Every generic-*.jpg the starter pack ships must be selectable by some lexicon key,
// and every key should have a file. An unreachable file is dead weight the installer
// downloads and nothing can ever show; a keyless key is a background a user must supply.
//
// Found generic-rooftop-day-night.jpg this way: 242KB in the pack, listed in index.json,
// matching no key — "rooftop-day" is not a scene name, and generic-rooftop-night.jpg
// already covers the night case. Left in place because deleting a shipped asset is not
// mine to decide; this check keeps it visible.
import { readFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const src = readFileSync(root + 'index.js', 'utf8');
function engine(tag) {
  const b = `// === ${tag} ENGINE (pure) BEGIN ===`, e = `// === ${tag} ENGINE (pure) END ===`;
  const i = src.indexOf(b); return src.slice(i + b.length, src.indexOf(e));
}
const P = 'const LOG="[sd]"; const console={error(){},warn(){}};\nfunction dbg(){}\n'
  + 'function compileRegex(p){try{return new RegExp(p,"i");}catch(e){return null;}}\n';
const BG = eval('(function(){' + P + engine('BACKGROUND') + '\nreturn BackgroundEngine;})()');
const T = BG.compileTables();
const keys = new Set(T.generic.map((g) => g.key));
for (const n of T.nouns) keys.add(n.key);

const keysHas = (k) => keys.has(k);
const files = JSON.parse(readFileSync(root + 'backgrounds/index.json', 'utf8'));
const bases = new Set();
for (const f of files) {
  // Strip at most ONE trailing variant, and only if what remains is itself a key.
  // A blind strip broke tokyo-alley-night, which IS a key (an inherently nocturnal
  // scene) — its -night-night.jpg is the variant of that base, not a doubled suffix.
  const m = /^generic-(.+?)\.(?:jpg|jpeg|png|webp)$/i.exec(f);
  if (!m) continue;
  const full = m[1];
  const stripped = full.replace(/-(?:night|rain|dusk)$/i, '');
  bases.add(keysHas(full) ? full : stripped);
}
const unreachable = [...bases].filter((b) => !keys.has(b)).sort();
const keyless = [...keys].filter((k) => !bases.has(k)).sort();
console.log('generic files shipped :', bases.size);
console.log('lexicon keys          :', keys.size);
console.log('\nshipped but NO key can select them:', unreachable.length);
for (const u of unreachable) console.log('   generic-' + u + '.jpg');
console.log('\nkeys with no shipped file:', keyless.length, '(fine — a user may add their own)');
for (const k of keyless.slice(0, 10)) console.log('   ' + k);
// Unreachable files are the failure; keyless keys are expected and only reported.
process.exit(unreachable.length ? 1 : 0);

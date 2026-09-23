// Two function declarations sharing a name in one file is how v0.9.57's dead
// sentenceAround hid: all three callers resolved to the engine's copy, while a
// module-scope duplicate sat unused — and a mutation probe that patched "the first
// occurrence" silently tested the dead one and reported a false coverage hole.
//
// Duplicates INSIDE separate engine IIFEs are fine and expected (MoodEngine.describe
// and WardrobeEngine.describe are different functions). What this flags is two
// declarations that land in the SAME scope, where one is unreachable.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

const spans = [];
for (const tag of ['MOOD', 'PRESENCE', 'WARDROBE', 'POSE', 'BACKGROUND', 'ATLAS']) {
  const b = src.indexOf(`// === ${tag} ENGINE (pure) BEGIN ===`);
  const e = src.indexOf(`// === ${tag} ENGINE (pure) END ===`);
  if (b < 0 || e < 0) continue;
  spans.push([tag, src.slice(0, b).split('\n').length, src.slice(0, e).split('\n').length]);
}
const scopeOf = (n) => { for (const [t, a, b] of spans) if (n >= a && n <= b) return t; return 'module'; };

const seen = new Map();
lines.forEach((l, i) => {
  const m = /^(\s*)function\s+([a-zA-Z_]\w*)\s*\(/.exec(l);
  if (!m) return;
  const key = m[2];
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push({ line: i + 1, indent: m[1].length, scope: scopeOf(i + 1) });
});

// Count calls that can reach a given declaration. A module-scope copy is only reachable
// from outside every engine; an engine's copy is reachable from within its own block.
function callsReaching(name, decl) {
  let n = 0;
  // Bare calls from inside the same block.
  for (const m of src.matchAll(new RegExp('(?<![.\\w])' + name + '\\s*\\(', 'g'))) {
    const line = src.slice(0, m.index).split('\n').length;
    if (line === decl.line) continue;                 // the declaration itself
    if (scopeOf(line) === decl.scope) n++;
  }
  // An engine's function is also reachable from anywhere as EngineName.fn(...), which the
  // bare-call pattern deliberately excludes. Without this, every exported engine function
  // called only through its handle looked uncalled — describe and evaluate both did.
  if (decl.scope !== 'module') {
    const handle = decl.scope.charAt(0) + decl.scope.slice(1).toLowerCase() + 'Engine';
    n += [...src.matchAll(new RegExp(handle + '\\.' + name + '\\s*\\(', 'g'))].length;
  }
  return n;
}

const problems = [];
for (const [name, hits] of seen) {
  if (hits.length < 2) continue;
  // Two declarations in the SAME scope: one shadows the other outright.
  const groups = new Map();
  for (const h of hits) {
    const k = h.scope + '@' + h.indent;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  for (const [k, g] of groups) {
    if (g.length > 1) problems.push(`${name}: ${g.length} declarations in ${k} — lines ${g.map((h) => h.line).join(', ')}`);
  }
  // Different scopes is legal (MoodEngine.describe vs WardrobeEngine.describe), but a
  // copy that NOTHING in its own scope calls is the v0.9.57 case: dead code wearing a
  // live name, which an edit or a mutation probe will silently patch instead.
  for (const h of hits) {
    if (callsReaching(name, h) === 0) {
      problems.push(`${name}: the declaration at line ${h.line} (${h.scope}) has no caller in its scope,`
        + ` while the name is also declared at ${hits.filter((x) => x !== h).map((x) => x.line).join(', ')}`);
    }
  }
}

if (problems.length) {
  console.log(`duplicate function declarations in one scope: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  console.log('\nOne of them is unreachable. Remove it, or rename if both are wanted.');
  process.exit(1);
}
console.log(`no function name is declared twice in the same scope (${seen.size} functions checked)`);

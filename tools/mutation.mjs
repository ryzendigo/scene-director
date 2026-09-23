// Sabotage one engine function at a time and check that some suite notices. A suite that
// passes on a mutant is not testing that function, and until v0.9.56 five of six suites
// could not even be pointed at another build, so none had ever been checked this way.
//
// A SURVIVOR is a function every suite tolerates being broken. That is a coverage hole,
// not necessarily a bug — some exports are genuinely only used by the extension shell.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = readFileSync(join(root, 'index.js'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'sd-mut-'));

// Every function declared INSIDE an engine block, which is what the suites cover.
const targets = [];
for (const tag of ['MOOD', 'PRESENCE', 'WARDROBE', 'POSE', 'BACKGROUND', 'ATLAS']) {
  const b = `// === ${tag} ENGINE (pure) BEGIN ===`, e = `// === ${tag} ENGINE (pure) END ===`;
  const i = src.indexOf(b); if (i < 0) continue;
  const start = i + b.length, end = src.indexOf(e);
  const body = src.slice(start, end);
  for (const m of body.matchAll(/\n\s{8}function ([a-zA-Z_][\w]*)\s*\(([^)]*)\)\s*\{/g)) {
    targets.push({ tag, name: m[1], at: start + m.index + m[0].length });
  }
}

const SUITES = ['mood-cases', 'pose-cases', 'presence-cases', 'background-cases',
  'atlas-cases', 'helper-cases', 'wardrobe-harness'];

// Return something structurally plausible but wrong, so the mutant fails on BEHAVIOUR
// rather than by throwing on a missing property — a crash proves nothing about coverage.
// Two poisons. The first is subtle: pass the call through to the real body but strip
// the result down to a benign empty value, so the mutant behaves wrongly rather than
// throwing. A crash kills a mutant trivially and proves nothing about coverage, which
// is why a sweep using only a crashing poison reported 44/44 killed and was worthless.
const POISONS = [
  ['null', ' return null;'],
  ['empty', " return (function(){ const o = []; o.toLowerCase = () => ''; return o; })();"],
];

// A mutant only counts as killed if a suite FAILED cases. A suite that crashed is
// reporting that the poison broke an invariant it never asserts, which is not evidence
// the function is covered.
function verdictFor(file) {
  for (const s of SUITES) {
    let out = '';
    try {
      execFileSync('node', [join(root, 'tools', s + '.mjs'), '--src=' + file],
        { stdio: 'pipe', timeout: 60000 });
      continue;                                   // suite passed
    } catch (e) {
      out = String((e.stdout || '') + (e.stderr || ''));
    }
    if (/\d+ failing/.test(out)) return { kind: 'failed', suite: s };
    return { kind: 'crashed', suite: s };
  }
  return { kind: 'survived' };
}

const survivors = [], killed = [], crashed = [];
for (const t of targets) {
  let verdict = { kind: 'survived' };
  for (const [label, poison] of POISONS) {
    const file = join(dir, `${t.tag}_${t.name}_${label}.js`);
    writeFileSync(file, src.slice(0, t.at) + poison + src.slice(t.at));
    const v = verdictFor(file);
    if (v.kind === 'failed') { verdict = v; break; }          // best outcome, stop here
    if (v.kind === 'crashed' && verdict.kind === 'survived') verdict = v;
  }
  if (verdict.kind === 'failed') killed.push(`${t.tag}.${t.name} (${verdict.suite})`);
  else if (verdict.kind === 'crashed') crashed.push(`${t.tag}.${t.name} (${verdict.suite})`);
  else survivors.push(`${t.tag}.${t.name}`);
}

// SURVIVED is the number that matters: a function no suite reacts to at all.
console.log(`functions: ${targets.length}   killed by failing cases: ${killed.length}`
  + `   only crashed a suite: ${crashed.length}   SURVIVED: ${survivors.length}`);
if (crashed.length) {
  console.log('\nbreaking these CRASHES a suite rather than failing cases. That is a weaker');
  console.log('signal, and mostly says the poison returned a shape nothing can consume — it');
  console.log('does NOT prove the function is uncovered. Checked by hand: a type-correct');
  console.log('sabotage of WARDROBE.norm fails 16 wardrobe cases, so that one is well covered');
  console.log('despite appearing here. Treat this list as "worth a hand-written mutant", not');
  console.log('as a coverage hole:');
  for (const c of crashed) console.log('  ' + c);
}
if (survivors.length) {
  console.log('\nno suite reacts at all when these are broken:');
  for (const s of survivors) console.log('  ' + s);
}
process.exit(survivors.length ? 1 : 0);

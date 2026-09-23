// Drive the REAL pure engines with pathological message text. The engines parse
// arbitrary model output, so the input is never under our control: a truncated
// generation, a wall of emoji, a message that is one 200KB word, nested markup.
// Anything that throws, hangs, or returns a shape the callers do not expect is a bug.
import { readFileSync } from 'node:fs';
const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

function engine(tag) {
  const b = `// === ${tag} ENGINE (pure) BEGIN ===`;
  const e = `// === ${tag} ENGINE (pure) END ===`;
  const i = src.indexOf(b), j = src.indexOf(e);
  if (i < 0 || j < 0) return null;
  return src.slice(i + b.length, j);
}
const PRELUDE = 'const LOG="[sd]"; const MAX_SCAN=20000; const console={error(){},warn(){},log(){}};\n'
  + 'function dbg(){} function compileRegex(p){ try { return new RegExp(p,"i"); } catch(e){ return null; } }\n';
const load = (tag, expose) => eval('(function(){' + PRELUDE + engine(tag) + '\nreturn ' + expose + ';})()');

const Presence = load('PRESENCE', 'PresenceEngine');
const Mood = load('MOOD', 'MoodEngine');
const Wardrobe = load('WARDROBE', 'WardrobeEngine');
const Pose = load('POSE', 'PoseEngine');

const R = (n, s) => s.repeat(n);
const INPUTS = [
  ['empty', ''],
  ['whitespace only', '   \n\t  \n '],
  ['one huge word', R(20000, 'a')],
  ['200k of prose', R(4000, 'She smiled at him. ')],
  ['all emoji', R(3000, '😊🌧️📍')],
  ['unclosed details', '<details><summary>x</summary>' + R(500, 'she wore a blue shirt ')],
  ['nested details', R(200, '<details>') + 'naked' + R(200, '</details>')],
  ['unclosed quote', '"' + R(2000, 'she said ')],
  ['all quotes', R(5000, '"')],
  ['asterisk storm', R(5000, '*')],
  ['markup soup', R(1000, '<b><i><u>x</u></i></b>')],
  ['null bytes', 'she wore a \u0000 blue shirt'],
  ['RTL + combining', R(500, 'she wore á̂̃ ‮shirt ')],
  ['lone surrogates', 'she wore \uD800 a shirt \uDFFF'],
  ['newline storm', R(20000, '\n')],
  ['one line, no spaces', R(2000, 'shewore')],
  ['repeated garment', R(1000, 'she put on a dress and took off a dress. ')],
  ['every pronoun', R(1000, 'she he her his they them it we you I ')],
  ['header spam', R(1000, '📍 the kitchen | 🕰️ 9:00 AM | ☀️ ')],
  // The wardrobe matchers are superlinear in SENTENCE length, so a run-on is far worse
  // than a long message. 41KB in one sentence took 811ms before the MAX_SENT cap.
  ['one 40KB sentence', R(1600, 'she wore a blue shirt and ')],
  ['one 40KB sentence, no garments', R(2000, 'the light moved across the floor and ')],
];

// Warm every engine first: an unwarmed first call showed 32ms for an EMPTY string, which
// is compilation, not cost, and would produce false failures at a 60ms budget.
for (let w = 0; w < 3; w++) {
  const warm = 'She wore a blue shirt. He said nothing.';
  Presence.mask(warm); Mood.isIntimate(warm); Mood.lexicon({ parts: [warm], text: warm }, Mood.compileLexicon({}));
  Wardrobe.scan(warm, [], Object.create(null), { at: 0, speaker: 'main' }); Pose.detect(warm);
}

let fails = 0;
// The shipped per-message budget is 60ms for ALL engines together, and the wardrobe
// rebuild runs over 80 messages. 60 per engine per input is already generous; 400 was
// loose enough to pass an 811ms quadratic blowup, which is how it went unnoticed.
const BUDGET = 60;
for (const [label, text] of INPUTS) {
  const problems = [];
  let worst = 0, worstName = '-';
  const run = (name, fn) => {
    const t0 = process.hrtime.bigint();
    let out;
    try { out = fn(); }
    catch (e) { problems.push(`${name} THREW ${String(e && e.message).slice(0, 60)}`); return; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > worst) { worst = ms; worstName = name; }
    if (ms > BUDGET) problems.push(`${name} took ${ms.toFixed(0)}ms`);
    return out;
  };
  const masked = run('mask', () => Presence.mask(text));
  if (masked && (typeof masked.narr !== 'string')) problems.push('mask returned no narr string');
  run('nameGuess', () => Presence.nameGuess(masked || { narr: '', quotes: '' }, 0, new Set()));
  run('lexicon', () => Mood.lexicon({ parts: [text], text }, Mood.compileLexicon({})));
  run('isIntimate', () => Mood.isIntimate(text));
  run('classifierText', () => Mood.classifierText({ parts: [text], text }, 1200));
  run('wardrobe.scan', () => Wardrobe.scan(text, [], Object.create(null), { at: 0, speaker: 'main' }));
  run('pose.detect', () => Pose.detect(text));
  if (problems.length) { fails++; console.log(`FAIL  ${label.padEnd(22)} ${problems.join('; ')}`); }
  else console.log(`PASS  ${label.padEnd(22)} (${String(text.length).padStart(6)} chars, ${worst.toFixed(1)}ms worst engine: ${worstName})`);
}
console.log(fails ? `\n${fails} of ${INPUTS.length} inputs had problems` : `\nall ${INPUTS.length} pathological inputs survived`);
process.exit(fails ? 1 : 0);

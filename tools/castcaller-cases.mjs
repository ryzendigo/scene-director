// analyzeCast mostly delegates to PresenceEngine (61 cases in presence-cases.mjs), but
// three things live in the CALLER and had no coverage:
//
//   1. the contextRegex gate — skips a member AND deletes their presence, so a chip
//      cannot linger in a scene the member's context does not match
//      ("Gran made that dress" must not put her chip in a room 9,000 miles away)
//   2. hexLabel — turns a dialogue colour into a display name, with the main
//      character's own hex winning over any cast card
//   3. the speaker position — lastIndexOf over the member's hex AND its colour aliases
//
//   node tools/castcaller-cases.mjs [path/to/index.js]
//
// Each behaviour is LIFTED or reconstructed from index.js line-for-line.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const body = /function analyzeCast\(scene, settings, locChanged\) \{[\s\S]*?\n    \}/.exec(src);
if (!body) { console.error('analyzeCast not found in ' + file); process.exit(2); }

const compileRegex = (p) => { try { return typeof p === 'string' && p ? new RegExp(p, 'i') : null; } catch { return null; } };

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};

// --- 1. the contextRegex gate, lifted verbatim ---
const gateM = /const ctxRe = compileRegex\(member\.contextRegex \|\| ''\);\n\s*(if \(ctxRe && [^\n]+)/.exec(body[0]);
check('the contextRegex gate is still present', Boolean(gateM), true);
if (gateM) {
  const deletes = /castPresence\.delete\(member\.key\)/.test(gateM[1]);
  check('a failed gate DELETES presence, not just skips', deletes, true);

  const gate = new Function('compileRegex', 'member', 'scene', 'castPresence', `
    const ctxRe = compileRegex(member.contextRegex || '');
    ${gateM[1].replace('continue;', 'return "skipped";')}
    return 'evaluated';
  `);
  const del = new Set(['gran']);
  check('context not in the text -> member skipped',
    gate(compileRegex, { key: 'gran', contextRegex: 'virginia' }, { text: 'She stood in the kitchen.' }, del), 'skipped');
  check('...and their presence was deleted', del.has('gran'), false);
  check('context present -> evaluated',
    gate(compileRegex, { key: 'gran', contextRegex: 'virginia' }, { text: 'She stood in Virginia.' }, new Set()), 'evaluated');
  check('empty contextRegex is no gate',
    gate(compileRegex, { key: 'gran', contextRegex: '' }, { text: 'anywhere' }, new Set()), 'evaluated');
  check('missing contextRegex is no gate',
    gate(compileRegex, { key: 'gran' }, { text: 'anywhere' }, new Set()), 'evaluated');
  check('an INVALID contextRegex is no gate (must not hide the member for ever)',
    gate(compileRegex, { key: 'gran', contextRegex: '(unclosed' }, { text: 'anywhere' }, new Set()), 'evaluated');
}

// --- 2. hexLabel, lifted verbatim ---
const hexM = /const hexLabel = function \(h\) \{[\s\S]*?\n        \};/.exec(body[0]);
check('hexLabel is still present', Boolean(hexM), true);
if (hexM) {
  const mk = (ownHex, cast, unknown) => new Function('ownHex', 'settings', 'unknownInfo', 'SillyTavern', `
    ${hexM[0]}
    return hexLabel;
  `)(ownHex, { cast }, new Map(unknown || []), { getContext: () => ({ name2: 'Elise' }) });

  check('own hex wins, returning name2', mk('#56b4e9', [{ colorHex: '#56b4e9', label: 'Ben' }])('#56b4e9'), 'Elise');
  check('a cast card colour returns its label', mk('#56b4e9', [{ colorHex: '#64b5f6', label: 'Ben' }])('#64b5f6'), 'Ben');
  check('cast match is case-insensitive', mk(null, [{ colorHex: '#64B5F6', label: 'Ben' }])('#64b5f6'), 'Ben');
  check('a remembered unknown returns its guessed name',
    mk(null, [], [['unk:#abcdef', { label: 'the barman' }]])('#abcdef'), 'the barman');
  check('an unrecognised colour falls back to the hex itself', mk(null, [])('#123456'), '#123456');
  check('no own hex set does not misfire on undefined', mk(null, [])('#123456'), '#123456');
}

// --- 3. speaker position: the LAST mention wins, across aliases too ---
{
  const posM = /(let pos = member\.colorHex \? scene\.lower\.lastIndexOf[^\n]+\n\s*for \(const h of aliasHexes\)[^\n]+)/.exec(body[0]);
  check('the speaker-position lines are still present', Boolean(posM), true);
  const pos = posM
    ? new Function('scene', 'member', 'aliasHexes', `${posM[1]}\nreturn pos;`)
    : () => { throw new Error('not lifted'); };
  const call = (lower, hex, aliasHexes) => pos({ lower }, { colorHex: hex }, aliasHexes);
  const line = '<font color="#aaaaaa">a</font> <font color="#bbbbbb">b</font> <font color="#aaaaaa">c</font>';
  check('uses the LAST occurrence, not the first', call(line, '#aaaaaa', []), line.lastIndexOf('#aaaaaa'));
  check('an alias hex can win over the primary', call(line, '#cccccc', ['#bbbbbb']) === line.lastIndexOf('#bbbbbb'), true);
  check('no hex and no alias -> -1', call(line, null, []), -1);
  check('a hex that never appears -> -1', call(line, '#dddddd', []), -1);
}

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

// ownColorHex decides which dialogue colour belongs to the MAIN character. Four callers
// depend on it — presence analysis, thought tooltips, the mood verdict and the test
// button — and hexLabel() returns name2 for whatever hex it names, so a wrong answer
// labels another character's dialogue as the protagonist's.
//
//   node tools/owncolor-cases.mjs [path/to/index.js]
//
// The bug this pins: autoOwnHex is a module-level cache, set once and never cleared, so
// the FIRST chat opened decided the colour for the life of the page. Measured on real
// chats: one uses #56b4e9 for its protagonist, another #e87ba8. It is the third cache
// keyed by dialogue colour; the other two (unknownInfo, colourAlias) were already
// cleared on chat change for exactly this reason.
//
// The function is LIFTED from index.js so this cannot drift from what ships.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');

const fnM = /function ownColorHex\(ctx, settings\) \{[\s\S]*?\n    \}/.exec(src);
const reM = /const FONT_SPAN_RE = (\/[^\n]+?\/[a-z]*);/.exec(src);
if (!fnM || !reM) { console.error('ownColorHex or FONT_SPAN_RE not found in ' + file); process.exit(2); }

// A fresh module scope per scenario, so the cache behaves exactly as it does in a page.
function makeModule() {
  const mk = new Function('FONT_SPAN_RE', 'dbg', `
    let autoOwnHex = null;
    ${fnM[0]}
    return { ownColorHex, reset: () => { autoOwnHex = null; }, peek: () => autoOwnHex };
  `);
  return mk(eval(reM[1]), () => {});
}

const msg = (hex, n) => ({ is_user: false, is_system: false, mes: Array.from({ length: n }, () => `<font color="${hex}">line</font>`).join(' ') });
const chatOf = (hex, n = 5) => ({ chat: [msg(hex, n)] });

let fails = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) { fails++; console.log(`FAIL  ${name}  -> ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${name}`);
};

// --- an explicit setting always wins, and is normalised ---
{
  const M = makeModule();
  check('explicit setting wins', M.ownColorHex(chatOf('#56b4e9'), { ownColorHex: '#ABCDEF', cast: [] }), '#abcdef');
}

// --- auto-detection picks the most frequent colour not claimed by a cast card ---
{
  const M = makeModule();
  const ctx = { chat: [msg('#56b4e9', 5), msg('#111111', 1)] };
  check('picks the most frequent colour', M.ownColorHex(ctx, { cast: [] }), '#56b4e9');
}
{
  const M = makeModule();
  const ctx = { chat: [msg('#56b4e9', 5), msg('#222222', 2)] };
  check('skips a colour a cast card already claims',
    M.ownColorHex(ctx, { cast: [{ colorHex: '#56B4E9' }] }), '#222222');
}
{
  const M = makeModule();
  check('no colours at all -> null', M.ownColorHex({ chat: [{ is_user: false, mes: 'plain text' }] }, { cast: [] }), null);
}
{
  const M = makeModule();
  check('user and system messages are ignored',
    M.ownColorHex({ chat: [{ is_user: true, mes: '<font color="#ff0000">x</font>' },
      { is_system: true, mes: '<font color="#ff0000">x</font>' }] }, { cast: [] }), null);
}

// --- THE BUG: the cache must not survive a chat change ---
{
  const M = makeModule();
  const first = M.ownColorHex(chatOf('#56b4e9'), { cast: [] });
  const stale = M.ownColorHex(chatOf('#e87ba8'), { cast: [] });   // new chat, no reset
  check('cache is sticky within a chat (by design)', first === '#56b4e9' && stale === '#56b4e9', true);

  M.reset();                                                      // what onChatChanged does
  check('after a chat change the NEW chat colour is detected',
    M.ownColorHex(chatOf('#e87ba8'), { cast: [] }), '#e87ba8');
}

// --- and onChatChanged must actually contain that reset ---
check('onChatChanged clears autoOwnHex',
  /function onChatChanged\(\)[\s\S]*?autoOwnHex = null;[\s\S]*?\n    \}/.test(src), true);

// --- degenerate input must not throw ---
for (const [name, ctx] of [['no chat', {}], ['null chat', { chat: null }], ['empty chat', { chat: [] }]]) {
  const M = makeModule();
  let got; try { got = M.ownColorHex(ctx, { cast: [] }); } catch (e) { fails++; console.log(`FAIL  ${name} threw`); continue; }
  check(`${name} returns null`, got, null);
}

console.log(fails ? `\n${fails} failing` : '\nall pass');
process.exit(fails ? 1 : 0);

// engine-parity.mjs compares the five `=== X ENGINE (pure) ===` blocks byte for byte.
// Everything OUTSIDE them is unchecked, and that is where fixes go missing: the mood-tag
// innerHTML rewrite sat unported for two releases in the build in daily use, and the
// null-prototype presence container for eighteen.
//
// The two builds legitimately differ outside the engines (different settings mechanism,
// CSS prefix, hardcoded vs editable cast), so a diff is useless. Instead this looks for
// specific defensive CONSTRUCTS that a fix introduced, and reports where one build has
// them and the other does not. Every entry needs a reason, so a deliberate difference can
// be recorded as such rather than re-investigated each time.
import { readFileSync } from 'node:fs';

const [pubPath, privPath] = [
  process.argv[2] || new URL('../index.js', import.meta.url).pathname,
  process.argv[3] || '/home/ryzendigo/docs/rachel-images/rachel-autobg-index.js',
];
const pub = readFileSync(pubPath, 'utf8');
const priv = readFileSync(privPath, 'utf8');

// why: null            -> must match; a difference is a missing port.
// why: '<reason>'      -> known to differ on purpose; reported as INFO only.
const CONSTRUCTS = [
  { find: 'createTreeWalker', why: null, note: 'mood tag stripped without rebuilding the subtree (0.9.58)' },
  { find: 'slashApiWarned', why: null, note: 'both slash-command APIs feature-detected (0.9.56)' },
  // Counting occurrences was too blunt: a new unrelated use (the group-chat wardrobe
  // reset) changed the total and reported a false missing port. Name the SITES that must
  // have it, so the check is about those containers rather than a tally.
  { find: 'const obj = Object.create(null)', why: null, note: 'persistPresence null-prototype container (0.9.51)' },
  { find: 'const state = Object.create(null)', why: null, note: 'wardrobe state null-prototype container (0.9.50)' },
  { find: 's = Object.create(null); state[key] = s', why: null, note: 'wardrobe bucket() null prototype (0.9.50)' },
  { find: 'MAX_SENT', why: null, note: 'wardrobe sentence cap (0.9.52)' },
  { find: 'TRAIL_MAX', why: null, note: 'day-trail cap (0.9.47)' },
  { find: 'unknownInfo.clear()', why: null, note: 'colour caches cleared on chat change (0.9.48)' },
  { find: 'initDone', why: null, note: 'init() re-entry guard (0.9.60)' },
  // Counted, not compared: the private build legitimately has MORE (an extra guard in its
  // fire-and-forget runMoodVerdict, which the public build has no equivalent of). What
  // matters is that neither drops to zero, which chat-gen-guard.mjs already enforces
  // per-build. Equality would be the wrong test.
  { find: 'gen !== chatGen', why: 'private has an extra guard in runMoodVerdict; chat-gen-guard.mjs checks each build', note: 'chat-switch guards (0.9.45/46)' },
  { find: 'escapeRegexLiteral(label)', why: 'private CAST is hardcoded and always supplies its own regex', note: 'cast label fallback (0.9.55)' },
  { find: 'lastRebuildSig', why: 'private onChatChanged does not also call onMessage, so there is no double rebuild', note: 'rebuild coalescing (0.9.54)' },
  { find: 'biosFolder', why: 'private bios URL is a fixed constant, so there is no folder to key on', note: 'bios cache keyed by folder (0.9.43)' },
];

let missing = 0;
const info = [];
for (const c of CONSTRUCTS) {
  const a = (pub.match(new RegExp(c.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const b = (priv.match(new RegExp(c.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (a === b) continue;
  if (c.why) { info.push(`  ${c.find}  public ${a}, private ${b} — ${c.why}`); continue; }
  missing++;
  console.log(`MISSING PORT  ${c.find}  public ${a}, private ${b}`);
  console.log(`              ${c.note}`);
}
if (info.length) {
  console.log((missing ? '\n' : '') + 'differs on purpose:');
  for (const i of info) console.log(i);
}
console.log(missing
  ? `\n${missing} construct(s) present in one build and not the other`
  : `\nno unported non-engine construct (${CONSTRUCTS.length} checked)`);
process.exit(missing ? 1 : 0);

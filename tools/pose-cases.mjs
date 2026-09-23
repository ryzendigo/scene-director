#!/usr/bin/env node
// Case-based regression suite for the PoseEngine, tested through its REAL path.
//
// PoseEngine.detect() is only ever called on a message MoodEngine.isIntimate() has already
// accepted (index.js, the intimateNow guard). Testing detect() alone reports false positives that
// cannot happen, so this suite runs both layers in order, exactly as the extension does.
//
//   node tools/pose-cases.mjs                 # run the case set
//   node tools/pose-cases.mjs "She rides him." # try one message
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --src=<file> runs the suite against a DIFFERENT build (a mutant, or the private
// copy), which is what makes a mutation check possible. It deliberately does not use
// argv[2]: several of these suites already take a single probe string there.
const SRC_OVERRIDE = (process.argv.find((a) => a.startsWith('--src=')) || '').slice(6) || null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(SRC_OVERRIDE || join(root, 'index.js'), 'utf8');
function lift(name, ctor) {
  const b = src.indexOf(`// === ${name} ENGINE (pure) BEGIN ===`);
  const e = src.indexOf(`// === ${name} ENGINE (pure) END ===`);
  if (b < 0 || e < 0) { console.error(`${name} engine markers not found`); process.exit(2); }
  const block = src.slice(b, e).replace(`// === ${name} ENGINE (pure) BEGIN ===`, '');
  return eval('(function(){' + block.replace(new RegExp(`^\\s*const ${ctor} = `, 'm'), 'return ') + '})()');
}
const PoseEngine = lift('POSE', 'PoseEngine');
const MoodEngine = lift('MOOD', 'MoodEngine');

// 'gated' = the intimacy check rejected the message, so no pose is even attempted.
// The extension strips <details> planning blocks before either call (stripPlanning), so the harness
// must too — otherwise it tests a path that does not ship. Keep this identical to the call site.
const strip = t => String(t || '').replace(/<details[\s\S]*?(?:<\/details>|$)/gi, ' ');
const live = t => { const p = strip(t); if (!MoodEngine.isIntimate(p)) return 'gated'; const r = PoseEngine.detect(p); return r ? r.pose : 'none'; };

const CASES = [
  // Real detections must keep working — this is what the suite is protecting.
  { t: 'She gets down on all fours on the bed, naked.', want: 'behind' },
  { t: 'She is on her hands and knees, breasts swaying.', want: 'behind' },
  { t: 'She straddles him, hips rolling.', want: 'riding' },
  { t: 'She rides him slowly.', want: 'riding' },
  { t: 'On her back beneath him, thighs around his waist.', want: 'beneath' },
  { t: 'She takes him in her mouth, on her knees.', want: 'kneeling' },
  // Ordinary prose must never reach a pose. Before 23 Sep "all fours" and "on her knees" were
  // unanchored intimacy cues, so a dog on all fours was an intimate message and picked a pose.
  { t: 'The dog got down on all fours and growled.', want: 'gated' },
  { t: 'She was on her knees in the garden, planting bulbs.', want: 'gated' },
  { t: 'She lay on her back in the grass and watched the clouds.', want: 'gated' },
  { t: 'She lay on her back porch step.', want: 'gated' },
  { t: 'He was bent over the engine of the car.', want: 'gated' },
  { t: 'She drew her knees up and hugged them.', want: 'gated' },
  { t: 'She knelt down in front of the fire.', want: 'gated' },
  // 23 Sep: a <details> planning block lists branches that have NOT happened, but the pose path ran
  // on the RAW message, so "Path_B: she straddles him" set a real pose and changed the sprite on
  // screen. Both the closed and the unclosed form must be inert; the unclosed one matters because
  // the strip regex used to require a closing tag.
  { t: 'They talked quietly.\n<details><summary>Plot</summary>- Path_B: she straddles him and rides him</details>', want: 'gated' },
  { t: 'They talked quietly.\n<details><summary>Plot</summary>- Path_B: she straddles him and rides him', want: 'gated' },
  // ...while a real pose written outside the block still lands:
  { t: 'She straddles him, hips rolling.\n<details><summary>Plot</summary>- Path_A: nothing</details>', want: 'riding' },
];

const one = process.argv.slice(2).find((a) => !a.startsWith('--src=')) || undefined;
if (one) { console.log(live(one)); process.exit(0); }

let fails = 0;
for (const c of CASES) {
  const got = live(c.t);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(9)} want ${c.want.padEnd(9)} ${c.t}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

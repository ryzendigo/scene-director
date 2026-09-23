#!/usr/bin/env node
// Case-based regression suite for the pure BackgroundEngine in index.js.
//
// Narration is masked with PresenceEngine.mask first, exactly as the extension does, so quoted
// speech cannot pick a background. Tested with paragraph-length prose on purpose: the engine needs
// three distinct nouns when the header offers nothing, and a single clause rarely has three, so
// one-clause cases measure the threshold rather than the engine.
//
//   node tools/background-cases.mjs           # run the case set
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.js'), 'utf8');
function lift(name, ctor) {
  const b = src.indexOf(`// === ${name} ENGINE (pure) BEGIN ===`);
  const e = src.indexOf(`// === ${name} ENGINE (pure) END ===`);
  if (b < 0 || e < 0) { console.error(`${name} engine markers not found`); process.exit(2); }
  const block = src.slice(b, e).replace(`// === ${name} ENGINE (pure) BEGIN ===`, '');
  return eval('(function(){' + block.replace(new RegExp(`^\\s*const ${ctor} = `, 'm'), 'return ') + '})()');
}
const BackgroundEngine = lift('BACKGROUND', 'BackgroundEngine');
const PresenceEngine = lift('PRESENCE', 'PresenceEngine');
const TABLES = BackgroundEngine.compileTables();

const bg = t => {
  const r = BackgroundEngine.evaluate({ tables: TABLES, header: '', narr: PresenceEngine.mask(t).narr, available: null });
  return (r && r.file) ? r.file.replace('generic-', '').replace('.jpg', '') : 'none';
};

const CASES = [
  // Ordinary room description resolves from narration alone.
  { t: 'He sat on the couch in front of the television. The fireplace had gone out and the coffee table was covered in mugs.', want: 'living' },
  { t: 'She lay on the bed and pulled the quilt up. The pillow was cold and the bedside lamp was still on.', want: 'bedroom' },
  { t: 'She wiped the bench, put the kettle on and opened the fridge.', want: 'kitchen' },
  { t: 'The shower was running. Steam on the tiles, a towel over the vanity.', want: 'bathroom' },
  { t: 'The waves came up the sand as the tide turned.', want: 'beach' },
  { t: 'They sat on a bench in the park, watching the kids on the swing and the slide.', want: 'park' },
  // Words added 23 Sep: microwave, wardrobe, tv, cushions, toilet and the rest were absent, which
  // kept ordinary prose below the bar of three.
  { t: 'The microwave beeped. She took the plate out and set it on the bench by the sink.', want: 'kitchen' },
  // Quoted speech and recollection must never move the background.
  { t: '"The kitchen was freezing," she said.', want: 'none' },
  { t: 'She remembered the beach, the sand, the waves.', want: 'none' },
  // Below the bar keeps the previous background rather than guessing. 'towel' is a bathroom noun,
  // so this one also checks the backyard signal is not overtaken by it.
  { t: 'She hung the towel on the line in the backyard by the clothesline and the fence.', want: 'none' },
  { t: 'He opened the wardrobe, took out a shirt, and shut the bedroom door.', want: 'none' },
];

let fails = 0;
for (const c of CASES) {
  const got = bg(c.t);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(10)} want ${c.want.padEnd(10)} ${c.t.slice(0, 58)}`);
}
console.log(fails ? `\n${fails} failing` : `\nall ${CASES.length} pass`);
process.exit(fails ? 1 : 0);

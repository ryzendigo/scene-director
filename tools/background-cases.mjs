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
const BackgroundEngine = lift('BACKGROUND', 'BackgroundEngine');
const PresenceEngine = lift('PRESENCE', 'PresenceEngine');
const TABLES = BackgroundEngine.compileTables();
// 23 Sep: the row loops used `rows || []` — truthiness, not an array check — so a settings import
// carrying a number or a string where a table belongs threw "is not iterable". Settings import
// copies any key present in defaultSettings with NO type check, so this is reachable.
for (const bad of [42, 'nonsense', { generic: 'not-an-array' }, { nouns: 7 }, { generic: 42, nouns: {} }]) {
  try { BackgroundEngine.compileTables(bad); }
  catch (e) { console.error(`FAIL  compileTables(${JSON.stringify(bad)}) threw: ${e}`); process.exit(1); }
}

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
  // 23 Sep: two nouns were claimed by TWO keys each, so an ordinary scene scored a phantom point
  // for a room nobody was in — "bench" gave park a point in a kitchen, "monitor" gave hospital one
  // in an office. Both words are genuinely ambiguous, so the fix was to make the second claimant
  // require context rather than to delete the word. These pin that the phantom stays gone AND that
  // the real park/hospital senses still score.
  { t: 'She wiped the bench, put the kettle on and opened the fridge.', want: 'kitchen' },
  { t: 'They sat on a park bench watching the kids on the swing and the slide.', want: 'park' },
  { t: 'The nurse checked the drip and wheeled the gurney past the ward.', want: 'hospital' },
];

// The header layer (📍, +4 and decisive) had NO coverage, and two words were claimed by two keys
// each in a table whose whole contract is "specific venues first, broad words last". Whichever row
// came first won, which is only correct if no row claims a word a more specific row owns.
const HEADER_CASES = [
  { h: 'dorm room', want: 'bedroom' },        // was 'campus': a dorm room is where you sleep
  { h: 'the dorm', want: 'bedroom' },
  { h: 'university campus', want: 'campus' }, // was 'school': matched 'university' on the later row
  { h: 'college', want: 'campus' },
  // ...and the plain senses those two rows still own must not have moved:
  { h: 'university', want: 'school' },
  { h: 'school', want: 'school' },
  { h: 'the lecture hall', want: 'school' },
  // Remaining shared words resolve to the more specific key by table order, which is correct:
  { h: 'ski resort', want: 'snow' },
  { h: 'beach resort', want: 'hotel' },
  { h: 'motel room', want: 'motel' },
  { h: 'the old saloon', want: 'western-saloon' },
];

let fails = 0;
for (const c of CASES) {
  const got = bg(c.t);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(10)} want ${c.want.padEnd(10)} ${c.t.slice(0, 58)}`);
}
const hdr = h => {
  const r = BackgroundEngine.evaluate({ tables: TABLES, header: '📍 ' + h, narr: '', available: null });
  return (r && r.file) ? r.file.replace('generic-', '').replace('.jpg', '') : 'none';
};
for (const c of HEADER_CASES) {
  const got = hdr(c.h);
  const ok = got === c.want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(10)} want ${c.want.padEnd(10)} 📍 ${c.h}`);
}
// --- baseOf / withVariant ---------------------------------------------------------
// baseOf strips a -night/-rain/-dusk variant back to the base filename; the engine uses
// it to tell "this place's file is already showing" from "a graded variant of it is".
// A mutation sweep found that returning the input UNCHANGED — type-correct, plausible —
// failed no suite at all, so nothing asserted this behaviour.
const BASE_CASES = [
  ['kitchen.jpg', 'kitchen.jpg'],
  ['kitchen-night.jpg', 'kitchen.jpg'],
  ['kitchen-rain.jpg', 'kitchen.jpg'],
  ['kitchen-dusk.jpg', 'kitchen.jpg'],
  ['kitchen-NIGHT.JPG', 'kitchen.JPG'],          // the pattern is case-insensitive
  ['kitchen-night.png', 'kitchen.png'],          // any extension
  ['back-garden-night.jpg', 'back-garden.jpg'],  // hyphens in the name itself survive
  ['kitchen-summer.jpg', 'kitchen-summer.jpg'],  // not a graded variant: left alone
  ['kitchen-nightfall.jpg', 'kitchen-nightfall.jpg'],  // must anchor at the extension
  ['', ''],
];
for (const [file, want] of BASE_CASES) {
  const got = BackgroundEngine.baseOf(file);
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(got).padEnd(26)} want ${String(want).padEnd(24)} baseOf(${JSON.stringify(file)})`);
}
// --- rainRegex ----------------------------------------------------------------------
// scene.raining selects the -rain background variant and turns on the rain overlay. The
// default matched words only, and the model most often signals rain with an ICON: across
// 1,304 real headers, 323 weather segments carry 🌧 but only 156 say rain/storm/shower/
// drizzle. The rest read "🌧️ Overcast, 9°C" and got no rain treatment at all.
const RAIN_SRC = /^\s+rainRegex: '((?:[^'\\]|\\.)*)'/m.exec(src);
const RAIN_CASES = [
  ['🌧️ Overcast, 9°C', true, 'rain icon with dry words'],
  ['⛈ Thunderstorm, 18°C', true, 'thunder icon'],
  ['🌦️ 14°C', true, 'sun behind rain'],
  ['Light rain', true, 'words still work'],
  ['showers later', true, 'words still work'],
  ['☀️ 84°F', false, 'sun'],
  ['🌫️ 9°C', false, 'fog is not rain'],
  ['☁ Overcast, 11°C', false, 'cloud is not rain'],
  ['🌙 Dusk, 71°F', false, 'moon'],
  ['🌥️ Partly cloudy', false, 'partly cloudy'],
  ['snow, -2°C', false, 'snow is not rain'],
];
if (!RAIN_SRC) { console.log('FAIL  rainRegex not found in defaultSettings'); fails++; }
else {
  const rain = new RegExp(RAIN_SRC[1].replace(/\\\\/g, '\\'), 'i');
  for (const [seg, want, why] of RAIN_CASES) {
    rain.lastIndex = 0;
    const got = rain.test(seg.toLowerCase());
    const ok = got === want;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  raining=${String(got).padEnd(6)} want ${String(want).padEnd(6)} ${JSON.stringify(seg)}  (${why})`);
  }
}
// withVariant picks the -rain/-night/-dusk FILE, and it carries its own copy of the rain
// pattern — 0.9.61 fixed only scene.raining, so the overlay came on while the background
// stayed dry for an icon-only segment. These go through the real exported function.
const VARIANT_CASES = [
  ['🌧️ Overcast, 9°C', 12, 'kitchen-rain.jpg', 'icon-only rain picks the rain variant'],
  ['Light rain', 12, 'kitchen-rain.jpg', 'worded rain still does'],
  ['☀️ 84°F', 12, 'kitchen.jpg', 'a sunny midday stays base'],
  ['🌧️ Overcast, 9°C', 22, 'kitchen-night.jpg', 'night wins over rain'],
];
const HAVE = new Set(['kitchen.jpg', 'kitchen-rain.jpg', 'kitchen-night.jpg', 'kitchen-dusk.jpg']);
for (const [seg, hour, want, why] of VARIANT_CASES) {
  const got = BackgroundEngine.withVariant('kitchen.jpg', hour, seg.toLowerCase(), HAVE);
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(got).padEnd(20)} want ${want.padEnd(20)} ${why}`);
}
// withVariant must preserve whatever extension the Place card used. 15 of the private
// build's installed backgrounds are .webp, and a .jpg-only assumption there is what made
// the night tint double-darken them in 0.9.62.
const EXT_CASES = [
  ['kitchen.webp', 22, new Set(['kitchen.webp', 'kitchen-night.webp']), 'kitchen-night.webp'],
  ['kitchen.png', 22, new Set(['kitchen.png', 'kitchen-night.png']), 'kitchen-night.png'],
  ['kitchen.JPG', 22, new Set(['kitchen.JPG', 'kitchen-night.JPG']), 'kitchen-night.JPG'],
  // No variant installed: keep the base file rather than inventing one.
  ['kitchen.webp', 22, new Set(['kitchen.webp']), 'kitchen.webp'],
  // No extension at all falls back to .jpg, which is the documented starter-pack naming.
  ['kitchen', 22, new Set(['kitchen-night.jpg']), 'kitchen-night.jpg'],
];
for (const [file, hour, have, want] of EXT_CASES) {
  const got = BackgroundEngine.withVariant(file, hour, '', have);
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(got).padEnd(22)} want ${want.padEnd(22)} withVariant(${JSON.stringify(file)})`);
}
const total = CASES.length + HEADER_CASES.length + BASE_CASES.length + RAIN_CASES.length + VARIANT_CASES.length + EXT_CASES.length;
console.log(fails ? `\n${fails} failing` : `\nall ${total} pass`);
process.exit(fails ? 1 : 0);

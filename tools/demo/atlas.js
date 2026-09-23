// Exercise the 0.9.15 story atlas: seed two days of trail into chat metadata, confirm the HUD
// becomes clickable, open the modal and read it back. Fails loudly if the modal never appears.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:8327/', { waitUntil: 'load' }); await sleep(9000);
  for (const sel of ['#dialogue_popup_ok', '.popup-button-ok']) {
    const x = p.locator(sel).first();
    if (await x.isVisible().catch(() => false)) { await x.click().catch(() => {}); await sleep(600); }
  }
  await p.evaluate(async () => {
    const c = SillyTavern.getContext();
    const i = c.characters.findIndex(x => x.name === 'Elise');
    if (i >= 0 && c.selectCharacterById) await c.selectCharacterById(i);
  });
  await sleep(7000);
  // Turn the day trail on, then seed a past day plus today's trail in chat metadata.
  const seeded = await p.evaluate(() => {
    const c = SillyTavern.getContext();
    const s = c.extensionSettings && c.extensionSettings['scene_director'];
    // 23 Sep: enableDayTrail alone is not enough. The trail is rendered INTO the HUD, and
    // enableHud defaults to false, so with it off there is no #scene-director-hud to click and
    // this driver reports a failure that is its own. It passed for a long time only because an
    // earlier run had left the setting on; running it after errcheck.js (which toggles every
    // checkbox) exposed the order dependence. Set both, so the driver stands alone.
    if (s) { s.enableDayTrail = true; s.enableHud = true; }
    const meta = c.chatMetadata || (c.chat_metadata) || null;
    if (!meta) return 'no metadata';
    meta['scene_director'] = meta['scene_director'] || {};
    const m = meta['scene_director'];
    m.atlas = { '2026-9-21': ['the kitchen', 'the porch'], '2026-9-22': ['the beach'] };
    m.trailDateKey = '2026-9-23';
    m.trailLocs = ['the car', 'the shop'];
    return JSON.stringify(Object.keys(m.atlas));
  });
  console.log('seeded atlas days:', seeded);
  await sleep(1500);
  // Open the modal directly through the same entry point the click uses.
  const opened = await p.evaluate(() => {
    const before = !!document.getElementById('scene-director-atlas');
    const hud = document.getElementById('scene-director-hud');
    const bound = hud ? hud.dataset.sdAtlasBound : null;
    if (hud) hud.click();
    window.__sdBound = bound;
    const el = document.getElementById('scene-director-atlas');
    return { hudFound: !!hud, bound, before, after: !!el, text: el ? el.innerText.replace(/\s+/g, ' ').slice(0, 220) : '' };
  });
  console.log('hud present:', opened.hudFound, '| click handler bound:', opened.bound);
  console.log('modal before click:', opened.before, '| after click:', opened.after);
  if (opened.text) console.log('modal text:', opened.text);
  const closed = await p.evaluate(() => {
    const el = document.getElementById('scene-director-atlas');
    if (el) el.click();
    return !document.getElementById('scene-director-atlas');
  });
  console.log('closes on click:', closed);
  console.log('--- errors ---');
  console.log([...new Set(errs)].join('\n') || 'none');
  console.log(opened.after && closed ? 'ATLAS PASS' : 'ATLAS FAIL');
  await b.close();
})().catch(e => { console.error('DRIVER', e); process.exit(1); });

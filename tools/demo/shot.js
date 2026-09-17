// Screenshot driver for the Scene Director demo instance. node shot.js <scan|stage>
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8327/';
const phase = process.argv[2] || 'scan';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
  page.on('console', m => { if (/scene-director|Scene Director/i.test(m.text())) console.log('[page]', m.text().slice(0, 160)); });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(8000);
  if (phase === 'scan') { // start from a clean slate every run
    await page.evaluate(() => { const c = SillyTavern.getContext(); delete c.extensionSettings.scene_director; c.saveSettingsDebounced(); });
    await sleep(3000); await page.reload({ waitUntil: 'load' }); await sleep(8000);
  }
  // dismiss any popup ST throws on first run
  for (const sel of ['#dialogue_popup_ok', '.popup-button-ok', '.popup-button-close']) {
    const b = page.locator(sel).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(800); }
  }
  // open the character and its latest chat
  const opened = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(); const i = ctx.characters.findIndex(c => c.name === 'Elise');
    if (i < 0) return 'no-char';
    if (typeof ctx.selectCharacterById === 'function') { await ctx.selectCharacterById(i); return 'ctx ' + i; }
    document.querySelector(`.character_select[chid="${i}"]`)?.click(); return 'click ' + i;
  }); console.log('open', opened); await sleep(7000);
  const n = await page.locator('#chat .mes').count(); console.log('messages rendered', n);
  await page.screenshot({ path: '/shots/dbg-chat.png' });
  if (phase === 'scan') {
    await page.click('#extensions-settings-button'); await sleep(1500);
    const drawer = page.locator('#scene_director_settings');
    await drawer.locator('.inline-drawer-toggle').first().click(); await sleep(1200);
    await page.fill('#sd_castFolder', 'Elise').catch(() => {});
    await page.click('#sd_scan'); await sleep(5000);
    await page.locator('#sd_scan_results').scrollIntoViewIfNeeded();
    await page.locator('#sd_scan_results').screenshot({ path: '/shots/screenshot-scan-wizard.png' });
    const btns = page.locator('.sd-scan-create'); const c = await btns.count(); console.log('create buttons', c);
    for (let i = 0; i < c; i++) { await btns.nth(0).click().catch(() => {}); await sleep(600); }
    await sleep(2000);
    const keys = await page.evaluate(() => { const s = SillyTavern.getContext().extensionSettings[Object.keys(SillyTavern.getContext().extensionSettings).find(k=>/scene/i.test(k))]; return { cast: s.cast.map(c => [c.key, c.label, c.colorHex]), places: s.places ? s.places.map(p => [p.key, p.label, p.background]) : null, folder: s.castFolder }; });
    console.log('KEYS ' + JSON.stringify(keys));
    await page.locator('#sd_cast_cards').scrollIntoViewIfNeeded(); await sleep(500);
    const top = await page.locator('#sd_cast_cards').boundingBox(); const bot = await page.locator('#sd_place_cards').boundingBox();
    if (top && bot) await page.screenshot({ path: '/shots/screenshot-cards.png', clip: { x: Math.max(0, top.x - 8), y: Math.max(0, top.y - 40), width: top.width + 16, height: Math.min(860, bot.y + bot.height - top.y + 48) } });
    else await drawer.screenshot({ path: '/shots/screenshot-cards.png' });
    await page.evaluate(() => {
      const c = SillyTavern.getContext(); const s = c.extensionSettings.scene_director;
      s.castFolder = 'Elise';
      const bg = { 'café': 'generic-cafe.jpg', 'clinic': 'generic-clinic.jpg', 'apartment': 'generic-apartment.jpg' };
      for (const p of s.places) for (const k in bg) if (new RegExp(k, 'i').test(p.name || p.pattern || '')) { p.slots = p.slots || {}; p.slots.day = bg[k]; p.slots.night = bg[k].replace('.jpg', '-night.jpg'); }
      for (const m of s.cast) { if (m.label === 'Ben') m.bio = 'Retired fisherman, first customer every morning.'; if (m.label === 'Tomas') m.bio = 'Elise\'s cook. Fights the oven daily.'; if (/okafor/i.test(m.label)) m.bio = 'GP at the Harbour Road clinic.'; if (m.label === 'Elise') m.bio = 'Runs the corner café.'; }
      c.saveSettingsDebounced();
    });
    await sleep(6000); // let ST flush settings
  } else {
    await page.evaluate(() => { const c = SillyTavern.getContext(); c.extensionSettings.scene_director.castFolder = 'Elise'; Object.assign(c.extensionSettings.scene_director, { enableHud: true, enableCast: true, enableMoods: true, enableBioCards: true, enableWeatherFx: true, enableCrossfade: true }); c.extensionSettings.expressions = Object.assign(c.extensionSettings.expressions || {}, { fallback_expression: 'neutral' }); c.saveSettingsDebounced(); });
    await sleep(4000); await page.reload({ waitUntil: 'load' }); await sleep(8000);
    await page.evaluate(async () => { const c = SillyTavern.getContext(); await c.selectCharacterById(0); }); await sleep(9000);
    console.log('hud', await page.locator('.scene-director-hud, [class*=scene-director-hud]').count(), 'sprite', await page.locator('#expression-image').getAttribute('src'));
    const chips = await page.locator('.scene-director-chip').count(); console.log('chips', chips);
    await page.screenshot({ path: '/shots/screenshot-cast-strip.png' });
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

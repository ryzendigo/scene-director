// Settings-persistence test for Scene Director on st-demo. node persist.js
// 1) untick Ken Burns with NO Apply click -> reload -> must be false (0.9.4 autosave)
// 2) tick it back, put a broken regex in a regex box, untick again, click Apply -> reload -> must be false
//    (0.9.4 per-field save; before the fix the whole save was refused)
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8327/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOD = 'scene_director';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', m => { if (/\[scene-director\].*(error|Error)/.test(m.text())) console.log('[page-err]', m.text().slice(0, 200)); });
  const load = async () => { await page.goto(URL, { waitUntil: 'load' }); await sleep(9000);
    for (const sel of ['#dialogue_popup_ok', '.popup-button-ok', '.popup-button-close']) { const b = page.locator(sel).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(500); } } };
  const openDrawer = async () => { await page.click('#extensions-settings-button'); await sleep(1500);
    const d = page.locator('#scene_director_settings'); const t = d.locator('.inline-drawer-toggle').first();
    const open = await d.locator('.inline-drawer-content').first().isVisible().catch(() => false); if (!open) { await t.click(); await sleep(1000); } };
  const stored = async () => page.evaluate((m) => { const s = SillyTavern.getContext().extensionSettings[m]; return s ? { kb: s.enableKenBurns, ver: s.version } : null; }, MOD);
  await load();
  console.log('version installed:', await page.evaluate(() => (document.querySelector('link[href*="scene-director/style.css"]') || {}).href || '?'));
  // reset to a known state: KenBurns ON, saved
  await page.evaluate((m) => { const c = SillyTavern.getContext(); c.extensionSettings[m] = c.extensionSettings[m] || {}; c.extensionSettings[m].enableKenBurns = true; c.saveSettingsDebounced(); }, MOD); await sleep(2500);
  await load(); console.log('start state', JSON.stringify(await stored()));
  // --- test 1: untick, no Apply, reload ---
  await openDrawer(); const kb = page.locator('#sd_enableKenBurns'); await kb.scrollIntoViewIfNeeded();
  if (await kb.isChecked()) await kb.click(); await sleep(2500);
  await load(); const t1 = await stored(); console.log('TEST1 untick-without-apply -> after reload enableKenBurns =', t1 && t1.kb, (t1 && t1.kb === false) ? 'PASS' : 'FAIL');
  // --- test 2: broken regex elsewhere + untick + Apply ---
  await page.evaluate((m) => { const c = SillyTavern.getContext(); c.extensionSettings[m].enableKenBurns = true; c.saveSettingsDebounced(); }, MOD); await sleep(2500); await load();
  await openDrawer(); const rx = page.locator('#sd_locationRegex'); await rx.scrollIntoViewIfNeeded(); await rx.fill('(unclosed');
  const kb2 = page.locator('#sd_enableKenBurns'); await kb2.scrollIntoViewIfNeeded(); if (await kb2.isChecked()) await kb2.click(); await sleep(500);
  await page.click('#sd_apply'); await sleep(1500);
  console.log('apply status:', (await page.locator('#sd_apply_status').textContent().catch(() => '')).trim());
  await load(); const t2 = await stored(); console.log('TEST2 untick+broken-regex+apply -> after reload enableKenBurns =', t2 && t2.kb, (t2 && t2.kb === false) ? 'PASS' : 'FAIL');
  // leave the demo clean: restore the regex default by deleting the bad value
  await page.evaluate((m) => { const c = SillyTavern.getContext(); delete c.extensionSettings[m].locationRegex; c.saveSettingsDebounced(); }, MOD); await sleep(2000);
  await browser.close();
})().catch(e => { console.error('DRIVER ERROR', e); process.exit(1); });

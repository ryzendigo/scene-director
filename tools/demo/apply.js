// Does applyForm survive a bad regex and report per-field? Captures page errors around one Apply click.
const { chromium } = require('./browser');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
  page.on('console', m => { if (/scene-director/.test(m.text()) && /error|Error|failed/.test(m.text())) console.log('[page]', m.text().slice(0, 220)); });
  await page.goto('http://127.0.0.1:8327/', { waitUntil: 'load' }); await sleep(9000);
  for (const sel of ['#dialogue_popup_ok', '.popup-button-ok']) { const b = page.locator(sel).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(500); } }
  await page.click('#extensions-settings-button'); await sleep(1500);
  const d = page.locator('#scene_director_settings');
  if (!(await d.locator('.inline-drawer-content').first().isVisible().catch(() => false))) { await d.locator('.inline-drawer-toggle').first().click(); await sleep(1000); }
  // which form ids does applyForm expect, and which are missing from the DOM?
  const missing = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('#scene_director_settings [id^="sd_"]')).map(e => e.id);
    return { count: ids.length, sample: ids.slice(0, 8) };
  }); console.log('sd_ fields in DOM:', JSON.stringify(missing));
  await page.fill('#sd_locationRegex', '(unclosed'); await page.fill('#sd_titlePrefix', 'ZZ-test');
  await page.click('#sd_apply'); await sleep(1500);
  console.log('apply status:', JSON.stringify((await page.locator('#sd_apply_status').textContent().catch(() => null))));
  const s = await page.evaluate(() => { const x = SillyTavern.getContext().extensionSettings.scene_director; return { titlePrefix: x.titlePrefix, locationRegex: x.locationRegex }; });
  console.log('stored after apply:', JSON.stringify(s), '-> titlePrefix saved despite bad regex?', s.titlePrefix === 'ZZ-test' ? 'PASS' : 'FAIL', '| bad regex kept out?', s.locationRegex !== '(unclosed' ? 'PASS' : 'FAIL');
  await page.evaluate(() => { const c = SillyTavern.getContext(); const x = c.extensionSettings.scene_director; delete x.titlePrefix; delete x.locationRegex; c.saveSettingsDebounced(); }); await sleep(2000);
  await browser.close();
})().catch(e => { console.error('DRIVER ERROR', e); process.exit(1); });

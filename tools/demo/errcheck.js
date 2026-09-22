// Load the public extension in the demo, exercise the drawer + a message, report console errors.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  await p.goto('http://127.0.0.1:8327/', { waitUntil: 'load' }); await sleep(9000);
  for (const sel of ['#dialogue_popup_ok', '.popup-button-ok']) { const x = p.locator(sel).first(); if (await x.isVisible().catch(()=>false)) { await x.click().catch(()=>{}); await sleep(600);} }
  // open the character + chat so the extension parses real messages
  await p.evaluate(async () => { const c = SillyTavern.getContext(); const i = c.characters.findIndex(x => x.name === 'Elise'); if (i >= 0 && c.selectCharacterById) await c.selectCharacterById(i); }); await sleep(7000);
  // open the drawer and walk every settings tab/section
  await p.click('#extensions-settings-button'); await sleep(1500);
  const d = p.locator('#scene_director_settings');
  if (!(await d.locator('.inline-drawer-content').first().isVisible().catch(()=>false))) { await d.locator('.inline-drawer-toggle').first().click(); await sleep(1200); }
  // toggle every checkbox on then off - the cheapest way to hit most code paths
  const boxes = await p.locator('#scene_director_settings input[type=checkbox]').all();
  console.log('checkboxes:', boxes.length);
  for (const cb of boxes) { await cb.click({ timeout: 1500 }).catch(()=>{}); }
  await sleep(2500);
  for (const cb of boxes) { await cb.click({ timeout: 1500 }).catch(()=>{}); }
  await sleep(2500);
  // scan + self-test buttons
  for (const id of ['#sd_scan', '#sd_selftest', '#sd_test']) { const x = p.locator(id).first(); if (await x.isVisible().catch(()=>false)) { await x.click().catch(()=>{}); await sleep(3000); } }
  await sleep(2000);
  console.log('--- errors (' + errs.length + ') ---');
  console.log([...new Set(errs)].slice(0, 25).join('\n') || 'none');
  await b.close();
})().catch(e => { console.error('DRIVER', e); process.exit(1); });

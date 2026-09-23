// Load the public extension in the demo, exercise the drawer + a message, report console errors.
const { chromium } = require('./browser');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  // The console text for a failed fetch is just "Failed to load resource ... 404" with no URL, and
  // identical lines dedupe to one, so a real missing asset was indistinguishable from the optional
  // files the extension probes on purpose. Record the URL of every non-OK response separately.
  const bad = [];
  p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  await p.goto('http://127.0.0.1:8327/', { waitUntil: 'load' }); await sleep(9000);
  for (const sel of ['#dialogue_popup_ok', '.popup-button-ok']) { const x = p.locator(sel).first(); if (await x.isVisible().catch(()=>false)) { await x.click().catch(()=>{}); await sleep(600);} }
  // open the character + chat so the extension parses real messages
  await p.evaluate(async () => { const c = SillyTavern.getContext(); const i = c.characters.findIndex(x => x.name === 'Elise'); if (i >= 0 && c.selectCharacterById) await c.selectCharacterById(i); }); await sleep(7000);
  // open the drawer and walk every settings tab/section
  await p.click('#extensions-settings-button'); await sleep(1500);
  const d = p.locator('#scene_director_settings');
  // An unguarded click here throws a bare TimeoutError if the drawer never rendered,
  // which buries the real problem in a stack trace. Say what went wrong instead.
  if (!(await d.locator('.inline-drawer-content').first().isVisible().catch(() => false))) {
    const toggled = await d.locator('.inline-drawer-toggle').first().click({ timeout: 5000 })
      .then(() => true).catch(() => false);
    if (!toggled) {
      console.log('FAIL  the Scene Director settings drawer did not render or would not open');
      console.log('Nothing below this would be meaningful, so stopping here.');
      await b.close();
      process.exit(1);
    }
    await sleep(1200);
  }
  // toggle every checkbox on then off - the cheapest way to hit most code paths
  const boxes = await p.locator('#scene_director_settings input[type=checkbox]').all();
  console.log('checkboxes:', boxes.length);
  // This driver's whole claim is "toggles every checkbox twice". If the drawer failed to
  // render, boxes.length is 0, every loop below no-ops, and it still reports no errors —
  // a pass that tested nothing. A floor rather than an exact count, because two template
  // loops emit rows at runtime (13 are declared statically, ~45 exist), so an exact number
  // would break every time a setting is added.
  const MIN_BOXES = 30;
  if (boxes.length < MIN_BOXES) {
    console.log(`FAIL  only ${boxes.length} checkboxes found, expected at least ${MIN_BOXES}`);
    console.log('The settings drawer did not render properly; nothing below this is meaningful.');
    await b.close();
    process.exit(1);
  }
  for (const cb of boxes) { await cb.click({ timeout: 1500 }).catch(()=>{}); }
  await sleep(2500);
  for (const cb of boxes) { await cb.click({ timeout: 1500 }).catch(()=>{}); }
  await sleep(2500);
  // scan + self-test buttons
  for (const id of ['#sd_scan', '#sd_selftest', '#sd_test']) { const x = p.locator(id).first(); if (await x.isVisible().catch(()=>false)) { await x.click().catch(()=>{}); await sleep(3000); } }
  await sleep(2000);
  console.log('--- errors (' + errs.length + ') ---');
  console.log([...new Set(errs)].slice(0, 25).join('\n') || 'none');
  // Optional-by-design probes: the extension fetches these with an r.ok guard and copes when absent.
  const OPTIONAL = /(?:backgrounds\/animated\.json|npc\/animated\.json|npc\/[\w-]+\.(?:png|webp)|\/characters\/[^/]+\/[\w-]+\.(?:png|webp))(?:\?|$)/;
  const unexpected = [...new Set(bad)].filter(u => !OPTIONAL.test(u));
  console.log('--- failed requests (' + new Set(bad).size + ') ---');
  console.log([...new Set(bad)].slice(0, 25).join('\n') || 'none');
  console.log(unexpected.length ? 'UNEXPECTED:\n' + unexpected.join('\n') : 'all failed requests are optional probes — PASS');
  await b.close();
})().catch(e => { console.error('DRIVER', e); process.exit(1); });

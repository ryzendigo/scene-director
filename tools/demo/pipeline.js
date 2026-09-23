// End-to-end: inject a message with a KNOWN header and check what the extension actually
// puts on screen. Every other driver checks that the HUD and chips exist; none checks
// what they say, so the whole pipeline could render an empty HUD or the wrong name and
// still pass. This is the only check that reads the rendered output.
const { chromium } = require('./browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:8327/', { waitUntil: 'load' });
  await sleep(9000);
  for (const sel of ['#dialogue_popup_ok', '.popup-button-ok', '.popup-button-close']) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(800); }
  }
  const opened = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext();
    const i = ctx.characters.findIndex((c) => c.name === 'Elise');
    if (i < 0) return 'no-char';
    await ctx.selectCharacterById(i);
    return 'ok';
  });
  if (opened !== 'ok') { console.log('FAIL  could not open the Elise character:', opened); await browser.close(); process.exit(1); }
  await sleep(8000);

  // Push a message through the real event path rather than calling internals, so this
  // exercises MESSAGE_RECEIVED -> onMessage -> parseScene -> HUD exactly as a reply does.
  const result = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext();
    const et = ctx.eventTypes || ctx.event_types;
    ctx.chat.push({
      name: ctx.name2 || 'Elise', is_user: false, is_system: false, send_date: Date.now(),
      // The real header format, taken from a live chat: bracketed, pipe-separated,
      // with the weather last. The default weatherRegex anchors on the closing ']',
      // so a bare unbracketed header parses location and time but never weather —
      // my first version of this test used one and silently checked nothing there.
      mes: '[ 🕰️ 9:15 AM | ☀️ Sunday, August 17, 2026 AD | 📍 the kitchen | ☀️ 64°F ]'
        + '\n\n*She pulled the blue cardigan on and put the kettle down.*',
      extra: {},
    });
    await ctx.eventSource.emit(et.MESSAGE_RECEIVED, ctx.chat.length - 1);
    await new Promise((r) => setTimeout(r, 3000));
    // The two builds use different ids — the private one prefixes everything 'rachel-'.
    // Hardcoding the public id made this report "5 failing" against the private build
    // when the HUD was rendering perfectly well under another name.
    const hud = document.getElementById('scene-director-hud')
      || document.getElementById('rachel-scene-hud');
    return {
      hudExists: Boolean(hud),
      hudVisible: hud ? getComputedStyle(hud).display !== 'none' : false,
      hudText: hud ? hud.textContent.replace(/\s+/g, ' ').trim() : '',
      hudTitle: hud ? (hud.title || '').replace(/\s+/g, ' ').trim() : '',
    };
  });

  const checks = [
    ['HUD exists', result.hudExists === true],
    ['HUD is visible', result.hudVisible === true],
    // The header said the kitchen, 9:15 AM, clear. Each of those must reach the screen.
    ['HUD names the location', /kitchen/i.test(result.hudText)],
    ['HUD shows the time', /9[:.]15|9\s*AM/i.test(result.hudText)],
    // The wardrobe read "pulled the blue cardigan on"; its tooltip carries what she wears.
    ['wardrobe saw the cardigan', /cardigan/i.test(result.hudText + ' ' + result.hudTitle)],
    // Date and weather were never asserted before; both are default-on HUD rows, so a
    // regression in either would have rendered nothing and passed.
    ['HUD shows the date', /Aug|17/i.test(result.hudText)],
    ['HUD shows the weather', /64|°F/i.test(result.hudText)],
  ];
  let bad = 0;
  for (const [label, ok] of checks) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); }
  console.log('HUD text :', JSON.stringify(result.hudText).slice(0, 160));
  console.log('HUD title:', JSON.stringify(result.hudTitle).slice(0, 160));
  await browser.close();
  console.log(bad ? `\n${bad} failing` : `\nall ${checks.length} pass`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

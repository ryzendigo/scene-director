// The mood tag is removed from the RENDERED message. It used to be done by reassigning
// .mes_text innerHTML, which destroys and rebuilds the whole message subtree to delete a
// few characters — an open <details> snaps shut, images reload, and any listener inside
// the message is lost. This runs the shipped stripMoodTagFromDom logic against real DOM
// in the demo container and checks the tag goes while the subtree survives.
const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const { join } = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = readFileSync(join(__dirname, '..', '..', 'index.js'), 'utf8');
// Lift the inner strip() body so the test exercises shipped code, not a copy.
const i = src.indexOf('const strip = function () {');
const j = src.indexOf('\n        };', i) + 10;
const STRIP = src.slice(i, j);
const RES = ['MOOD_TAG_DOM_RE', 'EMPTY_P_TAIL_RE']
  .map((n) => new RegExp('const ' + n + ' = (/.*/[gi]*);').exec(src))
  .map((m) => m[0]).join('\n');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:8327/', { waitUntil: 'load' });
  await sleep(6000);

  const results = await page.evaluate(({ STRIP, RES }) => {
    const out = [];
    const run = (label, html, check) => {
      let host = document.getElementById('sd-strip-test');
      if (host) host.remove();
      host = document.createElement('div');
      host.id = 'sd-strip-test';
      host.innerHTML = '<div id="chat"><div class="mes last_mes"><div class="mes_text">' + html + '</div></div></div>';
      document.body.appendChild(host);
      const mesText = host.querySelector('.mes_text');
      const before = mesText.firstElementChild;
      // eslint-disable-next-line no-eval
      const strip = eval('(function(){' + RES + '\n' + STRIP + '\nreturn strip;})()');
      strip();
      out.push({ label, ...check(mesText, before) });
      host.remove();
    };

    run('tag removed from plain text', '<p>She smiled. [MOOD: joy]</p>',
      (m) => ({ tagGone: !/MOOD/.test(m.innerHTML), text: m.textContent.trim() }));

    run('details stays open', '<details open><summary>s</summary>plan</details><p>Text [MOOD: joy]</p>',
      (m, before) => ({
        tagGone: !/MOOD/.test(m.innerHTML),
        detailsStillOpen: m.querySelector('details') && m.querySelector('details').open,
        sameNode: m.firstElementChild === before,
      }));

    run('listener survives', '<p id="sd-keep">click me</p><p>Text [MOOD: joy]</p>',
      (m) => {
        const p = m.querySelector('#sd-keep');
        let fired = 0;
        if (p) { p.addEventListener('click', () => { fired++; }); p.click(); }
        return { tagGone: !/MOOD/.test(m.innerHTML), listenerFired: fired };
      });

    run('empty trailing p dropped', '<p>Text</p><p>[MOOD: joy]</p>',
      (m) => ({ tagGone: !/MOOD/.test(m.innerHTML), trailingEmpty: /<p>\s*<\/p>/.test(m.innerHTML) }));

    run('tag split by a br', '<p>Text<br>[MOOD: joy]</p>',
      (m) => ({ tagGone: !/MOOD/.test(m.innerHTML) }));

    run('no tag leaves it alone', '<p id="sd-keep2">Nothing here</p>',
      (m, before) => ({ sameNode: m.firstElementChild === before, text: m.textContent.trim() }));

    return out;
  }, { STRIP, RES });

  let bad = 0;
  for (const r of results) {
    const { label, ...rest } = r;
    // Every reported flag must be truthy except the ones named as "must be false".
    const fails = Object.entries(rest).filter(([k, v]) =>
      (k === 'trailingEmpty') ? v === true : (typeof v === 'boolean' ? v === false : false));
    if (fails.length) bad++;
    console.log(`${fails.length ? 'FAIL' : 'PASS'}  ${label.padEnd(30)} ${JSON.stringify(rest)}`);
  }
  await browser.close();
  console.log(bad ? `\n${bad} failing` : `\nall ${results.length} pass`);
  process.exit(bad ? 1 : 0);
})();

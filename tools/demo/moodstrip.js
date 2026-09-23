// The mood tag is removed from the RENDERED message. It used to be done by reassigning
// .mes_text innerHTML, which destroys and rebuilds the whole message subtree to delete a
// few characters — an open <details> snaps shut, images reload, and any listener inside
// the message is lost. This runs the shipped stripMoodTagFromDom logic against real DOM
// in the demo container and checks the tag goes while the subtree survives.
// playwright locally, playwright-core inside the mcr.microsoft.com/playwright image
// (which ships the browsers at /ms-playwright but not the wrapper package).
const { chromium } = (() => {
  try { return require('playwright'); } catch (e) { return require('playwright-core'); }
})();
const { readFileSync } = require('fs');
const { join } = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = readFileSync(join(__dirname, '..', '..', 'index.js'), 'utf8');
// Lift the inner strip() body so the test exercises shipped code, not a copy.
// Brace-match to the end of the function. Slicing to the first '\n        };' cut the
// lift off mid-body — inside the try — so eval built a strip() that did nothing and every
// case reported tagGone:false. That looked exactly like a broken fix.
const i = src.indexOf('const strip = function () {');
let depth = 0, j = src.indexOf('{', i);
for (let k = j; k < src.length; k++) {
  if (src[k] === '{') depth++;
  else if (src[k] === '}') { depth--; if (depth === 0) { j = k + 1; break; } }
}
const STRIP = src.slice(i, j) + ';';
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
    const run = (label, html, check, preStrip) => {
      let host = document.getElementById('sd-strip-test');
      if (host) host.remove();
      host = document.createElement('div');
      host.id = 'sd-strip-test';
      // strip() looks up '#chat .mes.last_mes .mes_text' on the DOCUMENT. The demo page
      // already has a real #chat, so a second one in a fixture is never found —
      // querySelector returns SillyTavern's empty one and every case reported
      // tagGone:false, which reads exactly like a broken fix. Park the real one for the
      // duration of the case so the fixture is what strip() sees.
      const realChat = document.getElementById('chat');
      if (realChat) realChat.id = 'chat-parked-by-test';
      host.innerHTML = '<div id="chat"><div class="mes last_mes"><div class="mes_text">' + html + '</div></div></div>';
      document.body.appendChild(host);
      const mesText = host.querySelector('.mes_text');
      const before = mesText.firstElementChild;
      if (preStrip) preStrip(mesText);
      // eslint-disable-next-line no-eval
      let evalErr = null;
      let strip = null;
      try {
        // eslint-disable-next-line no-eval
        strip = eval('(function(){' + RES + '\n' + STRIP + '\nreturn strip;})()');
      } catch (e) { evalErr = 'EVAL: ' + String(e && e.message).slice(0, 120); }
      if (strip) { try { strip(); } catch (e) { evalErr = 'CALL: ' + String(e && e.message).slice(0, 120); } }
      if (evalErr) { out.push({ label, evalErr }); host.remove(); if (realChat) realChat.id = 'chat'; return; }
      out.push({ label, ...check(mesText, before) });
      host.remove();
      if (realChat) realChat.id = 'chat';
    };

    run('tag removed from plain text', '<p>She smiled. [MOOD: joy]</p>',
      (m) => ({ tagGone: !/MOOD/.test(m.innerHTML), text: m.textContent.trim() }));

    run('details stays open', '<details open><summary>s</summary>plan</details><p>Text [MOOD: joy]</p>',
      (m, before) => ({
        tagGone: !/MOOD/.test(m.innerHTML),
        detailsStillOpen: m.querySelector('details') && m.querySelector('details').open,
        sameNode: m.firstElementChild === before,
      }));

    // The listener must be attached BEFORE the strip — attaching afterwards passes on the
    // old innerHTML rewrite too, because the rebuilt node happily takes a fresh listener.
    // Same for <details open>: reading .open after the fact cannot tell a surviving node
    // from an identical replacement. Node identity is what actually distinguishes them,
    // which is why sameNode is the load-bearing assertion here.
    run('listener survives', '<p id="sd-keep">click me</p><p>Text [MOOD: joy]</p>',
      (m) => {
        const p = m.querySelector('#sd-keep');
        let fired = 0;
        if (p) { p.addEventListener('click', () => { fired++; }); p.click(); }
        const pre = m.querySelector('#sd-keep');
        if (pre) pre.click();
        return { tagGone: !/MOOD/.test(m.innerHTML), listenerFired: fired,
          preAttachedSurvived: (window.__sdPreFired || 0) > 0 };
      }, (m) => {
        // pre-strip hook: attach here so the listener predates the rewrite
        const p = m.querySelector('#sd-keep');
        if (p) p.addEventListener('click', () => { window.__sdPreFired = (window.__sdPreFired || 0) + 1; });
        window.__sdPreFired = 0;
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

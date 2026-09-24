// The settings panel's NUMBER_FIELDS save path, exercised in a REAL browser.
//
//   Inside the Playwright image on the Docker host (see PUBLISHING-CHECKLIST):
//     node tools/demo/numfields.js
//
// This needs a browser and cannot be a plain node harness: the whole question is
// what `<input type="number">.value` returns for input the user typed, and that is
// a browser behaviour. Guessing it got the fix wrong twice.
//
// MEASURED 24 Sep (chromium via playwright 1.55.0) — the number input does NOT
// blank invalid content, it hands the raw string through:
//     typed "6.9"  -> .value "6.9"  checkValidity() FALSE   parseInt -> 6
//     typed "1e3"  -> .value "1e3"  checkValidity() FALSE   parseInt -> 1
//     typed "1e1"  -> .value "1e1"  checkValidity() TRUE    parseInt -> 1  (should be 10)
//     typed "6abc" -> .value "6"    checkValidity() TRUE
// So parseInt silently stored a number the user never typed, and the browser's own
// verdict was being ignored. The shipped check is Number() + Number.isInteger() +
// range + checkValidity().
const { chromium } = require('./browser');

// [typed, expected stored value, or null if the save must reject it]
const CASES = [
  ['6', 6], ['0', 0], ['30', 30], [' 7 ', 7], ['+8', 8], ['08', 8],
  ['0x10', 10],  // the input strips the 'x': .value is "010"
  ['1e1', 10],   // valid sci-notation; parseInt used to store 1
  ['6.9', null], ['1e3', null], ['-1', null], ['abc', null], ['', null], ['31', null],
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<input type="number" id="n" min="0" max="30" step="1" />');
  let bad = 0;
  for (const [raw, want] of CASES) {
    const r = await p.evaluate((t) => {
      const el = document.getElementById('n');
      el.value = ''; el.focus();
      document.execCommand('insertText', false, t);
      // Mirrors the shipped save path in index.js.
      const s = el.value.trim();
      const v = s === '' ? NaN : Number(s);
      const rejected = !Number.isInteger(v) || v < 0 || v > 30 || !el.checkValidity();
      return rejected ? null : v;
    }, raw);
    const ok = r === want;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} typed ${JSON.stringify(raw).padEnd(8)} -> ${r === null ? 'rejected' : 'stores ' + r}   want ${want === null ? 'rejected' : want}`);
  }
  console.log(bad ? `\n${bad} failure(s)` : `\nall ${CASES.length} cases correct`);
  await b.close();
  process.exit(bad ? 1 : 0);
})();

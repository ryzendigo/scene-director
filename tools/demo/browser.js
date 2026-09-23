// Every driver needs a chromium handle, and where it comes from depends on where the
// driver runs: `playwright` locally, `playwright-core` inside the
// mcr.microsoft.com/playwright image (which ships the browsers at /ms-playwright but not
// the wrapper package). Five drivers hardcoded require('playwright') and were therefore
// unrunnable in the only environment that has a browser at all.
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  try {
    ({ chromium } = require('playwright-core'));
  } catch (e2) {
    console.error('Neither playwright nor playwright-core is installed.');
    console.error('See docs/PUBLISHING-CHECKLIST.md: run these inside the Playwright');
    console.error('image on the Docker host, pinning playwright-core to the image tag.');
    process.exit(2);
  }
}
module.exports = { chromium };

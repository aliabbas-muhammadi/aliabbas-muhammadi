#!/usr/bin/env node
// Renders assets/banner.html to assets/banner-light.png and assets/banner-dark.png
// at 2x, with transparent rounded corners.
//
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/render-banner.mjs
//
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to reuse an installed Chromium.
// Fonts come from Google Fonts; the script fails rather than render a fallback.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('assets/banner.html', root).href;
const FONTS = ['500 54px Fraunces', '400 20px Inter', '500 14px "JetBrains Mono"'];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 400 },
      deviceScaleFactor: 2,
    });
    await page.goto(`${source}?theme=${theme}`, { waitUntil: 'networkidle' });
    const missing = await page.evaluate(async (fonts) => {
      await document.fonts.ready;
      return fonts.filter((f) => !document.fonts.check(f));
    }, FONTS);
    if (missing.length) throw new Error(`Fonts did not load: ${missing.join(', ')}`);

    const out = fileURLToPath(new URL(`assets/banner-${theme}.png`, root));
    await page.locator('.card').screenshot({ path: out, omitBackground: true });
    console.log(`Wrote ${out}`);
    await page.close();
  }
} finally {
  await browser.close();
}

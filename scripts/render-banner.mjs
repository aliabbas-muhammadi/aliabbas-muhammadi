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
const FONTS = ['500 54px Fraunces', '400 20px Inter', '500 15px "JetBrains Mono"'];

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
    // fonts.check() is true for a family that was never registered, so it can't
    // catch a blocked stylesheet; load() resolves to no faces in that case.
    const missing = await page.evaluate(async (fonts) => {
      const out = [];
      for (const f of fonts) {
        try {
          if ((await document.fonts.load(f)).length === 0) out.push(f);
        } catch {
          out.push(f);
        }
      }
      return out;
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

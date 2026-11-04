// Renders public/icons/icon.svg to the PNG sizes required for PWA install / iOS home screen.
import { createRequire } from 'node:module';
// Resolve Playwright from the project or a globally installed copy (NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile } from 'node:fs/promises';
const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: new URL(`../public/icons/icon-${size}.png`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');

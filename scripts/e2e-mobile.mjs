// Mobile end-to-end check against a running server (default http://localhost:3000).
// Emulates phones + a desktop, walks every page, asserts content, no console errors,
// no horizontal overflow, PWA manifest + service worker, and live SSE updates.
//   BASE_URL=http://localhost:3000 node scripts/e2e-mobile.mjs
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SCREENSHOT_DIR ?? 'screenshots';
await mkdir(SHOTS, { recursive: true });

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };

const live = await (await fetch(`${BASE}/api/v1/matches?status=live`)).json();
const done = await (await fetch(`${BASE}/api/v1/matches?status=recent&limit=1`)).json();
const liveId = live[0]?.id, doneId = done[0]?.id;
const pages = [
  ['home', '/', '.match-card'],
  ['matches', '/matches?tab=recent', '.match-card'],
  ['match-live', `/match/${liveId}?tab=live`, '.comm li'],
  ['match-scorecard', `/match/${doneId}?tab=scorecard`, 'table tbody tr'],
  ['match-squads', `/match/${doneId}?tab=squads`, '.list a'],
  ['series', `/series/${done[0]?.series.id}`, 'table tbody tr'],
  ['team', '/team/ind', '.list a'],
  ['player', '/player/ind-1', '.stat'],
  ['rankings', '/rankings?format=T20&category=batting', 'table tbody tr'],
  ['news', '/news', '.news-card'],
  ['search', '/search?q=india', '.list a'],
  ['docs', '/docs', '.ep'],
];

const browser = await chromium.launch();
const profiles = [['iphone', devices['iPhone 13']], ['android', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }]];
for (const [label, device] of profiles) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ ...device, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Network errors while deliberately offline are expected; anything else is a bug.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED')) errors.push(m.text()); });
  for (const [name, path, selector] of pages) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    const ok = await page.waitForSelector(selector, { timeout: 8000 }).then(() => true, () => false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(ok, `${name}: renders ${selector}`);
    check(overflow <= 1, `${name}: no horizontal page scroll (${overflow}px)`);
    if (label !== 'desktop' || ['home', 'match-live', 'match-scorecard'].includes(name)) await page.screenshot({ path: `${SHOTS}/${label}-${name}.png`, fullPage: false });
  }
  if (label !== 'desktop') {
    const navVisible = await page.goto(BASE + '/').then(() => page.isVisible('.bottomnav'));
    check(navVisible, 'bottom navigation visible on phone');
    // client-side navigation through bottom nav
    await page.click('.bottomnav a[data-nav="rankings"]');
    check(await page.waitForSelector('h1:has-text("Rankings")', { timeout: 5000 }).then(() => true, () => false), 'bottom nav navigates (SPA)');
  }
  await page.goto(BASE + '/');
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  check(manifest.display === 'standalone' && manifest.icons.some((i) => i.sizes === '512x512'), 'PWA manifest is installable');
  await page.goto(BASE + '/');
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  check(sw, 'service worker active');

  const nowLive = (await (await fetch(`${BASE}/api/v1/matches?status=live`)).json())[0]?.id;
  if (label === 'iphone' && nowLive) {
    await page.goto(`${BASE}/match/${nowLive}?tab=live`);
    await page.waitForSelector('.comm li');
    const before = await page.textContent('.comm li .ov');
    const changed = await page.waitForFunction((b) => document.querySelector('.comm li .ov')?.textContent !== b, before, { timeout: 15000 }).then(() => true, () => false);
    check(changed, `live commentary updates via SSE (was ${before})`);
    await ctx.setOffline(true);
    await page.goto(`${BASE}/match/${nowLive}?tab=live`).catch(() => {});
    check(await page.waitForSelector('.hero', { timeout: 5000 }).then(() => true, () => false), 'works offline from service-worker cache');
    await ctx.setOffline(false);
  }
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll mobile/desktop checks passed');
process.exit(failures.length ? 1 : 0);

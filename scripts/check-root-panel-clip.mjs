// Synthetic geometry regression: no app credentials or customer messages.
// Mirrors the production carousel's width/left layout and Home's -mx-4 strip.
// Run: CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/check-root-panel-clip.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
 for (const width of [375, 390, 430]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.column{padding:20px 16px}.viewport{overflow:hidden}.track{display:flex;align-items:flex-start;position:relative;left:-100%;width:500%}.panel{width:20%;min-width:0;flex-shrink:0}.strip{margin:0 -16px;display:flex;overflow-x:auto;padding:0 16px}.card{width:230px;height:120px;flex-shrink:0;background:rgb(255,0,0)}.inbox{height:250px}.fixed{position:fixed;inset:0;z-index:99;display:none}</style><div class="column"><div class="viewport"><div class="track"><div class="panel"><div class="strip"><div class="card">Synthetic Home round</div><div class="card">Synthetic next round</div></div></div><div class="panel inbox">Synthetic inbox<div class="fixed">Synthetic modal</div></div><div class="panel">Play</div><div class="panel">Caddie</div><div class="panel">Me</div></div></div></div>`);
  const pixel = async () => {
    const { data, info } = await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true });
    const offset = (80 * info.width + 20) * info.channels;
    return [...data.subarray(offset, offset + 3)];
  };
  assert.deepEqual(await pixel(), [255, 0, 0], 'baseline reproduces neighboring round-card content at Inbox left');
  await page.evaluate(() => document.querySelectorAll('.panel').forEach(p => p.style.overflowX = 'clip'));
  assert.deepEqual(await pixel(), [255, 255, 255], 'per-panel clip removes neighboring content');
  // Keep page-level fixed overlays viewport-relative, not trapped by paint containment.
  await page.evaluate(() => document.querySelector('.fixed').style.display = 'block');
  const bounds = await page.locator('.fixed').boundingBox();
  assert.deepEqual(bounds, { x: 0, y: 0, width, height: 844 });
  assert.equal(await page.evaluate(() => document.elementFromPoint(2, 2)?.className), 'fixed');
  await page.evaluate(() => { document.querySelector('.fixed').style.display = 'none'; document.querySelector('.track').style.left = '0%'; });
  assert.deepEqual(await pixel(), [255, 0, 0], 'Home round content stays usable when Home is active');
  await page.evaluate(() => { document.querySelector('.strip').scrollLeft = 80; });
  assert.ok(await page.locator('.strip').evaluate(e => e.scrollLeft) > 0, 'Home horizontal scroll remains functional');
  await page.close();
 }
 console.log('PASS: baseline bleed, clipped Inbox, fixed modal viewport, Home scroll at375/390/430px');
} finally { await browser.close(); }

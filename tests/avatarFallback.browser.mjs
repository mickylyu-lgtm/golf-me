// Explicit local functional QA: node tests/avatarFallback.browser.mjs
// Synthetic identities/assets only; no backend or production writes.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/missing-*-avatar.jpg', r => r.fulfill({ status: 404, body: 'missing' }));
  await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/avatarFallback.html');
  const avatar = page.getByTestId('avatar');
  await avatar.getByText('TG', { exact: true }).waitFor();
  assert.equal(await avatar.locator('img').isVisible(), false);
  await avatar.click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByTestId('navigation').click();
  assert.equal(await page.getByTestId('clicks').textContent(), '1');
  await page.screenshot({ path: process.env.AVATAR_SCREENSHOT || '/tmp/avatar-fallback-synthetic.png' });
  await page.getByRole('button', { name: 'Working photo' }).click();
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid=avatar] img'); return i?.complete && i.naturalWidth > 0; });
  assert.equal(await avatar.locator('img').isVisible(), true);
  assert.equal(await avatar.getByText('TG', { exact: true }).count(), 0);
  await avatar.click();
  await page.getByRole('dialog').waitFor();
  // A viewer can fail after the thumbnail succeeded (network/cache eviction).
  await page.getByRole('dialog').locator('img').dispatchEvent('error');
  assert.equal(await avatar.locator('img').isVisible(), true);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await avatar.locator('img').dispatchEvent('error');
  await avatar.getByText('TG', { exact: true }).waitFor();
  await avatar.click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  // Browser load recovery for the same URL restores the image, not a stale viewer.
  await avatar.locator('img').dispatchEvent('load');
  assert.equal(await avatar.locator('img').isVisible(), true);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await avatar.click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  // Failing thumbnail cancels a pending long press; URL change resets failure.
  await avatar.locator('img').dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 50, clientY: 50 });
  await avatar.locator('img').dispatchEvent('error');
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: 'Broken photo' }).click();
  await avatar.getByText('TG', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Working photo' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=avatar] img')?.naturalWidth > 0);
  assert.equal(await avatar.locator('img').isVisible(), true);
  console.log('PASS: missing photo, navigation, URL reset, recovery, viewer failure, dismissal and pending long press.');
} finally { await browser.close(); await server.close(); }

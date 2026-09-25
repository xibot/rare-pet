import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const origin = process.env.RAREPET_TEST_URL || 'http://127.0.0.1:4175';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('artifacts', { recursive: true });
const errors = [];
try {
  for (const [width, height] of [[1440, 1100], [390, 844], [320, 700]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole('heading', { name: 'My RarePet.' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, `${width}: no horizontal overflow`);
    await page.screenshot({ path: `artifacts/rarepet-${width}.png`, fullPage: true });
    const value = name => page.locator('.trait').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('strong').innerText();
    await page.getByRole('button', { name: /^Pet,/ }).click();
    assert.equal(await value('Kinship'), '1');
    await page.getByRole('button', { name: /^Pet,/ }).click();
    assert.equal(await value('Kinship'), '1', 'Same-day pet is not a second reward');
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /^Feed,/ }).click();
    assert.equal(await value('Strength'), '5'); assert.equal(await value('Stamina'), '25');
    assert.equal(await page.getByRole('button', { name: /^Feed,/ }).isDisabled(), true);
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Poop,/ }).click();
    assert.equal(await value('Health'), '3');
    assert.equal(await page.getByRole('button', { name: /^Poop,/ }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /Launch coming soon/ }).isDisabled(), true);
    await page.reload(); assert.equal(await value('Strength'), '5', 'Demo state persists locally');
    await page.getByRole('button', { name: /CHOOSE FRIEND/ }).click();
    await page.getByRole('button', { name: /Mask #1 PREVIEW/ }).click();
    assert.equal(await value('Strength'), '0', 'Care state is isolated per Friend');
    await page.getByRole('button', { name: /^Play,/ }).click();
    await page.getByRole('button', { name: /LET.S RUSH/ }).waitFor();
    await page.screenshot({ path: `artifacts/rarepet-rush-${width}.png`, fullPage: true });
    if (width === 1440) {
      await page.clock.install();
      await page.getByRole('button', { name: /LET.S RUSH/ }).click();
      await page.clock.runFor(125_000);
      // Running the real engine to finish grants exactly one preview reward.
      await page.getByRole('button', { name: 'Close dialog' }).click();
      assert.equal(await value('Experience'), '10XP');
    } else {
      await page.getByRole('button', { name: /LET.S RUSH/ }).click();
      await page.getByRole('button', { name: 'Close dialog' }).click();
      assert.equal(await value('Experience'), '0XP', 'Opening or leaving an unfinished game earns no XP');
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('RarePet browser checks passed: desktop/mobile, care quotas, persistence, per-Friend isolation, real Rush completion XP, no runtime errors.');
} finally { await browser.close(); }

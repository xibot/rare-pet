import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const origin = process.env.RAREPET_TEST_URL || 'http://127.0.0.1:4175';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('artifacts', { recursive: true });
const errors = [];
const externalRequests = [];
const trait = (page, name) => page.locator('.trait').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('strong').innerText();
const careButton = (page, name) => page.getByRole('button', { name: new RegExp(`^${name},`) });
const modeButton = (page, name) => page.locator('.mode-switch').getByRole('button', { name: new RegExp(`^${name}$`, 'i') });
const careRecords = page => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('rarepet:preview:v1:'))));
async function fits(page, label) {
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, `${label}: no horizontal overflow`);
}
async function openPreviewPicker(page, collection) {
  await page.getByRole('button', { name: /CHOOSE FRIEND/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'PREVIEW FRIENDS', exact: true }).click();
  await dialog.getByRole('button', { name: collection, exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: collection, exact: true }).getAttribute('aria-pressed'), 'true');
  return dialog;
}
async function choosePreview(page, collection, name) {
  const dialog = await openPreviewPicker(page, collection);
  const cards = dialog.locator('.preview-picker').getByRole('button');
  const card = name ? cards.filter({ hasText: name }) : cards.first();
  const label = await card.locator('b').innerText();
  await card.click();
  assert.equal(await page.locator('.habitat-heading h2').innerText(), label);
  assert.equal(await modeButton(page, 'Preview').getAttribute('aria-pressed'), 'true');
  return label;
}
async function collectReactions(page, action, count) {
  const variants = new Set();
  for (let i = 0; i < count; i++) {
    await careButton(page, action).click();
    const motion = page.locator(`[data-action="${action.toLowerCase()}"][data-variant]`);
    await motion.waitFor();
    variants.add(await motion.getAttribute('data-variant'));
  }
  assert.equal(variants.size, 3, `${action} has three distinct reactions`);
}
async function play(page, { complete = false, portrait, bodyId } = {}) {
  await careButton(page, 'Play').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /LET.S RUSH/ }).waitFor();
  if (portrait) {
    const art = dialog.locator('image[data-genesis-art]').first();
    assert.equal(await art.getAttribute('href'), portrait, 'Rare Rush preserves the canonical Genesis portrait');
    assert.equal(await dialog.locator('[data-genesis-body]').first().getAttribute('data-genesis-body'), bodyId, 'Rare Rush keeps the chosen dashboard body');
  }
  const before = await trait(page, 'Experience');
  assert.equal(before, '0XP', 'Entering a game never awards XP');
  if (complete) await page.clock.install();
  await dialog.getByRole('button', { name: /LET.S RUSH/ }).click();
  if (portrait) {
    assert.equal(await dialog.locator('[data-genesis-body]').first().getAttribute('data-genesis-body'), bodyId, 'Starting a run keeps the chosen body');
  }
  if (complete) await page.clock.runFor(125_000);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(await trait(page, 'Experience'), complete ? '10XP' : '0XP', complete ? 'A completed preview run awards XP once' : 'Leaving an unfinished run earns no XP');
  if (complete) {
    await page.locator('.friend-art[data-action="play"]').waitFor();
    assert.equal(await page.locator('.friend-art[data-action="play"]').count(), 1, 'The completed-run celebration remains visible after closing results');
  } else {
    assert.equal(await page.locator('.friend-art[data-action="play"]').count(), 0, 'An unfinished run does not trigger a completion celebration');
  }
}

try {
  for (const [width, height] of [[1440, 1100], [390, 844], [320, 700]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === 'data:') return route.continue();
      externalRequests.push(url.href);
      return route.abort();
    });
    await page.goto(origin);
    await page.getByRole('heading', { name: 'My RarePet.' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => typeof window.ethereum), 'undefined', 'Preview runs without a wallet extension');
    assert.equal(await modeButton(page, 'Preview').getAttribute('aria-pressed'), 'true');
    assert.equal(await modeButton(page, 'My Wallet').getAttribute('aria-pressed'), 'false');
    const defaultLabel = await page.locator('.habitat-heading h2').innerText();
    await fits(page, `${width}px dashboard`);
    await page.screenshot({ path: `artifacts/rarepet-${width}.png`, fullPage: true });

    await collectReactions(page, 'Pet', 3);
    assert.equal(await trait(page, 'Kinship'), '1', 'Extra same-day pets refresh the bond without repeated rewards');
    await collectReactions(page, 'Feed', 5);
    assert.equal(await trait(page, 'Strength'), '5');
    assert.equal(await trait(page, 'Stamina'), '25');
    assert.equal(await careButton(page, 'Feed').isDisabled(), true);
    await collectReactions(page, 'Poop', 3);
    assert.equal(await trait(page, 'Health'), '3');
    assert.equal(await careButton(page, 'Poop').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /Launch coming soon/ }).isDisabled(), true);
    const generationRecords = await careRecords(page);
    assert.equal(Object.keys(generationRecords).length, 1);
    assert.match(Object.keys(generationRecords)[0], /^rarepet:preview:v1:\d+$/, 'Existing Generations care keeps its storage namespace');

    for (const floor of ['Meadow', 'Moon', 'Arcade', 'Beach', 'Rare']) {
      const button = page.getByRole('button', { name: floor, exact: true });
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true', `${floor} is selectable`);
      await fits(page, `${width}px ${floor} island`);
      if (width === 1440) await page.screenshot({ path: `artifacts/rarepet-island-${floor.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, fullPage: true });
    }
    await page.reload();
    assert.equal(await trait(page, 'Strength'), '5', 'Preview care persists locally');
    assert.equal(await page.getByRole('button', { name: 'Rare', exact: true }).getAttribute('aria-pressed'), 'true', 'Island choice persists locally');

    const firstGeneration = await choosePreview(page, 'Generations');
    assert.notEqual(firstGeneration, defaultLabel);
    assert.equal(await trait(page, 'Strength'), '0', 'Care is isolated between Generations Friends');
    await play(page, { complete: false });
    const genesisLabel = await choosePreview(page, 'Genesis');
    const portrait = await page.locator('.pet-portrait image[data-genesis-art]').getAttribute('href');
    assert(portrait?.startsWith('data:image/'), 'Genesis preview carries bundled canonical artwork');
    const oldBody = await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body');
    await page.getByRole('button', { name: /CHANGE BODY/ }).click();
    const bodyId = await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body');
    assert.notEqual(bodyId, oldBody, 'Change body never immediately repeats the current body');
    assert.equal(await page.locator('.pet-portrait image[data-genesis-art]').getAttribute('href'), portrait, 'Changing a body never changes canonical Genesis art');
    await careButton(page, 'Feed').click();
    assert.equal(await trait(page, 'Strength'), '1', 'Genesis preview can receive care without a wallet');
    const mixedRecords = await careRecords(page);
    assert.equal(mixedRecords[Object.keys(generationRecords)[0]], Object.values(generationRecords)[0], 'Genesis care never overwrites Generations care');
    assert(Object.keys(mixedRecords).some(key => key.includes('genesis:')), 'Genesis care has a separate collection namespace');
    await page.reload();
    assert.equal(await page.locator('.habitat-heading h2').innerText(), genesisLabel, 'The selected Genesis preview survives reload');
    assert.equal(await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body'), bodyId, 'The selected Genesis body survives reload');
    assert.equal(await trait(page, 'Strength'), '1');
    await fits(page, `${width}px Genesis dashboard`);
    await page.screenshot({ path: `artifacts/rarepet-genesis-${width}.png`, fullPage: true });

    // Once its own static assets load, both preview collections and the game work offline.
    await page.context().setOffline(true);
    await play(page, { complete: width === 1440, portrait, bodyId });
    await page.getByRole('button', { name: /RESET PREVIEW/i }).click();
    assert.equal(await trait(page, 'Strength'), '0', 'Reset clears the current Genesis preview');
    assert.equal(await trait(page, 'Experience'), '0XP');
    await choosePreview(page, 'Generations', defaultLabel);
    assert.equal(await trait(page, 'Strength'), '5', 'Resetting Genesis leaves the existing Generations preview intact');
    await choosePreview(page, 'Genesis', genesisLabel);
    assert.equal(await trait(page, 'Strength'), '0', 'Reset remains saved for that Genesis');
    await page.context().setOffline(false);
    await page.close();
    console.log(`${width}px: wallet-free preview, action variety, quotas, both collections, bodies, island persistence and reset isolation passed`);
  }

  const reduced = await browser.newPage({ reducedMotion: 'reduce' });
  reduced.on('pageerror', error => errors.push(error.message));
  await reduced.goto(origin);
  await careButton(reduced, 'Pet').click();
  const motion = reduced.locator('[data-action="pet"][data-variant]');
  await motion.waitFor();
  const animated = await motion.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length);
  assert.equal(animated, 0, 'Reduced motion disables decorative action animation');
  await reduced.close();
  assert.deepEqual(externalRequests, [], 'Preview makes no RPC or other external requests');
  assert.deepEqual(errors, [], 'No runtime errors');
  console.log('Genesis completed-run XP, original portrait preservation, offline preview and reduced-motion checks passed.');
} finally { await browser.close(); }

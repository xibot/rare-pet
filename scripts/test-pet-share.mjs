import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Exercise the real browser exporter. X is intercepted before any external request.
const origin = process.env.RAREPET_TEST_URL || 'http://127.0.0.1:4175';
const output = resolve('artifacts/share');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const errors = [], externalRequests = [], intents = [], exports = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
  if (url.origin === 'https://x.com' && url.pathname === '/intent/tweet') {
    intents.push(url.href);
    return route.fulfill({ contentType: 'text/html', body: '<title>Intercepted X intent</title><p>Browser QA: no post sent.</p>' });
  }
  externalRequests.push(url.href);
  return route.abort();
});
await context.addInitScript(() => {
  const walletMethods = [], writes = [];
  window.ethereum = {
    on() {}, removeListener() {},
    async request({ method }) {
      walletMethods.push(method);
      if (method === 'eth_accounts') return [];
      if (method === 'eth_chainId') return '0x1237';
      throw new Error(`Sharing must not request a wallet method: ${method}`);
    },
  };
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    writes.push({ key, value });
    return setItem.call(this, key, value);
  };
  window.shareQA = { walletMethods, writes, renderedSVG: null };
  const serialize = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (node) {
    const markup = serialize.call(this, node);
    if (node.querySelector?.('[data-share-slot="friend"]')) window.shareQA.renderedSVG = markup;
    return markup;
  };
});
const page = await context.newPage();
page.setDefaultTimeout(25_000);
page.on('pageerror', error => errors.push(error.message));
const shareDialog = () => page.getByRole('dialog', { name: 'A moment worth sharing.' });
const state = () => page.evaluate(() => ({
  storage: Object.fromEntries(Object.entries(localStorage)),
  traits: [...document.querySelectorAll('.trait')].map(el => el.textContent),
  writes: window.shareQA.writes.length,
  walletMethods: [...window.shareQA.walletMethods],
}));
async function ready(action) {
  const dialog = shareDialog();
  await dialog.locator('.share-image img').waitFor();
  await dialog.locator('.share-image img').evaluate(img => img.decode());
  assert.equal(await dialog.getByRole('button', { name: 'DOWNLOAD PNG' }).isEnabled(), true);
  if (action) assert.equal(await dialog.getByRole('button', { name: action, exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await dialog.locator('.share-image').getAttribute('aria-busy'), 'false');
  return dialog;
}
async function open() {
  await page.getByRole('button', { name: 'Share your Rare Friend on X' }).click();
  return ready();
}
async function close() { await shareDialog().getByRole('button', { name: 'Close sharing' }).click(); }
async function chooseAction(action) {
  await shareDialog().getByRole('button', { name: action, exact: true }).click();
  return ready(action);
}
async function imageData() {
  return Buffer.from(await shareDialog().locator('.share-image img').evaluate(async img => [...new Uint8Array(await (await fetch(img.src)).arrayBuffer())]));
}
function verifyPNG(bytes, label) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label}: real PNG`);
  assert.equal(bytes.readUInt32BE(16), 2000, `${label}: 2000px width`);
  assert.equal(bytes.readUInt32BE(20), 2000, `${label}: 2000px height`);
  assert(bytes.length > 15_000, `${label}: image contains detailed art`);
  return createHash('sha256').update(bytes).digest('hex');
}
async function download(label) {
  const event = page.waitForEvent('download');
  await shareDialog().getByRole('button', { name: 'DOWNLOAD PNG' }).click();
  const file = await event;
  assert.equal(await file.failure(), null);
  assert.match(file.suggestedFilename(), /^rarepet-(genesis|generations)-\d+-(garden|circuit|crystal|rooftop|tidal|orbital|meadow|moon|arcade|beach|rare)-(pet|feed|poop)-2000\.png$/);
  const path = resolve(output, `${label}.png`);
  await file.saveAs(path);
  const bytes = await readFile(path), hash = verifyPNG(bytes, label);
  assert.equal(hash, verifyPNG(await imageData(), `${label} preview`), 'Download exactly matches the displayed image');
  exports.push({ label, filename: file.suggestedFilename(), path, hash, bytes: bytes.length });
  return hash;
}
async function chooseFriend(collection) {
  await page.getByRole('button', { name: /CHOOSE FRIEND/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'PREVIEW FRIENDS', exact: true }).click();
  await dialog.getByRole('button', { name: collection, exact: true }).click();
  await dialog.locator('.preview-picker').getByRole('button').first().click();
}
async function assertShareIsReadOnly(before, label) {
  assert.deepEqual(await state(), before, `${label}: sharing changes no care, preferences, traits, or wallet requests`);
}
async function fits(label) {
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, `${label}: no page overflow`);
  assert.equal(await shareDialog().evaluate(el => el.scrollWidth > el.clientWidth), false, `${label}: no dialog overflow`);
}

try {
  await page.goto(origin);
  await page.getByRole('heading', { name: 'My RarePet.' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const initial = await state();
  await open();
  assert.equal(await shareDialog().locator('.share-x svg').count(), 1, 'X action carries the X logo');
  const actionHashes = [];
  for (const action of ['Pet', 'Feed', 'Poop']) {
    await chooseAction(action);
    actionHashes.push(await download(`generations-${action.toLowerCase()}`));
  }
  assert.equal(new Set(actionHashes).size, 3, 'Pet, Feed, and Poop produce different images');
  const firstPose = actionHashes[2];
  await shareDialog().getByRole('button', { name: /ANOTHER POSE/ }).click();
  await ready('Poop');
  assert.notEqual(await download('generations-poop-other-pose'), firstPose, 'Another pose actually changes the exported art');

  const caption = 'My Rare Friend #42 says: “stay rare” ♡ & share? 100%';
  await shareDialog().getByRole('textbox', { name: 'YOUR POST' }).fill(caption);
  const link = shareDialog().getByRole('link', { name: 'DOWNLOAD + SHARE ON X' });
  const url = new URL(await link.getAttribute('href'));
  assert.equal(url.origin, 'https://x.com');
  assert.equal(url.pathname, '/intent/tweet');
  assert.equal(url.searchParams.get('text'), caption, 'Caption punctuation, emoji, and reserved characters are encoded intact');
  assert.equal(url.searchParams.get('url'), 'https://rarepet.app');
  const downloadEvent = page.waitForEvent('download'), popupEvent = page.waitForEvent('popup');
  await link.click();
  const [xDownload, popup] = await Promise.all([downloadEvent, popupEvent]);
  await popup.waitForLoadState();
  assert.equal(await xDownload.failure(), null, 'Share on X also downloads the PNG');
  assert.equal(intents.length, 1, 'One intercepted composer intent opened');
  await popup.close();
  await assertShareIsReadOnly(initial, 'All action/pose/download/X controls');
  await close();

  // Hold one export completion so older work finishes after the user's new choice.
  await page.evaluate(() => {
    const native = HTMLCanvasElement.prototype.toBlob;
    window.shareQA.nativeToBlob = native;
    window.shareQA.delayNextBlob = true;
    window.shareQA.delayedBlobs = 0;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      const delay = window.shareQA.delayNextBlob;
      window.shareQA.delayNextBlob = false;
      if (delay) window.shareQA.delayedBlobs++;
      return native.call(this, blob => delay ? setTimeout(() => callback(blob), 800) : callback(blob), ...args);
    };
  });
  await page.getByRole('button', { name: 'Share your Rare Friend on X' }).click();
  await page.waitForFunction(() => window.shareQA.delayedBlobs === 1);
  await shareDialog().getByRole('button', { name: 'Feed', exact: true }).click();
  await shareDialog().getByRole('button', { name: 'Poop', exact: true }).click();
  await ready('Poop');
  const winning = verifyPNG(await imageData(), 'latest-action');
  await page.waitForTimeout(1100);
  assert.equal(verifyPNG(await imageData(), 'latest-action after old completion'), winning, 'A slow stale export cannot replace the latest action');
  await close();
  await page.evaluate(() => { window.shareQA.delayNextBlob = true; });
  await page.getByRole('button', { name: 'Share your Rare Friend on X' }).click();
  await page.waitForFunction(() => window.shareQA.delayedBlobs === 2);
  await close();
  await open();
  const reopened = verifyPNG(await imageData(), 'reopened dialog');
  await page.waitForTimeout(1100);
  assert.equal(verifyPNG(await imageData(), 'reopened after stale completion'), reopened, 'Closed dialog work cannot overwrite a newly opened image');
  await close();
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.shareQA.nativeToBlob; });
  await assertShareIsReadOnly(initial, 'Quick switches and close/reopen');

  // All floor families through the public picker, with both canonical collections.
  const families = { Worlds: ['Garden', 'Circuit', 'Crystal', 'Rooftop', 'Tidal', 'Orbital'], Classic: ['Meadow', 'Moon', 'Arcade', 'Beach', 'Rare'] };
  for (const collection of ['Generations', 'Genesis']) {
    await chooseFriend(collection);
    if (collection === 'Genesis') await page.getByRole('button', { name: /CHANGE BODY/ }).click();
    const selectedBody = collection === 'Genesis' ? await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body') : null;
    const floorHashes = [];
    for (const [family, floors] of Object.entries(families)) {
      await page.getByRole('button', { name: family, exact: true }).click();
      for (const floor of floors) {
        await page.getByRole('button', { name: floor, exact: true }).click();
        const before = await state();
        await open();
        assert.match(await shareDialog().locator('.share-image img').getAttribute('alt'), new RegExp(`on the ${floor.toLowerCase()} island`));
        const rendered = await page.evaluate(() => {
          const svg = new DOMParser().parseFromString(window.shareQA.renderedSVG, 'image/svg+xml');
          return { body: svg.querySelector('[data-genesis-body]')?.getAttribute('data-genesis-body'), classic: svg.querySelector('[data-classic-island]')?.getAttribute('data-classic-island'), world: svg.querySelector('[data-world-preset]')?.getAttribute('data-world-preset') };
        });
        if (selectedBody) assert.equal(rendered.body, selectedBody, 'PNG renderer uses the selected Genesis body');
        if (family === 'Classic') assert.equal(rendered.classic, floor.toLowerCase(), 'PNG renderer uses the selected Classic asset');
        else assert(rendered.world, 'PNG renderer contains the canonical World island');
        floorHashes.push(await download(`${collection.toLowerCase()}-${floor.toLowerCase()}`));
        await close();
        await assertShareIsReadOnly(before, `${collection} ${floor}`);
        if (selectedBody) assert.equal(await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body'), selectedBody, 'Export preserves selected Genesis body');
      }
    }
    assert.equal(new Set(floorHashes).size, 11, `${collection}: all 11 islands appear as distinct exported images`);
  }

  // A cosmetic body switch must change the actual PNG while the original portrait stays intact.
  const portrait = await page.locator('.pet-portrait image[data-genesis-art]').getAttribute('href');
  await open();
  const bodyBefore = await download('genesis-body-before');
  await close();
  await page.getByRole('button', { name: /CHANGE BODY/ }).click();
  assert.equal(await page.locator('.pet-portrait image[data-genesis-art]').getAttribute('href'), portrait);
  const bodyState = await state();
  await open();
  assert.notEqual(await download('genesis-body-after'), bodyBefore, 'Selected cosmetic body changes the exported image');
  await assertShareIsReadOnly(bodyState, 'Genesis body export');
  for (const action of ['Feed', 'Poop']) {
    await chooseAction(action);
    await download(`genesis-${action.toLowerCase()}`);
  }

  for (const [width, height] of [[1440, 1050], [390, 844], [320, 700]]) {
    await page.setViewportSize({ width, height });
    await fits(`${width}px sharing`);
    await page.screenshot({ path: resolve(output, `dialog-${width}.png`), fullPage: true });
    await shareDialog().getByRole('button', { name: 'DOWNLOAD PNG' }).scrollIntoViewIfNeeded();
    assert.equal(await shareDialog().getByRole('button', { name: 'DOWNLOAD PNG' }).isVisible(), true, `${width}px download remains reachable`);
  }
  await close();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assert.deepEqual(externalRequests, [], 'Rendering and sharing have no external requests except the explicitly intercepted X intent');
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ origin, exports, intents, errors, externalRequests }, null, 2));
  console.log(`Share QA passed: ${exports.length} real 2000×2000 PNG downloads; all 11 floors / both collections; actions, poses, body changes, stale work, X prefill, and responsive dialog.`);
} finally { await browser.close(); }

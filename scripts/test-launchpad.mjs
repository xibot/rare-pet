import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { buildPetSite, createPetServer } from './pet-site.mjs';

// Isolated build/server, synthetic raster fixtures, no wallet extension and no external/API requests.
const outdir = await mkdtemp(path.join(tmpdir(), 'rarepet-launch-preview-'));
const artifact = path.resolve('artifacts/launchpad');
const catalog = JSON.parse(await readFile(new URL('../games/rare-pet/launch-quote-catalog.json', import.meta.url), 'utf8'));
const stockIds = catalog.assets.filter(asset => asset.kind === 'stock').sort((a, b) => a.symbol.localeCompare(b.symbol)).map(asset => asset.id);
await mkdir(artifact, { recursive: true });
const previous = Object.fromEntries(['RAREPET_LAUNCHPAD_ADDRESS', 'BLOB_READ_WRITE_TOKEN'].map(key => [key, process.env[key]]));
process.env.RAREPET_LAUNCHPAD_ADDRESS = '0x7777777777777777777777777777777777777777';
process.env.BLOB_READ_WRITE_TOKEN = 'test-build-presence-only-never-sent';
let server, browser;
const errors = [], forbidden = [];
function restoreEnvironment() { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
function crc32(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) { result ^= byte; for (let i = 0; i < 8; i++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0); }
  return (result ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); result.write(type, 4); bytes.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4); return result;
}
function raster(width = 900, height = 600) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * (width * 3 + 1) + 1 + x * 3;
    // The central square is lime; red/blue sidebars must disappear after a centered crop.
    const rgb = x < (width - height) / 2 ? [255, 0, 0] : x >= (width + height) / 2 ? [0, 0, 255] : [204, 255, 0];
    pixels.set(rgb, index);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const validImage = { name: 'rare-preview-wide.png', mimeType: 'image/png', buffer: raster() };
const toggle = (root, mode) => root.getByRole('button', { name: mode === 'self' ? 'LAUNCH AS YOURSELF' : 'LAUNCH AS YOUR RARE FRIEND', exact: true });
async function fits(page, root, label) {
  const dimensions = await root.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { bodyWidth: document.body.scrollWidth, viewport: innerWidth, rootWidth: element.clientWidth, rootScroll: element.scrollWidth, left: rect.left, right: rect.right,
      pageCard: element.classList.contains('launch-page-card'), height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
  });
  assert(dimensions.bodyWidth <= dimensions.viewport + 1, `${label}: page has no horizontal overflow: ${JSON.stringify(dimensions)}`);
  assert(dimensions.rootScroll <= dimensions.rootWidth + 1, `${label}: form has no horizontal overflow: ${JSON.stringify(dimensions)}`);
  assert(dimensions.left >= -1 && dimensions.right <= dimensions.viewport + 1, `${label}: card stays within the viewport`);
  if (dimensions.pageCard) {
    assert(dimensions.scrollHeight <= dimensions.height + 1, `${label}: standalone page never clips its content in an inner scroller: ${JSON.stringify(dimensions)}`);
    assert.equal(dimensions.scrollTop, 0, `${label}: standalone card cannot internally scroll its heading away`);
  }
}
async function imagePrepared(root) {
  const image = root.getByAltText('Token image preview'); await image.waitFor();
  const dimensions = await image.evaluate(async element => { await element.decode(); return [element.naturalWidth, element.naturalHeight]; });
  assert.deepEqual(dimensions, [512, 512], 'image is prepared locally at exactly512×512');
  const colors = await image.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d'); context.drawImage(element, 0, 0);
    return [1, 256, 510].map(x => [...context.getImageData(x, 256, 1, 1).data]);
  });
  assert.deepEqual(colors, [[204,255,0,255], [204,255,0,255], [204,255,0,255]], 'rectangular image is centered and cropped without squeezing');
}
async function fillDraft(root, { name = 'Rare Preview', ticker = 'rare' } = {}) {
  await root.getByLabel('TOKEN NAME', { exact: true }).fill(name);
  await root.locator('#launch-symbol').fill(ticker);
  await root.getByLabel('Token image', { exact: true }).setInputFiles(validImage);
  await imagePrepared(root);
  assert.equal(await root.locator('#launch-symbol').inputValue(), ticker.toUpperCase());
}
async function review(root, mode, quote = 'AAPL', fee = '2') {
  await root.getByRole('button', { name: /^REVIEW PREVIEW/ }).click();
  await root.locator('.launch-review').waitFor();
  const text = await root.locator('.launch-review').innerText();
  assert(text.includes(`$RARE / ${quote}`)); assert(text.includes(`${fee}% of each swap`));
  assert(text.includes('1,000,000,000 tokens')); assert(text.includes('Approximately $10,000'));
  assert(text.includes('85% creator · 10% RarePet treasury · 5% Doppler'));
  assert(text.includes('Nothing has been uploaded or launched.'));
  assert.equal(await root.getByRole('button', { name: /CONFIRM LAUNCH IN WALLET|PUBLISH IMAGE/ }).count(), 0);
  assert.equal(await root.getByRole('button', { name: mode === 'self' ? 'CONNECT WALLET ↗' : 'CHOOSE MY FRIEND ↗', exact: true }).last().isVisible(), true);
}
async function invalidInputs(root) {
  await root.getByLabel('TOKEN NAME', { exact: true }).fill('Rare Preview');
  await root.locator('#launch-symbol').fill('RARE');
  await root.getByRole('button', { name: /^REVIEW PREVIEW/ }).click();
  assert.match(await root.getByRole('alert').innerText(), /Choose a token image/);
  for (const [file, expected] of [
    [{ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, /up to 5 MB/],
    [{ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }, /PNG, JPG or WebP/],
    [{ name: 'pretend.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') }, /PNG, JPG or WebP/],
    [{ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }, /up to 5 MB/],
    [{ name: 'too-wide.png', mimeType: 'image/png', buffer: raster(8193, 1) }, /smaller than 16 megapixels/],
  ]) {
    await root.getByLabel('Token image', { exact: true }).setInputFiles(file);
    await root.getByRole('alert').filter({ hasText: expected }).waitFor();
    assert.equal(await root.getByAltText('Token image preview').count(), 0, 'invalid file never becomes preview artwork');
  }
  await fillDraft(root);
  await root.getByLabel('TOKEN NAME', { exact: true }).fill('R');
  await root.getByRole('button', { name: /^REVIEW PREVIEW/ }).click();
  assert.match(await root.getByRole('alert').innerText(), /between 2 and 40/);
  await root.getByLabel('TOKEN NAME', { exact: true }).fill('Rare Preview');
  await root.locator('#launch-symbol').fill('@RARE');
  await root.getByRole('button', { name: /^REVIEW PREVIEW/ }).click();
  assert.match(await root.getByRole('alert').innerText(), /2–10 letters or numbers/);
  await root.locator('#launch-symbol').fill('rare');
  await root.getByRole('button', { name: /^REVIEW PREVIEW/ }).click();
  await root.locator('.launch-review').waitFor();
  assert.equal(await root.getByRole('alert').count(), 0, 'correcting the draft allows review without stale validation errors');
  await root.getByRole('button', { name: /EDIT TOKEN/ }).click();
}

try {
  await buildPetSite({ outdir }); restoreEnvironment();
  server = createPetServer(outdir);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [width, height] of [[1440,1000], [390,844], [320,740]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
      if (url.origin !== origin || url.pathname.startsWith('/api/')) { forbidden.push(`${route.request().method()} ${url.href}`); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${origin}/launch/`); await page.getByRole('heading', { name: 'RARE LAUNCHPAD', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    let root = page.locator('.launch-page-card');
    assert.equal(await page.evaluate(() => typeof window.ethereum), 'undefined');
    assert.equal(await toggle(root, 'self').getAttribute('aria-pressed'), 'true', 'standalone launch page starts with Yourself');
    assert.equal(await root.locator('.launch-friend').count(), 0, 'self creator does not display a fake Rare Friend');
    assert.match(await root.locator('.launch-self').innerText(), /No Rare Friend needed/);
    await fits(page, root, `${width} self form`);
    if (width === 1440) await invalidInputs(root); else await fillDraft(root);
    await root.getByRole('button', { name: /STOCKS/ }).click();
    assert.deepEqual(await root.locator('#launch-stock option').evaluateAll(options => options.map(option => option.value)), stockIds, 'every stock in the shared deployment catalog is selectable');
    assert.equal(await root.locator('#launch-stock-count').innerText(), `${stockIds.length} stock & ETF tokens`);
    for (const stock of ['nvda', 'qnt', 'crm', 'gld', 'qqq', 'tsla', 'spy', 'aapl']) { await root.locator('#launch-stock').selectOption(stock); assert.equal(await root.locator('#launch-stock').inputValue(), stock); }
    const search = root.getByLabel('FIND A STOCK OR ETF', { exact: true });
    await search.fill('salesforce');
    assert.equal(await root.locator('#launch-stock-count').innerText(), '1 match');
    assert.equal(await root.locator('#launch-stock').inputValue(), 'aapl', 'filtering never silently changes the selected pair');
    await search.press('Enter');
    assert.equal(await root.locator('.launch-review').count(), 0, 'Enter in stock search does not submit the form');
    assert.equal(await root.locator('#launch-stock').evaluate(element => element === document.activeElement), true);
    await root.locator('#launch-stock').selectOption('crm');
    await search.fill('qnt'); await root.locator('#launch-stock').selectOption('qnt');
    assert.equal(await root.locator('#launch-stock').inputValue(), 'qnt', 'issuer-only token absent from Bankr remains selectable');
    await search.fill('no-such-stock');
    assert.equal(await root.locator('#launch-stock-count').innerText(), '0 matches');
    assert.equal(await root.locator('#launch-stock').inputValue(), 'qnt');
    assert.match(await root.locator('.launch-stock-picker').innerText(), /No matches.*selected pair stays QNT/);
    await fits(page, root, `${width} empty stock search`);
    await root.getByRole('button', { name: 'CLEAR SEARCH ×', exact: true }).click();
    assert.equal(await search.inputValue(), '');
    assert.equal(await root.locator('#launch-stock option').count(), stockIds.length);
    await root.locator('#launch-stock').selectOption('aapl');
    await root.getByRole('button', { name: '2%', exact: true }).click();
    assert.equal(await root.getByRole('button', { name: '2%', exact: true }).getAttribute('aria-pressed'), 'true');
    await fits(page, root, `${width} stock form`);
    await page.screenshot({ path: path.join(artifact, `self-form-${width}.png`), fullPage: true });
    await review(root, 'self'); await fits(page, root, `${width} self review`);
    await page.screenshot({ path: path.join(artifact, `self-review-${width}.png`), fullPage: true });
    await root.getByRole('button', { name: /EDIT TOKEN/ }).click();
    assert.equal(await root.getByLabel('TOKEN NAME', { exact: true }).inputValue(), 'Rare Preview');
    assert.equal(await root.locator('#launch-symbol').inputValue(), 'RARE');
    assert.equal(await root.locator('#launch-stock').inputValue(), 'aapl'); await imagePrepared(root);
    await root.getByRole('button', { name: /WETH/ }).click();
    await root.getByRole('button', { name: '0.3%', exact: true }).click();
    await review(root, 'self', 'WETH', '0.3');

    await toggle(root, 'friend').click();
    assert.equal(await toggle(root, 'friend').getAttribute('aria-pressed'), 'true');
    assert.equal(await root.getByLabel('TOKEN NAME', { exact: true }).inputValue(), '', 'switching creator modes clears the old unsigned draft');
    assert.equal(await root.getByAltText('Token image preview').count(), 0);
    assert.match(await root.locator('.launch-friend').innerText(), /1 LAUNCH \/ 24H/);
    await fillDraft(root); await root.getByRole('button', { name: /STOCKS/ }).click(); await root.locator('#launch-stock').selectOption('aapl'); await root.getByRole('button', { name: '2%', exact: true }).click();
    await review(root, 'friend'); await fits(page, root, `${width} friend page review`);
    await page.screenshot({ path: path.join(artifact, `friend-page-review-${width}.png`), fullPage: true });
    if (width === 1440) {
      await root.getByRole('button', { name: 'CHOOSE MY FRIEND ↗', exact: true }).click();
      const picker = page.getByRole('dialog');
      await picker.getByRole('button', { name: 'PREVIEW FRIENDS', exact: true }).click();
      await picker.getByRole('button', { name: 'Genesis', exact: true }).click();
      const card = picker.locator('.preview-picker').getByRole('button').first(), label = await card.locator('b').innerText();
      await card.click(); await picker.waitFor({ state: 'hidden' });
      assert.equal(await toggle(root, 'friend').getAttribute('aria-pressed'), 'true', 'choosing another preview Friend preserves Rare Friend creator mode');
      assert((await root.locator('.launch-friend').innerText()).includes(label));
      await fits(page, root, 'changed preview Friend page');
    }
    await page.goto(origin); await page.getByRole('heading', { name: 'My RarePet.' }).waitFor();
    const beforeBrain = await page.locator('.trait').filter({ has: page.locator('span', { hasText: /^Brain$/ }) }).locator('strong').innerText();
    await page.getByRole('button', { name: /^Launch,/ }).click(); root = page.getByRole('dialog', { name: 'RARE LAUNCHPAD' }); await root.waitFor();
    assert.equal(await toggle(root, 'friend').getAttribute('aria-pressed'), 'true', 'care action opens the Rare Friend creator');
    await fillDraft(root); await fits(page, root, `${width} friend modal form`);
    await root.evaluate(element => { element.scrollTop = 0; });
    await root.screenshot({ path: path.join(artifact, `friend-modal-form-${width}.png`) });
    await root.getByRole('button', { name: /STOCKS/ }).click(); await root.locator('#launch-stock').selectOption('aapl'); await root.getByRole('button', { name: '2%', exact: true }).click();
    await review(root, 'friend'); await fits(page, root, `${width} friend modal review`);
    await root.evaluate(element => { element.scrollTop = 0; });
    await root.screenshot({ path: path.join(artifact, `friend-modal-review-${width}.png`) });
    await toggle(root, 'self').click(); assert.equal(await toggle(root, 'self').getAttribute('aria-pressed'), 'true');
    await fits(page, root, `${width} self modal`);
    await root.getByRole('button', { name: 'Close Rare Launchpad' }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('.trait').filter({ has: page.locator('span', { hasText: /^Brain$/ }) }).locator('strong').innerText(), beforeBrain, 'previewing never awards onchain Brain');
    assert.deepEqual(forbidden, [], 'preview never sends RPC, quotes, uploads or other external requests');
    await page.close(); console.log(`${width}px: standalone/self + Rare Friend modal, local512px crop, preview review/edit, pairs/fees and overflow passed`);
  }
  assert.deepEqual(errors, [], 'no browser runtime errors'); assert.deepEqual(forbidden, []);
  console.log(`Launch preview screenshots: ${artifact}`);
} finally {
  restoreEnvironment(); await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(outdir, { recursive: true, force: true });
}

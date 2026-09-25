import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Only this temporary build receives a read-only observer, fixed seed and legal
// input pilot. Production source never receives a test hook or health override.
const repo = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'rarepet-rush-twist-'));
const artifacts = path.join(repo, 'artifacts/pet-rush-twist');
const seed = '0x' + '1'.padStart(64, '0'); // Normal visits up, down, then a leftward exit.
const trait = (page, name) => page.locator('.trait').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('strong').innerText();
const playButton = page => page.getByRole('button', { name: /^Play,/ });
let built, server, browser;
const report = [];

try {
  await mkdir(artifacts, { recursive: true });
  await cp(path.join(repo, 'games'), path.join(temporary, 'games'), { recursive: true, filter: source => !source.includes(`${path.sep}.friendsdk`) });
  await cp(path.join(repo, 'shared'), path.join(temporary, 'shared'), { recursive: true });
  await cp(path.join(repo, 'licenses'), path.join(temporary, 'licenses'), { recursive: true });
  await cp(path.join(repo, 'THIRD_PARTY_NOTICES.md'), path.join(temporary, 'THIRD_PARTY_NOTICES.md'));
  await mkdir(path.join(temporary, 'scripts'));
  await cp(path.join(repo, 'scripts/pet-site.mjs'), path.join(temporary, 'scripts/pet-site.mjs'));
  await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}\n');
  await symlink(await realpath(path.join(repo, 'node_modules')), path.join(temporary, 'node_modules'), 'dir');
  const gameSource = path.join(temporary, 'games/rare-rush/index.tsx');
  let source = await readFile(gameSource, 'utf8');
  const stepAnchor = 'const events = advanceHumanRecording(currentRecording, screenAxis());';
  const observeAnchor = 'const run = engine.current, e = economy.current';
  assert.equal(source.split(stepAnchor).length, 2, 'The canonical fixed-step recorder is present exactly once');
  assert.equal(source.split(observeAnchor).length, 2, 'The game has one observation point');
  assert.equal((source.match(/const runSeed = .*;/g) ?? []).length, 1, 'The game has one seeded entry point');
  source = `import { demoControls as qaDemoControls } from './twist/engine';\nimport { canonicalAxis as qaCanonicalAxis } from './twist/presentation';\n` + source;
  source = source.replace(/const runSeed = .*;/, `const runSeed = '${seed}';`);
  source = source.replace(stepAnchor, `
          let qaAxis = screenAxis();
          if ((globalThis as any).__petRushQA?.pilot) {
            const controls = qaDemoControls(engine.current);
            currentRecording.slide = controls.slide;
            if (controls.jump) queueHumanJump(currentRecording);
            qaAxis = qaCanonicalAxis(controls.axis, engine.current.phase, headingFor(engine.current));
          }
          const events = advanceHumanRecording(currentRecording, qaAxis);`);
  source = source.replace(observeAnchor, `
  const qa = ((globalThis as any).__petRushQA ??= { pilot: true });
  qa.read = () => structuredClone(engine.current);
  qa.reward = () => reward.current.toString();
  ${observeAnchor}`);
  await writeFile(gameSource, source);
  const { buildPetSite, createPetServer } = await import(pathToFileURL(path.join(temporary, 'scripts/pet-site.mjs')).href);
  built = await buildPetSite({ outdir: path.join(temporary, 'dist') });
  server = createPetServer(built.outdir);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.RUSH_BROWSER_CHANNEL || 'chrome' });

  for (const collection of ['Generations', 'Genesis']) for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(15_000);
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      externalRequests.push(url.href);
      return route.abort();
    });
    const clock = new Date('2026-09-25T12:00:00Z');
    await page.clock.install({ time: clock });
    await page.clock.pauseAt(clock);
    await page.goto(origin);
    await page.getByRole('heading', { name: 'My RarePet.' }).waitFor();
    await page.getByRole('button', { name: /CHOOSE FRIEND/ }).click();
    const picker = page.getByRole('dialog');
    await picker.getByRole('button', { name: 'PREVIEW FRIENDS', exact: true }).click();
    await picker.getByRole('button', { name: collection, exact: true }).click();
    await picker.locator('.preview-picker').getByRole('button').first().click();
    const portrait = collection === 'Genesis' ? await page.locator('.pet-portrait [data-genesis-art]').getAttribute('href') : null;
    if (collection === 'Genesis') await page.getByRole('button', { name: /CHANGE BODY/ }).click();
    const bodyId = collection === 'Genesis' ? await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body') : null;
    const read = () => page.evaluate(() => window.__petRushQA.read());
    const visual = () => page.locator('.pet-play-dialog [data-character="friend"]').evaluate(element => ({
      spin: Number(element.getAttribute('data-spin')), x: Number(element.getAttribute('data-screen-x')), y: Number(element.getAttribute('data-screen-y')),
    }));
    async function open() {
      await playButton(page).click();
      const dialog = page.locator('.pet-play-dialog');
      await dialog.getByRole('button', { name: /LET.S RUSH/ }).waitFor();
      assert.equal(await dialog.locator('.pet-play-heading').count(), 1);
      assert.equal(await dialog.locator('.rush-context').count(), 0);
      const [sx, sy] = await dialog.locator('.world-svg').evaluate(svg => { const matrix = svg.getScreenCTM(); return [matrix.a, matrix.d]; });
      assert(Math.abs(sx - sy) < .001, 'World pixels scale equally along both axes');
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
      await dialog.getByRole('button', { name: /LET.S RUSH/ }).click();
      await dialog.locator('[data-screen="running"]').waitFor();
      await page.clock.runFor(100);
      return dialog;
    }
    async function until(seconds) {
      let previous = await read();
      while (previous.elapsed < seconds && previous.status !== 'finished') {
        await page.clock.runFor(Math.min(1000, Math.ceil((seconds - previous.elapsed) * 1000) + 18));
        const current = await read();
        assert(current.elapsed > previous.elapsed, `${collection}/${width}: game time advances`);
        previous = current;
      }
      assert(previous.status !== 'finished' || seconds >= previous.duration, `Legal pilot survives to ${seconds}s (got ${previous.elapsed}s)`);
      return previous;
    }
    await open();
    await until(2);
    await page.getByRole('button', { name: 'Close Rare Rush' }).click();
    assert.equal(await trait(page, 'Experience'), '0XP', 'Abandoning a run earns no XP and consumes no slot');

    const dialog = await open();
    const initial = await read(), phases = [], headings = new Set([1]);
    assert.equal(initial.seed, seed);
    for (const phase of initial.phasePlan.slice(1)) {
      if (phase.phase === 'side') {
        await until(phase.start + 1.3);
        headings.add(Number(await dialog.locator('.rare-rush').getAttribute('data-heading')));
        continue;
      }
      await until(phase.start + .2);
      const entering = await read();
      assert(entering.transition?.from === 'side' && entering.transition?.to === phase.phase);
      assert.equal(await dialog.locator('[data-chunk="incoming"]').count(), 1);
      assert.equal(await dialog.locator('[data-chunk="outgoing"]').count(), 1);
      for (const offset of [.3, .8, 1.05, 1.18, 1.3]) {
        const state = await until(entering.phaseEnteredAt + offset), sample = await visual();
        const expected = (state.phase === 'up' ? -1 : 1) * 180 * (state.elapsed - state.phaseEnteredAt);
        assert(Math.abs(sample.spin - expected) < .01, 'Shaft entrance and travel maintain uninterrupted spin');
      }
      assert.equal((await read()).transition, undefined);
      assert.equal(await dialog.locator('button[aria-label="Steer right"]').count(), 1);
      if (collection === 'Genesis') {
        assert.equal(await dialog.locator('[data-genesis-body]').getAttribute('data-genesis-body'), bodyId);
        assert.equal(await dialog.locator('[data-genesis-art]').getAttribute('href'), portrait);
      }
      await dialog.screenshot({ path: path.join(artifacts, `${collection.toLowerCase()}-${width}-${phase.phase}.png`), animations: 'allow' });
      if (!phases.length) {
        await dialog.getByRole('button', { name: 'Pause game', exact: true }).click();
        const paused = await read(), pausedVisual = await visual();
        await page.clock.runFor(400);
        assert.equal((await read()).elapsed, paused.elapsed);
        assert.equal((await visual()).spin, pausedVisual.spin);
        await dialog.getByRole('button', { name: /KEEP RUNNING/ }).click();
        await page.evaluate(() => { window.__petRushQA.pilot = false; });
        const before = await read();
        if (width < 600) {
          const bounds = await dialog.getByRole('button', { name: 'Steer right', exact: true }).boundingBox();
          assert(bounds && bounds.width >= 44 && bounds.height >= 44);
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.down();
        } else { await dialog.locator('.world-svg').focus(); await page.keyboard.down('ArrowRight'); }
        await page.clock.runFor(100);
        assert((await read()).player.x > before.player.x, 'Real keyboard/touch steers in vertical phases');
        if (width < 600) await page.mouse.up(); else await page.keyboard.up('ArrowRight');
        await page.clock.runFor(20);
        assert.equal((await read()).pace, 0);
        await page.evaluate(() => { window.__petRushQA.pilot = true; });
      }
      phases.push(phase.phase);
    }
    assert.deepEqual(phases.sort(), ['down', 'up']);
    assert(headings.has(-1), 'The latest occasional leftward exit is rendered');
    await dialog.screenshot({ path: path.join(artifacts, `${collection.toLowerCase()}-${width}-reverse.png`), animations: 'allow' });
    const finished = await until(initial.duration + .1);
    assert.equal(finished.finishReason, 'time');
    assert(finished.hearts > 0 && finished.coins > 0);
    assert.equal(await dialog.locator('.rare-rush').getAttribute('data-screen'), 'result');
    assert.equal(await trait(page, 'Experience'), '10XP');
    await page.clock.runFor(1000);
    assert.equal(await trait(page, 'Experience'), '10XP', 'Completion awards XP exactly once');
    assert.equal(await dialog.getByRole('button', { name: /SAVE RUN/ }).count(), 0, 'Unwired public replay publishing is not offered inside RarePet');
    const demoReward = BigInt(await page.evaluate(() => window.__petRushQA.reward()));
    const expectedReward = BigInt(finished.coins + 9 * finished.bonusCoins) * 10_000_000n * (collection === 'Genesis' ? 100n : 1n);
    assert.equal(demoReward, expectedReward < 200_000_000_000n ? expectedReward : 200_000_000_000n);
    await dialog.screenshot({ path: path.join(artifacts, `${collection.toLowerCase()}-${width}-result.png`) });

    if (collection === 'Generations' && width === 1440) {
      for (let completion = 2; completion <= 3; completion++) {
        await dialog.getByRole('button', { name: /RUN IT BACK/ }).click();
        await dialog.locator('[data-screen="running"]').waitFor();
        await until(90.1);
        assert.equal(await trait(page, 'Experience'), `${completion * 10}XP`);
      }
      await dialog.getByRole('button', { name: /RUN IT BACK/ }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.locator('.rare-rush').getAttribute('data-screen'), 'result', 'A fourth entry cannot bypass the Play cooldown');
      assert.equal(await trait(page, 'Experience'), '30XP');
      await dialog.getByRole('button', { name: 'Close Rare Rush' }).click();
      assert.equal(await playButton(page).isDisabled(), true);
      await page.reload();
      assert.equal(await trait(page, 'Experience'), '30XP');
      assert.equal(await playButton(page).isDisabled(), true, 'Play cooldown survives reload');
      await page.clock.fastForward(24 * 3_600_000 + 1000);
      assert.equal(await playButton(page).isDisabled(), false, 'Rolling slots refill after 24 hours');
    } else await dialog.getByRole('button', { name: 'Close Rare Rush' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, [], 'Preview needs no wallet, external RPC, analytics or replay service');
    report.push({ collection, width, phases, headings: [...headings], coins: finished.coins, hearts: finished.hearts, bodyId });
    console.log(`${collection}/${width}: connected up/down tracks, spin, reverse exit, controls, proportions, body and XP passed`);
    await page.close();
  }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await built?.close();
  await rm(temporary, { recursive: true, force: true });
}

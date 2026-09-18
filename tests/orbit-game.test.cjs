const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createStaticServer } = require('../tools/server.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.SITE_ARTIFACT_DIR || 'D:/ao/1gpt/temp/orbit-game');
const storageKey = 'ziwei-orbit-best-v1';
let checks = 0;

function pass(message) {
  checks += 1;
  process.stdout.write(`PASS ${message}\n`);
}

function verifyAssetIsolation() {
  const files = fs.readdirSync(path.join(root, 'dist'), { recursive: true })
    .filter((file) => file.endsWith('.html'));
  const gameAssets = [
    /\/assets\/js\/orbit-engine\.[a-f0-9]{16}\.js/,
    /\/assets\/js\/orbit-game\.[a-f0-9]{16}\.js/,
    /\/assets\/css\/orbit-game\.[a-f0-9]{16}\.css/,
  ];
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, 'dist', file), 'utf8');
    const about = file.replaceAll('\\', '/') === 'about/index.html';
    for (const pattern of gameAssets) {
      assert.equal(pattern.test(html), about, `${file}: game assets must be versioned and confined to about`);
    }
  }
  pass('only the about page loads content-addressed game assets');
}

async function observeEngine(page) {
  // Observe the real engine without exposing a production debugging interface.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'OrbitEngine', {
      configurable: true,
      set(Original) {
        Object.defineProperty(window, 'OrbitEngine', {
          configurable: true,
          value: new Proxy(Original, {
            construct(Constructor, args, NewTarget) {
              const instance = Reflect.construct(Constructor, args, NewTarget);
              window.__orbitTestEngine = instance;
              return instance;
            },
          }),
        });
      },
    });
  });
}

async function readState(page) {
  return page.evaluate(() => {
    const engine = window.__orbitTestEngine;
    const state = engine.getState();
    return {
      mode: document.querySelector('#orbit-lab').dataset.mode,
      elapsed: state.elapsed,
      phase: state.phase,
      score: state.score,
      ship: { ...state.ship },
      captureCount: state.captureCount,
      rewindAvailable: state.rewindAvailable,
    };
  });
}

async function advance(page, milliseconds) {
  await page.clock.runFor(milliseconds);
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
    canvas: document.querySelector('#orbit-canvas').getBoundingClientRect().toJSON(),
  }));
  assert.ok(dimensions.page <= dimensions.viewport, JSON.stringify(dimensions));
  assert.ok(dimensions.canvas.left >= -1 && dimensions.canvas.right <= dimensions.viewport + 1,
    'game canvas extends outside the viewport');
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(artifacts, name), fullPage: false });
}

async function openGamePage(browser, baseUrl, options = {}) {
  const context = await browser.newContext({
    viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    hasTouch: Boolean(options.mobile),
    isMobile: Boolean(options.mobile),
    reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await observeEngine(page);
  if (options.corruptStorage) {
    await page.addInitScript((key) => localStorage.setItem(key, '{broken-json'), storageKey);
  }
  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-18T12:00:01Z'));
  const response = await page.goto(`${baseUrl}/about/`, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => typeof window.OrbitEngine === 'function');
  await page.locator('#orbit-start').waitFor({ state: 'visible' });
  await page.locator('#orbit-lab').scrollIntoViewIfNeeded();
  await advance(page, 80);
  return { context, page, errors };
}

async function startGame(page) {
  await page.locator('#orbit-start').click();
  await advance(page, 80);
  const state = await readState(page);
  assert.equal(state.mode, 'playing');
  assert.equal(state.phase, 'running');
}

async function forceCollision(page) {
  // Put the actual ship behind the hazard, then let the normal physics and UI
  // produce the loss. Never fake completion through DOM attributes or events.
  await page.evaluate(() => {
    const state = window.__orbitTestEngine.state;
    state.ship.orbitId = null;
    state.ship.y = state.blackHoleY - 1000;
  });
  await advance(page, 80);
  assert.equal((await readState(page)).phase, 'lost');
  assert.equal(await page.locator('#orbit-lab').getAttribute('data-mode'), 'over');
}

async function desktopChecks(browser, baseUrl) {
  const { context, page, errors } = await openGamePage(browser, baseUrl);
  try {
    assert.equal(await page.locator('#orbit-lab').getAttribute('data-mode'), 'idle');
    assert.equal(await page.locator('#orbit-status').getAttribute('aria-live'), 'polite');
    assert.equal(await page.locator('[data-route="about"]').getAttribute('aria-current'), 'page');
    await assertNoOverflow(page);
    await screenshot(page, 'orbit-desktop-entry.png');
    await startGame(page);
    pass('desktop entry starts a real running game and preserves about navigation');

    const grab = await page.locator('#orbit-grab').boundingBox();
    assert.ok(grab);
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await advance(page, 900);
    const captured = await readState(page);
    assert.notEqual(captured.ship.orbitId, null, 'holding pointer did not capture a planet');
    await page.mouse.up();
    await advance(page, 80);
    const launched = await readState(page);
    assert.equal(launched.ship.orbitId, null, 'releasing pointer did not launch the ship');
    assert.ok(Math.hypot(launched.ship.vx, launched.ship.vy) > 0, 'ship has no launch velocity');
    assert.ok(launched.captureCount >= 1);
    pass('pointer hold captures gravity and release launches with velocity');

    await page.locator('#orbit-pause').click();
    assert.equal((await readState(page)).mode, 'paused');
    const paused = await readState(page);
    await advance(page, 1300);
    assert.equal((await readState(page)).elapsed, paused.elapsed, 'pause advanced game time');
    await page.locator('#orbit-pause').click();
    await advance(page, 400);
    assert.ok((await readState(page)).elapsed > paused.elapsed, 'resume did not advance physics');
    pass('pause freezes physics and resume advances it again');

    // Restart to exercise keyboard controls from the initial, reachable planet.
    await page.locator('#orbit-close').click();
    await startGame(page);
    await page.locator('#orbit-canvas').focus();
    const beforeKeyboardScroll = await page.evaluate(() => scrollY);
    await page.keyboard.down('Space');
    await advance(page, 900);
    assert.notEqual((await readState(page)).ship.orbitId, null, 'Space did not capture gravity');
    await screenshot(page, 'orbit-desktop-playing.png');
    // Keep the real orbit stable long enough to create a two-second history.
    await advance(page, 2400);
    await page.keyboard.up('Space');
    await advance(page, 80);
    assert.equal((await readState(page)).ship.orbitId, null, 'Space release did not launch');
    assert.equal(await page.evaluate(() => scrollY), beforeKeyboardScroll, 'Space scrolled the page');
    pass('Space supports the same capture and release without scrolling');

    const beforeRewind = await readState(page);
    assert.equal(beforeRewind.phase, 'running');
    assert.ok(beforeRewind.elapsed >= 2);
    await page.locator('#orbit-rewind').click();
    const afterRewind = await readState(page);
    assert.ok(beforeRewind.elapsed - afterRewind.elapsed >= 1.8,
      `rewind moved only ${beforeRewind.elapsed - afterRewind.elapsed} seconds`);
    assert.equal(afterRewind.rewindAvailable, false);
    assert.equal(await page.locator('#orbit-rewind').isDisabled(), true);
    pass('rewind restores two seconds of real history and is limited to one use');

    // Begin a fresh course so later checks exercise the loss screen with its
    // own rewind charge, rather than the charge consumed above.
    await page.locator('#orbit-close').click();
    await startGame(page);
    const recoveryGrab = await page.locator('#orbit-grab').boundingBox();
    await page.mouse.move(recoveryGrab.x + recoveryGrab.width / 2, recoveryGrab.y + recoveryGrab.height / 2);
    await page.mouse.down();
    await advance(page, 900);
    await page.mouse.up();
    await advance(page, 80);
    assert.ok((await readState(page)).score > 0, 'fresh course did not produce a score');
    const historyGrab = await page.locator('#orbit-grab').boundingBox();
    await page.mouse.move(historyGrab.x + historyGrab.width / 2, historyGrab.y + historyGrab.height / 2);
    await page.mouse.down();
    await advance(page, 2600);
    await page.mouse.up();
    await advance(page, 80);
    assert.ok((await readState(page)).elapsed >= 2, 'fresh course did not retain enough rewind history');

    await page.setViewportSize({ width: 390, height: 844 });
    await advance(page, 100);
    await assertNoOverflow(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await advance(page, 100);
    await assertNoOverflow(page);
    pass('resizing a live game between desktop and phone creates no overflow');

    // A hidden document must stop simulation; visibility alone must not resume it.
    if ((await readState(page)).mode === 'paused') await page.locator('#orbit-pause').click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await readState(page);
    await advance(page, 1000);
    assert.equal((await readState(page)).elapsed, hidden.elapsed, 'background tab advanced physics');
    assert.equal((await readState(page)).mode, 'paused');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.locator('#orbit-pause').click();
    pass('backgrounding the tab pauses play until explicit resume');

    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await advance(page, 120);
    assert.equal((await readState(page)).mode, 'paused', 'scrolling away did not pause game');
    await page.locator('#orbit-canvas').scrollIntoViewIfNeeded();
    await page.locator('#orbit-pause').click();
    pass('scrolling out of the game pauses the run');

    await forceCollision(page);
    await screenshot(page, 'orbit-desktop-over.png');
    const record = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.ok(record && record.score > 0, 'best score was not saved');
    assert.ok(Array.isArray(record.ghost) && record.ghost.length > 1, 'ghost trajectory was not saved');
    assert.ok(Number.isFinite(record.seed), 'ghost does not retain its course seed');
    assert.ok((await page.locator('#orbit-best').innerText()).trim().length > 0);
    pass('actual collision shows game over and stores the best score with its ghost');

    // Recovery is available directly from the loss screen, too. This uses
    // the engine history rather than restarting the course.
    const lostElapsed = (await readState(page)).elapsed;
    assert.equal(await page.locator('#orbit-rewind').isDisabled(), false,
      `loss rewind disabled: ${JSON.stringify(await readState(page))}`);
    await page.locator('#orbit-rewind').click();
    await advance(page, 80);
    const recovered = await readState(page);
    assert.equal(recovered.mode, 'playing');
    assert.equal(recovered.phase, 'running');
    assert.ok(lostElapsed - recovered.elapsed >= 1.8,
      `loss-screen rewind moved only ${lostElapsed - recovered.elapsed} seconds`);
    pass('loss screen can rewind into the existing flight history');

    await forceCollision(page);

    await page.locator('#orbit-retry').click();
    await advance(page, 80);
    const retried = await readState(page);
    assert.equal(retried.mode, 'playing');
    assert.equal(retried.phase, 'running');
    assert.ok(retried.elapsed < 0.25, 'retry did not reset elapsed time');
    assert.equal(retried.rewindAvailable, true);
    await page.locator('#orbit-close').click();
    assert.equal(await page.locator('#orbit-lab').getAttribute('data-mode'), 'idle');
    assert.equal(await page.locator('#orbit-start').isVisible(), true);
    assert.deepEqual(errors, [], 'desktop browser errors');
    pass('one-click retry resets the run, and exit returns to the quiet entry');
  } finally {
    await context.close();
  }
}

async function mobileChecks(browser, baseUrl) {
  const { context, page, errors } = await openGamePage(browser, baseUrl, { mobile: true });
  try {
    await startGame(page);
    await page.locator('#orbit-canvas').scrollIntoViewIfNeeded();
    await advance(page, 40);
    const canvas = await page.locator('#orbit-canvas').boundingBox();
    assert.ok(canvas);
    const x = Math.round(canvas.x + canvas.width * 0.5);
    const y = Math.round(Math.min(650, canvas.y + canvas.height * 0.5));
    const beforeScroll = await page.evaluate(() => scrollY);
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4 }],
    });
    await advance(page, 900);
    assert.notEqual((await readState(page)).ship.orbitId, null, 'touch hold did not capture a planet');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + 30, y: y - 90, id: 1, radiusX: 4, radiusY: 4 }],
    });
    await advance(page, 80);
    assert.equal(await page.evaluate(() => scrollY), beforeScroll, 'touch gesture scrolled instead of playing');
    await screenshot(page, 'orbit-mobile-playing.png');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await advance(page, 80);
    assert.equal((await readState(page)).ship.orbitId, null, 'touch release did not launch');
    await assertNoOverflow(page);
    for (const selector of ['#orbit-grab', '#orbit-pause', '#orbit-rewind', '#orbit-close']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `${selector} has an undersized touch target`);
    }
    assert.deepEqual(errors, [], 'mobile browser errors');
    pass('390px real touch captures and releases, blocks page gestures, and has usable controls');
  } finally {
    await context.close();
  }
}

async function reducedMotionChecks(browser, baseUrl) {
  const { context, page, errors } = await openGamePage(browser, baseUrl, {
    mobile: true, reducedMotion: true, corruptStorage: true,
  });
  try {
    assert.equal(await page.locator('#orbit-calm').isChecked(), true);
    await startGame(page);
    const before = await readState(page);
    await advance(page, 320);
    const after = await readState(page);
    assert.ok(after.elapsed > before.elapsed, 'reduced motion disabled gameplay');
    const pixels = await page.locator('#orbit-canvas').evaluate((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      for (let index = 0; index < data.length; index += 16) {
        if (data[index] + data[index + 1] + data[index + 2] > 100) bright += 1;
      }
      return bright;
    });
    assert.ok(pixels > 50, 'calm game canvas is blank');
    await assertNoOverflow(page);
    assert.deepEqual(errors, [], 'reduced-motion browser errors');
    pass('reduced motion chooses calm visuals and corrupt saved records do not block play');
  } finally {
    await context.close();
  }
}

async function main() {
  verifyAssetIsolation();
  fs.mkdirSync(artifacts, { recursive: true });
  const server = createStaticServer(path.join(root, 'dist'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = (process.env.SITE_BASE_URL || `http://127.0.0.1:${server.address().port}`).replace(/\/$/, '');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((candidate) => candidate && fs.existsSync(candidate));
  assert.ok(executablePath, 'Chrome or Edge is required for browser verification');
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
    });
    await desktopChecks(browser, baseUrl);
    await mobileChecks(browser, baseUrl);
    await reducedMotionChecks(browser, baseUrl);
    process.stdout.write(`${JSON.stringify({ status: 'passed', checks, baseUrl, artifacts })}\n`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

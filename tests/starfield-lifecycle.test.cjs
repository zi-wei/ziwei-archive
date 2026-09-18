const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { createStaticServer } = require('../tools/server.cjs');

async function main() {
  const server = createStaticServer(path.resolve(__dirname, '..', 'dist'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.SITE_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((candidate) => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    // Observe the real instance without adding a production debug API.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'AppleStarfield', {
        configurable: true,
        set(Original) {
          Object.defineProperty(window, 'AppleStarfield', {
            configurable: true,
            value: function (...args) {
              const field = new Original(...args);
              window.__fieldUnderTest = field;
              return field;
            },
          });
        },
      });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#apple-starfield').dataset.ready === 'true');
    const earlyReplay = await page.evaluate(() => {
      const field = window.__fieldUnderTest;
      field.stop();
      field.introElapsed = 0.5;
      field.hasFormed = false;
      field.drawFrame(1000);
      const before = field.gl.getUniform(field.stars.program, field.stars.uReveal);
      field.replay();
      field.drawFrame(1016);
      return { before, after: field.gl.getUniform(field.stars.program, field.stars.uReveal) };
    });
    assert.ok(earlyReplay.before > 0 && earlyReplay.before < 0.2);
    assert.ok(Math.abs(earlyReplay.after - earlyReplay.before) < 0.001, 'early replay jumps to full brightness');
    process.stdout.write('PASS replay preserves brightness during the opening formation\n');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.frame), 0, 'reduced motion schedules animation frames');
    const stoppedTime = await page.evaluate(() => window.__fieldUnderTest.time);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.time), stoppedTime);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobile = await page.evaluate(() => ({
      width: window.__fieldUnderTest.canvas.width,
      count: window.__fieldUnderTest.count,
      error: window.__fieldUnderTest.gl.getError(),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(mobile.width, 390);
    assert.equal(mobile.count, 6800);
    assert.equal(mobile.error, 0);
    assert.equal(mobile.overflow, false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.count), 12000);
    process.stdout.write('PASS starfield resizes across desktop and mobile while motion is reduced\n');

    await page.evaluate(() => {
      window.__contextTest = window.__fieldUnderTest.gl.getExtension('WEBGL_lose_context');
      if (!window.__contextTest) throw new Error('Context loss test extension is unavailable');
      window.__contextTest.loseContext();
    });
    await page.waitForFunction(() => window.__fieldUnderTest.lost);
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.frame), 0);
    await page.evaluate(() => window.__contextTest.restoreContext());
    await page.waitForFunction(() => !window.__fieldUnderTest.lost && document.querySelector('#apple-starfield').dataset.ready === 'true');
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.gl.getError()), 0);
    process.stdout.write('PASS starfield rebuilds GPU resources after context restoration\n');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenTime = await page.evaluate(() => window.__fieldUnderTest.time);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.time), hiddenTime, 'hidden page clock advanced');
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.frame), 0);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction((before) => window.__fieldUnderTest.time > before, hiddenTime);
    process.stdout.write('PASS starfield pauses and resumes its animation clock on visibility changes\n');

    const disposal = await page.evaluate(() => {
      const previous = window.__fieldUnderTest;
      const gl = previous.gl;
      const program = previous.stars.program;
      const texture = previous.sceneTarget.texture;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      const result = { destroyed: previous.destroyed, frame: previous.frame, program: gl.isProgram(program), texture: gl.isTexture(texture) };
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      result.recreated = previous !== window.__fieldUnderTest;
      return result;
    });
    assert.deepEqual(disposal, { destroyed: true, frame: 0, program: false, texture: false, recreated: true });
    await page.waitForFunction(() => document.querySelector('#apple-starfield').dataset.ready === 'true');
    assert.equal(await page.evaluate(() => window.__fieldUnderTest.gl.getError()), 0);
    assert.deepEqual(errors, []);
    process.stdout.write('PASS page lifecycle disposes resources and recreates the starfield after restoration\n');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });

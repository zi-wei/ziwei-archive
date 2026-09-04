const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'dist');
const artifactDir = process.env.SITE_ARTIFACT_DIR
  ? path.resolve(process.env.SITE_ARTIFACT_DIR)
  : path.join(os.tmpdir(), 'ziwei-archive-artifacts');

const requiredFiles = [
  '.github/workflows/pages.yml',
  'index.html',
  'daily/index.html',
  'about/index.html',
  'assets/css/site.css',
  'assets/js/site.js',
  'assets/js/apple-starfield.js',
  'assets/img/apple-source.jpg',
  'assets/fonts/press-start-2p.woff2',
  'assets/fonts/jetbrains-mono.woff2',
  'tools/build-site.cjs',
  'tools/server.cjs',
  'CNAME',
];

const requiredDistFiles = [
  'index.html',
  'daily/index.html',
  'articles/index.html',
  'articles/first-signal/index.html',
  'about/index.html',
  'assets/js/apple-starfield.js',
  'CNAME',
];

const routes = [
  { name: 'home', path: '/', marker: 'ZiWei ARCHIVE', currentRoute: 'home' },
  { name: 'daily', path: '/daily/', marker: 'DAILY LOG', currentRoute: 'daily' },
  { name: 'articles', path: '/articles/', marker: 'ARTICLE INDEX', currentRoute: 'articles' },
  { name: 'about', path: '/about/', marker: 'ABOUT ARCHIVE', currentRoute: 'about' },
  {
    name: 'article-detail',
    path: '/articles/first-signal/',
    marker: '从一条信号开始',
    currentRoute: 'articles',
  },
];

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];

const failures = [];
let passes = 0;

async function check(name, operation) {
  try {
    await operation();
    passes += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error });
    process.stdout.write(`FAIL ${name}: ${error.message}\n`);
  }
}

function discoverChrome() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  await check('required source files exist', () => {
    const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
    assert.deepEqual(missing, [], `missing: ${missing.join(', ')}`);
  });

  await check('build output contains every public route and apple asset', () => {
    const missing = requiredDistFiles.filter((file) => !fs.existsSync(path.join(distRoot, file)));
    assert.deepEqual(missing, [], `missing from dist: ${missing.join(', ')}`);
  });

  await check('CNAME contains the public hostname', () => {
    assert.equal(fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim(), 'zw.enener.com');
    assert.equal(fs.readFileSync(path.join(distRoot, 'CNAME'), 'utf8').trim(), 'zw.enener.com');
  });

  await check('server CLI serves dist while preserving the reusable factory', () => {
    const serverSource = fs.readFileSync(path.join(root, 'tools/server.cjs'), 'utf8');
    assert.match(serverSource, /createStaticServer\(path\.resolve\(__dirname, '\.\.', 'dist'\)\)/);
    assert.match(serverSource, /module\.exports = \{ createStaticServer \}/);
  });

  if (failures.length > 0) {
    finish();
    return;
  }

  const { createStaticServer } = require(path.join(root, 'tools/server.cjs'));
  const { chromium } = require('playwright-core');
  const server = createStaticServer(distRoot);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const executablePath = discoverChrome();
  assert.ok(executablePath, 'Chrome or Edge is required for browser verification');
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-gpu', '--hide-scrollbars'],
  });

  fs.mkdirSync(artifactDir, { recursive: true });

  try {
    for (const viewport of viewports) {
      for (const route of routes) {
        await check(`${route.name} renders at ${viewport.name}`, async () => {
          const page = await browser.newPage({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
          });
          const runtimeFailures = [];
          page.on('console', (message) => {
            if (message.type() === 'error') runtimeFailures.push(`console: ${message.text()}`);
          });
          page.on('pageerror', (error) => runtimeFailures.push(`pageerror: ${error.message}`));
          page.on('requestfailed', (request) => {
            runtimeFailures.push(`request: ${request.url()} ${request.failure()?.errorText || ''}`);
          });
          page.on('response', (response) => {
            if (response.status() >= 400) runtimeFailures.push(`${response.status()} ${response.url()}`);
          });

          try {
            const response = await page.goto(`${baseUrl}${route.path}`, {
              waitUntil: 'networkidle',
              timeout: 30000,
            });
            assert.equal(response.status(), 200);
            assert.match(await page.locator('body').innerText(), new RegExp(route.marker, 'i'));
            assert.equal(await page.locator('h1').count(), 1);
            assert.equal(
              await page.locator(
                `[data-route="${route.currentRoute}"][aria-current="page"]`,
              ).count(),
              1,
            );
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
              true,
              'horizontal overflow detected',
            );
            assert.equal(
              await page.locator('img').evaluateAll((images) => (
                images.every((image) => image.complete && image.naturalWidth > 0)
              )),
              true,
              'an image did not load',
            );

            if (route.name === 'home') {
              await page.waitForFunction(() => (
                document.querySelector('#apple-starfield')?.dataset.ready === 'true'
              ));
              await page.waitForFunction(() => (
                document.querySelector('#apple-starfield')?.dataset.formation === 'complete'
              ), undefined, { timeout: 7000 });
              const nextBandTop = await page.locator('[data-next-band]').evaluate(
                (element) => element.getBoundingClientRect().top,
              );
              assert.ok(nextBandTop < viewport.height, 'next content band is hidden');

              const visiblePixels = await page.locator('#apple-starfield').evaluate((canvas) => {
                const pixels = canvas.getContext('2d').getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                ).data;
                let count = 0;
                for (let index = 0; index < pixels.length; index += 16) {
                  if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 36) count += 1;
                }
                return count;
              });
              assert.ok(visiblePixels > 200, 'apple starfield canvas is blank');
            }

            if (route.name === 'article-detail') {
              const typography = await page.locator('.article-content').evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                  fontSize: Number.parseFloat(style.fontSize),
                  lineHeight: Number.parseFloat(style.lineHeight),
                };
              });
              assert.ok(
                typography.fontSize >= (viewport.name === 'mobile' ? 15 : 17),
                `article text is too small: ${typography.fontSize}px`,
              );
              assert.ok(
                typography.lineHeight / typography.fontSize >= 1.85,
                'article line height is too tight',
              );
            }

            assert.deepEqual(runtimeFailures, []);
            await page.screenshot({
              path: path.join(artifactDir, `${route.name}-${viewport.name}.png`),
              fullPage: true,
            });
          } finally {
            await page.close();
          }
        });
      }
    }

    await check('clicking the apple replays its formation', async () => {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
      });

      try {
        await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle', timeout: 30000 });
        const canvas = page.locator('#apple-starfield');
        await page.waitForFunction(() => (
          document.querySelector('#apple-starfield')?.dataset.formation === 'complete'
        ), undefined, { timeout: 7000 });

        assert.equal(await canvas.getAttribute('role'), 'button');
        assert.equal(await canvas.getAttribute('tabindex'), '0');
        await canvas.click({ position: { x: 720, y: 450 }, timeout: 1000 });
        assert.notEqual(await canvas.getAttribute('data-formation'), 'complete');
        await page.waitForFunction(() => (
          document.querySelector('#apple-starfield')?.dataset.formation === 'complete'
        ), undefined, { timeout: 7000 });

        await canvas.press('Enter');
        assert.notEqual(await canvas.getAttribute('data-formation'), 'complete');
      } finally {
        await page.close();
      }
    });

    await check('apple animation resumes after reduced motion is disabled', async () => {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
      });

      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForFunction(() => (
          document.querySelector('#apple-starfield')?.dataset.formation === 'complete'
        ));

        const initialSignature = await page.locator('#apple-starfield').evaluate((canvas) => {
          const pixels = canvas.getContext('2d').getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          var signature = 0;
          for (var index = 0; index < pixels.length; index += 64) {
            signature = (signature + pixels[index] + pixels[index + 1] + pixels[index + 2]) >>> 0;
          }
          return signature;
        });

        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction((before) => {
          const canvas = document.querySelector('#apple-starfield');
          const pixels = canvas.getContext('2d').getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          var signature = 0;
          for (var index = 0; index < pixels.length; index += 64) {
            signature = (signature + pixels[index] + pixels[index + 1] + pixels[index + 2]) >>> 0;
          }
          return signature !== before;
        }, initialSignature, { timeout: 1000 });
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  finish();
}

function finish() {
  process.stdout.write(`RESULT ${passes} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

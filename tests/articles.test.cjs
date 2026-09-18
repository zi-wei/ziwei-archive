const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDirectory = path.resolve(__dirname, '..');
const builderPath = path.join(rootDirectory, 'tools', 'build-site.cjs');

function run() {
  assert.equal(fs.existsSync(builderPath), true, 'article builder is missing');

  const { buildSite, parseArticle } = require(builderPath);
  const article = parseArticle(
    [
      '---',
      'title: Test Signal',
      'date: 2026-08-09',
      'summary: A test article.',
      'tags: test, signal',
      '---',
      '',
      '# Body',
      '',
      'A paragraph.',
    ].join('\n'),
    '2026-08-09-test-signal.md',
  );
  assert.equal(article.slug, 'test-signal');
  assert.deepEqual(article.tags, ['test', 'signal']);
  assert.throws(
    () => parseArticle('---\ntitle: Missing date\n---\nBody', 'bad.md'),
    /date/,
  );

  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-articles-'));
  const result = buildSite({ rootDirectory, outputDirectory });
  assert.equal(result.articles.length > 0, true, 'sample article was not discovered');

  const indexPath = path.join(outputDirectory, 'articles', 'index.html');
  const detailPath = path.join(outputDirectory, 'articles', result.articles[0].slug, 'index.html');
  assert.equal(fs.existsSync(indexPath), true, 'article index was not generated');
  assert.equal(fs.existsSync(detailPath), true, 'article detail was not generated');

  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const detailHtml = fs.readFileSync(detailPath, 'utf8');
  assert.match(indexHtml, /data-page="articles"/);
  assert.match(indexHtml, /data-route="articles"/);
  assert.match(indexHtml, /class="article-card/);
  assert.match(indexHtml, /href="\/articles\/first-signal\/"/);
  assert.match(detailHtml, /class="article-content"/);
  assert.match(detailHtml, /<h1/);
  assert.match(detailHtml, /aria-current="page"/);
  assert.doesNotMatch(detailHtml, /<script>/i);
  for (const html of [indexHtml, detailHtml, fs.readFileSync(path.join(outputDirectory, 'daily/index.html'), 'utf8')]) {
    for (const asset of ['site', 'apple-starfield']) {
      const match = html.match(new RegExp(`/assets/js/${asset}\\.[a-f0-9]{16}\\.js`));
      assert.ok(match, `${asset} is missing a content version`);
      assert.ok(fs.existsSync(path.join(outputDirectory, match[0].slice(1))), 'versioned asset is missing');
    }
  }

  process.stdout.write('PASS article metadata and static generation contract\n');
}

try {
  run();
} catch (error) {
  process.stderr.write(`FAIL article metadata and static generation contract: ${error.message}\n`);
  process.exitCode = 1;
}

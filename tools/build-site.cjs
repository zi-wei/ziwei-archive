const fs = require('node:fs');
const path = require('node:path');
const MarkdownIt = require('markdown-it');

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

const PUBLIC_ENTRIES = ['index.html', 'daily', 'about', 'assets', 'CNAME', '.nojekyll'];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseList(value) {
  if (!value.trim()) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseArticle(source, fileName) {
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error(`${fileName}: front matter must start with ---`);
  }

  const closingMarker = normalized.indexOf('\n---\n', 4);
  if (closingMarker < 0) {
    throw new Error(`${fileName}: front matter closing marker is missing`);
  }

  const metadata = {};
  const frontMatter = normalized.slice(4, closingMarker).split('\n');
  for (const line of frontMatter) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) throw new Error(`${fileName}: invalid front matter line: ${line}`);
    metadata[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }

  for (const required of ['title', 'date', 'summary']) {
    if (!metadata[required]) throw new Error(`${fileName}: ${required} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date)) {
    throw new Error(`${fileName}: date must use YYYY-MM-DD`);
  }

  const stem = path.basename(fileName, path.extname(fileName));
  const rawSlug = metadata.slug || stem.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`${fileName}: slug cannot be empty`);

  return {
    title: metadata.title,
    date: metadata.date,
    summary: metadata.summary,
    tags: parseList(metadata.tags || ''),
    slug,
    body: normalized.slice(closingMarker + '\n---\n'.length).trim(),
    source: fileName,
  };
}

function copyEntry(rootDirectory, outputDirectory, entry) {
  const source = path.join(rootDirectory, entry);
  const target = path.join(outputDirectory, entry);
  if (!fs.existsSync(source)) return;
  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    fs.cpSync(source, target, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function renderNav(currentRoute) {
  const current = (route) => (route === currentRoute ? ' aria-current="page"' : '');
  return `<header class="site-header">
      <nav class="site-nav" aria-label="主导航">
        <a class="nav-link" data-route="home" href="/"${current('home')}>首页</a>
        <a class="nav-link" data-route="daily" href="/daily/"${current('daily')}>日常</a>
        <a class="nav-mark" href="/" aria-label="ZiWei Archive 首页">
          <span class="nav-mark-glyph" aria-hidden="true">&#10038;</span>
        </a>
        <a class="nav-link" data-route="articles" href="/articles/"${current('articles')}>文章</a>
        <a class="nav-link" data-route="about" href="/about/"${current('about')}>关于</a>
      </nav>
    </header>`;
}

function renderPage({ title, description, currentRoute, content, mainClass = 'page-main' }) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0b0b0b">
    <meta name="description" content="${escapeHtml(description)}">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="/assets/img/apple-source.jpg" type="image/jpeg">
    <link rel="stylesheet" href="/assets/css/site.css">
  </head>
  <body data-page="${escapeHtml(currentRoute)}">
    ${renderNav(currentRoute)}
    <div class="page-shell">
      <main class="${mainClass}">
        ${content}
      </main>
      <footer class="site-footer">
        <p>DESIGNED FOR ZIWEI <span aria-hidden="true">&#169;</span> <span data-year>2026</span></p>
      </footer>
    </div>
    <script defer src="/assets/js/apple-starfield.js"></script>
    <script defer src="/assets/js/site.js"></script>
  </body>
</html>
`;
}

function renderArticleIndex(articles) {
  const cards = articles.length
    ? articles.map((article) => {
      const tags = article.tags.length
        ? `<div class="article-tags">${article.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
        : '';
      return `<article class="article-card reveal is-visible">
          <div class="article-card-meta">
            <time datetime="${article.date}">${article.date}</time>
            <span>ARTICLE // ${escapeHtml(article.slug.toUpperCase())}</span>
          </div>
          <h2><a href="/articles/${encodeURIComponent(article.slug)}/">${escapeHtml(article.title)}</a></h2>
          <p>${escapeHtml(article.summary)}</p>
          ${tags}
          <a class="article-card-link" href="/articles/${encodeURIComponent(article.slug)}/">READ_ENTRY <span aria-hidden="true">-&gt;</span></a>
        </article>`;
    }).join('\n')
    : '<p class="article-empty">还没有文章, 第一条信号正在等待写入.</p>';

  const content = `<header class="page-heading reveal is-visible">
          <p class="eyebrow">ARTICLE INDEX</p>
          <h1>文章</h1>
          <p>把完整的想法留在这里, 让每一篇文章都成为可以回看的信号.</p>
        </header>
        <section class="article-list" aria-label="文章列表">
          ${cards}
        </section>`;

  return renderPage({
    title: 'Articles | ZiWei ARCHIVE',
    description: 'ZiWei Archive articles.',
    currentRoute: 'articles',
    content,
    mainClass: 'page-main page-main--narrow',
  });
}

function renderArticleDetail(article) {
  const tags = article.tags.length
    ? `<div class="article-tags">${article.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
  const content = `<article class="article-document">
          <header class="article-document-heading">
            <a class="article-back" href="/articles/">&lt;- ARTICLE INDEX</a>
            <p class="eyebrow">ARTICLE // ${escapeHtml(article.slug.toUpperCase())}</p>
            <h1>${escapeHtml(article.title)}</h1>
            <div class="article-document-meta"><time datetime="${article.date}">${article.date}</time>${tags}</div>
            <p class="article-summary">${escapeHtml(article.summary)}</p>
          </header>
          <div class="article-content">${markdown.render(article.body)}</div>
          <footer class="article-document-footer">
            <a class="article-back" href="/articles/">&lt;- BACK TO ARTICLE INDEX</a>
          </footer>
        </article>`;

  return renderPage({
    title: `${article.title} | ZiWei ARCHIVE`,
    description: article.summary,
    currentRoute: 'articles',
    content,
    mainClass: 'page-main page-main--article',
  });
}

function loadArticles(rootDirectory) {
  const articleDirectory = path.join(rootDirectory, 'content', 'articles');
  if (!fs.existsSync(articleDirectory)) return [];
  const files = fs.readdirSync(articleDirectory)
    .filter((fileName) => fileName.endsWith('.md') && !fileName.startsWith('_'))
    .sort();
  const articles = files.map((fileName) => parseArticle(
    fs.readFileSync(path.join(articleDirectory, fileName), 'utf8'),
    fileName,
  ));
  const slugs = new Set();
  for (const article of articles) {
    if (slugs.has(article.slug)) throw new Error(`duplicate article slug: ${article.slug}`);
    slugs.add(article.slug);
  }
  return articles.sort((left, right) => right.date.localeCompare(left.date));
}

function buildSite({ rootDirectory, outputDirectory }) {
  const root = path.resolve(rootDirectory);
  const output = path.resolve(outputDirectory);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const entry of PUBLIC_ENTRIES) copyEntry(root, output, entry);

  const articles = loadArticles(root);
  const articleIndexPath = path.join(output, 'articles', 'index.html');
  fs.mkdirSync(path.dirname(articleIndexPath), { recursive: true });
  fs.writeFileSync(articleIndexPath, renderArticleIndex(articles), 'utf8');
  for (const article of articles) {
    const detailPath = path.join(output, 'articles', article.slug, 'index.html');
    fs.mkdirSync(path.dirname(detailPath), { recursive: true });
    fs.writeFileSync(detailPath, renderArticleDetail(article), 'utf8');
  }

  return { outputDirectory: output, articles };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const outputFlag = args.indexOf('--output');
  const outputDirectory = outputFlag >= 0 ? args[outputFlag + 1] : path.join(__dirname, '..', 'dist');
  if (!outputDirectory) throw new Error('output directory is required');
  const result = buildSite({ rootDirectory: path.join(__dirname, '..'), outputDirectory });
  process.stdout.write(JSON.stringify({
    status: 'built',
    outputDirectory: result.outputDirectory,
    articles: result.articles.map((article) => article.slug),
  }) + '\n');
}

module.exports = { buildSite, parseArticle };

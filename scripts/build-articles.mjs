#!/usr/bin/env node
/**
 * Phasera — 記事ビルドスクリプト（依存ゼロ / Node 18+）
 *
 * content/articles/*.md → cases/<slug>/index.html を生成し、
 * cases/index.html の記事一覧と sitemap.xml をマーカー間で更新する。
 *
 * 使い方:
 *   node scripts/build-articles.mjs        # ビルド
 *   node scripts/build-articles.mjs --check # 生成せず frontmatter 検証のみ
 *
 * frontmatter（--- で囲む / key: value）:
 *   title:       記事タイトル（必須）
 *   description: 一覧・meta 用の説明 120字目安（必須）
 *   date:        YYYY-MM-DD（必須）
 *   tag:         一覧のタグ表示（省略時: 解説）
 *   slug:        URL スラッグ（省略時: ファイル名）
 *   draft:       true にすると公開されない
 *
 * 生成ページには <meta name="generator" content="phasera-articles"> が入り、
 * 次回ビルド時にそのマーカーを持つ cases/<slug>/ は一旦削除→再生成される
 * （記事 md を消せばページも消える）。cases/index.html は対象外。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'content', 'articles');
const CASES = join(ROOT, 'cases');
const SITE = 'https://phasera.jp';
const GEN_MARK = '<meta name="generator" content="phasera-articles">';
const CHECK = process.argv.includes('--check');

/* ---------- tiny markdown (subset: 見出し/段落/リスト/引用/コード/表/画像/リンク) ---------- */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(s) {
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const sections = []; // h2 ごとに <section> で括る（page.css の .prose section 罫線に合わせる）
  let cur = [];
  const flushPara = (buf) => { if (buf.length) { out.push(`<p>${inline(buf.join(' '))}</p>`); buf.length = 0; } };
  const push = (html) => out.push(html);

  let para = [];
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) { // code fence
      flushPara(para);
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(para); push('<hr>'); i++; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara(para);
      const level = Math.max(h[1].length, 2); // h1 は h2 扱い（ページの h1 はタイトル）
      if (level === 2) { // 新しいセクション開始
        if (out.length) { sections.push(out.splice(0).join('\n')); }
        push(`<h2>${inline(h[2])}</h2>`);
      } else {
        push(`<h${level}>${inline(h[2])}</h${level}>`);
      }
      i++; continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara(para);
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara(para);
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^[-*]\s+/, ''));
      push(`<ul class="bullets">${buf.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushPara(para);
      const buf = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\d+\.\s+/, ''));
      push(`<ol>${buf.map((li) => `<li>${inline(li)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^\|/.test(line)) {
      flushPara(para);
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(rows[1] && /^\|[\s:-]+\|/.test(rows[1] + '|') ? 2 : 1);
      push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*$/.test(line)) { flushPara(para); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushPara(para);
  if (out.length) sections.push(out.join('\n'));
  return sections.map((s) => `<section>\n${s}\n</section>`).join('\n');
}

/* ---------- frontmatter ---------- */
function parseArticle(file) {
  const raw = readFileSync(join(SRC, file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: frontmatter（--- で囲むブロック）がありません`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  for (const k of ['title', 'description', 'date']) {
    if (!meta[k]) throw new Error(`${file}: frontmatter に ${k} がありません`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`${file}: date は YYYY-MM-DD 形式で`);
  meta.tag = meta.tag || '解説';
  meta.slug = (meta.slug || basename(file, '.md')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  meta.draft = String(meta.draft).toLowerCase() === 'true';
  return { meta, body: m[2] };
}

/* ---------- build ---------- */
const template = readFileSync(join(ROOT, 'scripts', 'article-template.html'), 'utf8');
const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => f.endsWith('.md') && !f.startsWith('README')) : [];
const articles = [];
for (const f of files) {
  try {
    const a = parseArticle(f);
    if (a.meta.draft) { console.log(`skip (draft): ${f}`);  continue; }
    if (['index'].includes(a.meta.slug)) throw new Error(`${f}: slug "${a.meta.slug}" は使えません`);
    articles.push(a);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}
if (CHECK) { console.log(`check ok: ${articles.length} 記事（draft除く）`); process.exit(process.exitCode || 0); }
articles.sort((a, b) => b.meta.date.localeCompare(a.meta.date));

// 1) 旧生成ページの掃除（generator マーカー持ちのみ削除 — 手書きページは残る）
for (const dir of readdirSync(CASES, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const p = join(CASES, dir.name, 'index.html');
  if (existsSync(p) && readFileSync(p, 'utf8').includes(GEN_MARK)) rmSync(join(CASES, dir.name), { recursive: true });
}

// 2) 記事ページ生成
for (const { meta, body } of articles) {
  const dateHuman = meta.date.replace(/-/g, '.');
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Phasera', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: '実装の考え方', item: `${SITE}/cases/` },
        { '@type': 'ListItem', position: 3, name: meta.title, item: `${SITE}/cases/${meta.slug}/` },
      ]},
      { '@type': 'Article', headline: meta.title, description: meta.description,
        datePublished: meta.date, dateModified: meta.date, inLanguage: 'ja',
        image: `${SITE}/assets/og-cover.png`,
        author: { '@type': 'Person', name: 'Hiromu Hamada', url: `${SITE}/author/hamada/` },
        publisher: { '@type': 'Organization', name: 'Phasera', url: `${SITE}/` },
        mainEntityOfPage: `${SITE}/cases/${meta.slug}/` },
    ],
  }, null, 2);
  let html = template
    .replaceAll('{{TITLE}}', esc(meta.title))
    .replaceAll('{{DESCRIPTION}}', esc(meta.description))
    .replaceAll('{{TAG}}', esc(meta.tag))
    .replaceAll('{{DATE}}', meta.date)
    .replaceAll('{{DATE_HUMAN}}', dateHuman)
    .replaceAll('{{SLUG}}', meta.slug)
    .replaceAll('{{JSON_LD}}', jsonld)
    .replaceAll('{{BODY}}', mdToHtml(body));
  mkdirSync(join(CASES, meta.slug), { recursive: true });
  writeFileSync(join(CASES, meta.slug, 'index.html'), html);
  console.log(`✓ cases/${meta.slug}/index.html`);
}

/* ---------- 3) cases/index.html の一覧をマーカー間で更新 ---------- */
const HUB_START = '<!-- ARTICLES:START -->';
const HUB_END = '<!-- ARTICLES:END -->';
const hubPath = join(CASES, 'index.html');
let hub = readFileSync(hubPath, 'utf8');
if (!hub.includes(HUB_START)) { console.error(`✗ cases/index.html に ${HUB_START} マーカーがありません`); process.exit(1); }
const listHtml = articles.length === 0 ? '' : `
    <section id="articles">
      <h2>解説記事</h2>
      <div class="case-list">
${articles.map(({ meta }) => `        <a href="/cases/${meta.slug}/"><span class="c-tag">${esc(meta.tag)}</span><span class="c-ttl">${esc(meta.title)}<small>${meta.date.replace(/-/g, '.')} — ${esc(meta.description)}</small></span><span class="arr">→</span></a>`).join('\n')}
      </div>
    </section>
`;
hub = hub.slice(0, hub.indexOf(HUB_START) + HUB_START.length) + listHtml + hub.slice(hub.indexOf(HUB_END));
writeFileSync(hubPath, hub);

/* ---------- 4) sitemap.xml をマーカー間で更新 ---------- */
const SM_START = '<!-- ARTICLES:START -->';
const SM_END = '<!-- ARTICLES:END -->';
const smPath = join(ROOT, 'sitemap.xml');
let sm = readFileSync(smPath, 'utf8');
if (!sm.includes(SM_START)) { console.error(`✗ sitemap.xml に ${SM_START} マーカーがありません`); process.exit(1); }
const smEntries = articles.map(({ meta }) => `  <url>
    <loc>${SITE}/cases/${meta.slug}/</loc>
    <lastmod>${meta.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');
sm = sm.slice(0, sm.indexOf(SM_START) + SM_START.length) + (smEntries ? '\n' + smEntries + '\n  ' : '\n  ') + sm.slice(sm.indexOf(SM_END));
writeFileSync(smPath, sm);

console.log(`done: ${articles.length} 記事を公開（hub と sitemap を更新）`);

#!/usr/bin/env node
// Regenerates two auto-maintained regions in README.md:
//   1. CONTRIBUTIONS — a table of merged public PRs to repos the user does not
//      own, grouped by repository (durable: open PRs can close).
//   2. INREVIEW — a one-line list of the user's currently-open external PRs,
//      which drop off automatically as they merge (and reappear in the table).
// No dependencies (Node 18+ fetch).

import { readFileSync, writeFileSync } from 'node:fs';

const USER = process.env.CONTRIB_USER || 'aliabbas-muhammadi';
const README = process.env.README_PATH || 'README.md';
const TOKEN = process.env.GITHUB_TOKEN;

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': USER,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function gh(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const fmtStars = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);

const cell = (s) => String(s).replace(/\|/g, '\\|');

// Fetch every external PR matching `is:<state>` (paginate defensively).
async function fetchExternalPrs(state) {
  const q = encodeURIComponent(`type:pr author:${USER} is:${state} is:public -user:${USER}`);
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const data = await gh(`https://api.github.com/search/issues?q=${q}&per_page=100&page=${page}`);
    items.push(...data.items);
    if (data.items.length < 100) break;
  }
  return items;
}

const repoOf = (it) => it.repository_url.split('/').slice(-2).join('/');
const shortName = (repo) => repo.split('/')[1];

async function buildMergedTable() {
  const items = await fetchExternalPrs('merged');

  // Group by repository; keep the most recently merged PR per repo.
  const byRepo = new Map();
  for (const it of items) {
    const repo = repoOf(it);
    const merged = it.pull_request?.merged_at || it.closed_at || '';
    const entry = byRepo.get(repo) || { repo, count: 0, latest: null };
    entry.count++;
    if (!entry.latest || merged > entry.latest.merged) {
      entry.latest = { number: it.number, title: it.title, url: it.html_url, merged };
    }
    byRepo.set(repo, entry);
  }

  // Attach star counts.
  const rows = [];
  for (const entry of byRepo.values()) {
    let stars = 0;
    try {
      stars = (await gh(`https://api.github.com/repos/${entry.repo}`)).stargazers_count || 0;
    } catch { /* leave at 0 if the repo lookup fails */ }
    rows.push({ ...entry, stars });
  }
  rows.sort((a, b) => b.stars - a.stars || b.latest.merged.localeCompare(a.latest.merged));

  if (rows.length === 0) return '_No merged external pull requests yet._';

  const total = rows.reduce((s, r) => s + r.count, 0);
  return [
    `Merged pull requests across **${rows.length} ${rows.length === 1 ? 'repository' : 'repositories'}** — **${total} ${total === 1 ? 'contribution' : 'contributions'}** and counting.`,
    '',
    '| Repository | Stars | PRs | Latest |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => {
      const name = `[**${cell(shortName(r.repo))}**](https://github.com/${r.repo})`;
      const title = r.latest.title.length > 52 ? r.latest.title.slice(0, 52) + '…' : r.latest.title;
      return `| ${name} | ⭐ ${fmtStars(r.stars)} | ${r.count} | [#${r.latest.number}](${r.latest.url}) — ${cell(title)} |`;
    }),
  ].join('\n');
}

async function buildInReviewLine() {
  const items = await fetchExternalPrs('open');
  if (items.length === 0) return '';
  const chips = items
    .map((it) => ({ repo: repoOf(it), number: it.number, url: it.html_url }))
    .sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number)
    .map((p) => `[${cell(shortName(p.repo))} #${p.number}](${p.url})`);
  return `**In review:** ${chips.join(' · ')}`;
}

function spliceRegion(text, name, content) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s === -1 || e === -1 || e < s) throw new Error(`${name} markers not found in README`);
  return text.slice(0, s + start.length) + '\n' + content + '\n' + text.slice(e);
}

async function main() {
  const [table, inreview] = await Promise.all([buildMergedTable(), buildInReviewLine()]);

  const readme = readFileSync(README, 'utf8');
  let next = spliceRegion(readme, 'CONTRIBUTIONS', table);
  next = spliceRegion(next, 'INREVIEW', inreview);

  if (next !== readme) {
    writeFileSync(README, next);
    console.log('Updated README (contributions + in-review).');
  } else {
    console.log('No change');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

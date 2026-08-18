#!/usr/bin/env node
// Regenerates the merged-PR contributions table in README.md, between the
// <!-- CONTRIBUTIONS:START --> and <!-- CONTRIBUTIONS:END --> markers.
//
// Lists merged, public pull requests to repositories the user does not own,
// grouped by repository. Merged-only by design: the table is durable (open
// PRs can close) and fills itself as PRs land. No dependencies (Node 18+ fetch).

import { readFileSync, writeFileSync } from 'node:fs';

const USER = process.env.CONTRIB_USER || 'aliabbas-muhammadi';
const README = process.env.README_PATH || 'README.md';
const TOKEN = process.env.GITHUB_TOKEN;
const START = '<!-- CONTRIBUTIONS:START -->';
const END = '<!-- CONTRIBUTIONS:END -->';

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

async function main() {
  // Merged, public, external PRs (paginate defensively).
  const q = encodeURIComponent(`type:pr author:${USER} is:merged is:public -user:${USER}`);
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const data = await gh(`https://api.github.com/search/issues?q=${q}&per_page=100&page=${page}`);
    items.push(...data.items);
    if (data.items.length < 100) break;
  }

  // Group by repository; keep the most recently merged PR per repo.
  const byRepo = new Map();
  for (const it of items) {
    const repo = it.repository_url.split('/').slice(-2).join('/');
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

  let table;
  if (rows.length === 0) {
    table = '_No merged external pull requests yet._';
  } else {
    const total = rows.reduce((s, r) => s + r.count, 0);
    table = [
      `Merged pull requests across **${rows.length} ${rows.length === 1 ? 'repository' : 'repositories'}** — **${total} ${total === 1 ? 'contribution' : 'contributions'}** and counting.`,
      '',
      '| Repository | Stars | PRs | Latest |',
      '| --- | --- | --- | --- |',
      ...rows.map((r) => {
        const name = `[**${cell(r.repo.split('/')[1])}**](https://github.com/${r.repo})`;
        const title = r.latest.title.length > 52 ? r.latest.title.slice(0, 52) + '…' : r.latest.title;
        return `| ${name} | ⭐ ${fmtStars(r.stars)} | ${r.count} | [#${r.latest.number}](${r.latest.url}) — ${cell(title)} |`;
      }),
    ].join('\n');
  }

  const readme = readFileSync(README, 'utf8');
  const s = readme.indexOf(START);
  const e = readme.indexOf(END);
  if (s === -1 || e === -1 || e < s) throw new Error('CONTRIBUTIONS markers not found in README');
  const next = readme.slice(0, s + START.length) + '\n' + table + '\n' + readme.slice(e);

  if (next !== readme) {
    writeFileSync(README, next);
    console.log(`Updated: ${rows.length} repos, ${rows.reduce((a, r) => a + r.count, 0)} PRs`);
  } else {
    console.log('No change');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

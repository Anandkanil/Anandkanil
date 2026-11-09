// Generates assets/stats.svg and assets/languages.svg from public GitHub data.
// Runs in GitHub Actions (see .github/workflows/stats.yml); no dependencies.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const USER = process.env.GH_USER || 'Anandkanil';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = new URL('../../assets/', import.meta.url);
const ACCENT = '#a3e635';
// Fold close relatives together so the chart reads as a developer would describe it.
const MERGE = { SCSS: 'CSS', Less: 'CSS', Sass: 'CSS', Hack: 'PHP' };
const COLORS = ['#a3e635', '#22d3ee', '#f59e0b', '#a78bfa', '#f472b6', '#60a5fa'];

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${USER}-profile-stats`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

export async function collect() {
  const user = await gh(`/users/${USER}`);
  const repos = [];
  for (let page = 1; page < 10; page++) {
    const batch = await gh(`/users/${USER}/repos?per_page=100&type=owner&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const own = repos.filter((r) => !r.fork && !r.archived);
  const languages = {};
  for (const repo of own) {
    if (repo.name.toLowerCase() === USER.toLowerCase()) continue;
    const langs = await gh(`/repos/${USER}/${repo.name}/languages`);
    for (const [raw, bytes] of Object.entries(langs)) {
      const name = MERGE[raw] || raw;
      languages[name] = (languages[name] || 0) + bytes;
    }
  }
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const [prs, commits] = await Promise.all([
    gh(`/search/issues?q=${encodeURIComponent(`author:${USER} type:pr is:merged`)}&per_page=1`),
    gh(`/search/commits?q=${encodeURIComponent(`author:${USER} committer-date:>${since}`)}&per_page=1`).catch(() => ({ total_count: null })),
  ]);
  return {
    name: user.name || USER,
    repos: own.length,
    stars: own.reduce((n, r) => n + r.stargazers_count, 0),
    followers: user.followers,
    mergedPrs: prs.total_count,
    commitsYear: commits.total_count,
    languages,
    updated: new Date().toISOString().slice(0, 10),
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = "font-family=\"'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace\"";

function card(width, height, title, body, updated) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="#0b0f14" stroke="#1f2a37"/>
  <circle cx="22" cy="22" r="5" fill="#2b3a4a"/><circle cx="38" cy="22" r="5" fill="#2b3a4a"/><circle cx="54" cy="22" r="5" fill="#2b3a4a"/>
  <text x="72" y="26" ${FONT} font-size="12" fill="#8b98a5">${esc(title)}</text>
  ${body}
  <text x="${width - 16}" y="${height - 12}" ${FONT} font-size="10" fill="#56616d" text-anchor="end">updated ${updated}</text>
</svg>`;
}

export function statsSvg(d) {
  const rows = [
    ['public repos', d.repos],
    ['commits (last 12 mo)', d.commitsYear],
    ['merged PRs', d.mergedPrs],
    ['languages used', Object.keys(d.languages).length],
    ['stars earned', d.stars],
    ['followers', d.followers],
  ].filter(([label, value]) => value != null && (label === 'stars earned' || label === 'followers' ? value >= 5 : true)).slice(0, 5);
  const body = rows
    .map(([label, value], i) => {
      const y = 62 + i * 26;
      return `<text x="24" y="${y}" ${FONT} font-size="14" fill="#c9d3dd"><tspan fill="${ACCENT}">❯</tspan> ${esc(label)}</text>
  <text x="326" y="${y}" ${FONT} font-size="14" font-weight="700" fill="#e6edf3" text-anchor="end">${esc(value)}</text>`;
    })
    .join('\n  ');
  return card(350, 62 + rows.length * 26 + 22, 'github-stats.sh', body, d.updated);
}

export function languagesSvg(d) {
  const entries = Object.entries(d.languages).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, b]) => n + b, 0) || 1;
  const top = entries.slice(0, 6);
  let x = 24;
  const barW = 302;
  const bar = top
    .map(([, bytes], i) => {
      const w = Math.max(2, (bytes / total) * barW);
      const seg = `<rect x="${x.toFixed(1)}" y="46" width="${w.toFixed(1)}" height="8" fill="${COLORS[i]}"/>`;
      x += w;
      return seg;
    })
    .join('');
  const list = top
    .map(([name, bytes], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = 24 + col * 156, ly = 86 + row * 26;
      return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${COLORS[i]}"/>
  <text x="${lx + 16}" y="${ly}" ${FONT} font-size="13" fill="#e6edf3">${esc(name)} <tspan fill="#8b98a5">${((bytes / total) * 100).toFixed(1)}%</tspan></text>`;
    })
    .join('\n  ');
  return card(350, 188, 'top-languages.sh', `<clipPath id="r"><rect x="24" y="46" width="${barW}" height="8" rx="4"/></clipPath>
  <g clip-path="url(#r)"><rect x="24" y="46" width="${barW}" height="8" fill="#1f2a37"/>${bar}</g>
  ${list}`, d.updated);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : await collect();
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL('stats.svg', OUT), statsSvg(data));
  await writeFile(new URL('languages.svg', OUT), languagesSvg(data));
  console.log('Wrote stats for', USER, JSON.stringify({ ...data, languages: Object.keys(data.languages).length }));
}

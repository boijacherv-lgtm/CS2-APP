// After `vite build`: a copy of dist/index.html for every page (dist/cs2/review.html …), so GitHub Pages
// answers each address with the app and a 200 (search engines skip 404s), plus 404.html for anything else (the app
// shows its own not-found page). Also writes the sitemap with every public page.
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../dist');
const SITE = 'https://tsakhstvo.xyz';
// the pages (src/shell/router.ts); /m is a shared moment (its code in the query)
const PAGES = ['cs2', 'cs2/review', 'cs2/tactical', 'cs2/report', 'deadlock', 'deadlock/review', 'deadlock/tactical', 'deadlock/meta', 'deadlock/report',
  'puzzles', 'profile', 'pricing', 'settings', 'privacy', 'changelog', 'dev', 'm'];
const PUBLIC = ['', 'cs2', 'cs2/review', 'cs2/tactical', 'deadlock', 'deadlock/review', 'deadlock/meta', 'puzzles', 'pricing', 'privacy', 'changelog'];

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const p of PAGES) {
  // cs2/review.html, not cs2/review/index.html: GitHub Pages serves /cs2/review from it with a 200 (a folder would
  // 301 to /cs2/review/ first); each page names itself as the canonical address
  fs.mkdirSync(path.dirname(path.join(DIST, p)), { recursive: true });
  let page = html.replace('<link rel="canonical" href="https://tsakhstvo.xyz/" />', `<link rel="canonical" href="${SITE}/${p}" />`);
  // Deadlock's pages get Deadlock's link preview (Discord, X): its own picture and words
  if (p.startsWith('deadlock')) page = page
    .replace('content="https://tsakhstvo.xyz/images/og.png"', 'content="https://tsakhstvo.xyz/images/og-deadlock.png"')
    .replace('content="Was it your fault? Find out free."', 'content="Who lost the fight? Find out free."')
    .replace(/(<meta property="og:description" content=")[^"]*"/, '$1Replay any Deadlock match. Every kill, death and move graded, with the better play."')
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${SITE}/${p}"`);
  // the owner's page: never in search results
  if (p === 'dev') page = page.replace('<head>', '<head><meta name="robots" content="noindex, nofollow" />');
  fs.writeFileSync(path.join(DIST, `${p}.html`), page);
}
// /cs2/ and /deadlock/ (a folder, from cs2/review.html…): the game page, not a 404
for (const p of ['cs2', 'deadlock']) fs.copyFileSync(path.join(DIST, `${p}.html`), path.join(DIST, p, 'index.html'));
fs.writeFileSync(path.join(DIST, '404.html'), html);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC.map(p => `  <url><loc>${SITE}/${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`spa-pages: ${PAGES.length} pages, 404.html, sitemap (${PUBLIC.length} public)`);

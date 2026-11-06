// After `vite build`: a copy of dist/index.html at every page's path (dist/cs2/review/index.html …), so GitHub Pages
// answers each address with the app and a 200 (search engines skip 404s), plus 404.html for anything else (the app
// shows its own not-found page). Also writes the sitemap with every public page.
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../dist');
const SITE = 'https://tsakhstvo.xyz';
// the pages (src/shell/router.ts); /m is a shared moment (its code in the query)
const PAGES = ['cs2/review', 'cs2/tactical', 'cs2/report', 'deadlock', 'deadlock/review', 'deadlock/tactical', 'deadlock/report',
  'puzzles', 'profile', 'pricing', 'settings', 'privacy', 'changelog', 'dev', 'm'];
const PUBLIC = ['', 'cs2/review', 'cs2/tactical', 'deadlock', 'deadlock/review', 'deadlock/tactical', 'puzzles', 'pricing', 'privacy', 'changelog'];

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const p of PAGES) {
  const dir = path.join(DIST, p);
  fs.mkdirSync(dir, { recursive: true });
  // each page names itself as the canonical address
  fs.writeFileSync(path.join(dir, 'index.html'), html.replace('<link rel="canonical" href="https://tsakhstvo.xyz/" />', `<link rel="canonical" href="${SITE}/${p}" />`));
}
fs.writeFileSync(path.join(DIST, '404.html'), html);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC.map(p => `  <url><loc>${SITE}/${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`spa-pages: ${PAGES.length} pages, 404.html, sitemap (${PUBLIC.length} public)`);

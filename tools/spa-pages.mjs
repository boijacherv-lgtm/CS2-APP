// After `vite build`: a copy of dist/index.html for every page (dist/cs2/review.html …), so GitHub Pages
// answers each address with the app and a 200 (search engines skip 404s), plus 404.html for anything else (the app
// shows its own not-found page). Also writes the sitemap with every public page.
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../dist');
const SITE = 'https://tsakhstvo.xyz';
// the pages (src/shell/router.ts); /m is a shared moment (its code in the query)
const PAGES = ['cs2', 'cs2/review', 'cs2/tactical', 'cs2/report', 'deadlock', 'deadlock/review', 'deadlock/tactical', 'deadlock/meta', 'deadlock/report',
  'puzzles', 'profile', 'pricing', 'settings', 'privacy', 'changelog', 'guides', 'dev', 'm'];
const PUBLIC = ['', 'cs2', 'cs2/review', 'cs2/tactical', 'deadlock', 'deadlock/review', 'deadlock/meta', 'puzzles', 'pricing', 'privacy', 'changelog', 'guides'];

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
// the front page's FAQ and the coach's numbers, from the same module the page uses (run with vite-node: it reads TS)
const { FAQ, MATCHES, PRO_MATCHES, DL_MATCHES } = await import('../src/site/faq.ts');
// each public page's own title, description and link preview, and a few lines of text for crawlers and AI bots that
// don't run the app (the page itself replaces the <noscript> text). `h1` and `text` say only what the page says.
const META = {
  '': { title: 'RageView — Free CS2 & Deadlock match review, every play graded', h1: 'Every move you make, graded.',
    desc: 'Drop your CS2 demo or Deadlock match ID. Every play graded S+ to F, with the better play. Free, in your browser, nothing uploaded.',
    text: ['Free match review for Counter-Strike 2 and Deadlock: every play graded, with the play you should have made.', 'CS2 demos are read in your browser; nothing is uploaded. Deadlock matches open by their match ID.'] },
  cs2: { title: 'CS2 demo review: every round graded S+ to F · RageView', h1: 'Every CS2 round, graded.',
    desc: 'Drop a CS2 demo: every round graded S+ to F, every move from Brilliant to Blunder, with the better play. Free, read in your browser.',
    text: ['Drop a .dem demo: every round graded S+ to F and every move from Brilliant to Blunder, with the better play.', 'A coach built on FACEIT level-10 games; the demo is read in your browser.'] },
  deadlock: { title: 'Deadlock match review by match ID: every fight graded · RageView', h1: 'Every Deadlock fight, graded.', ogTitle: 'Every Deadlock fight, graded.',
    desc: 'Replay any Deadlock match by its match ID. Every kill, death and move graded, with the better play. Free.',
    text: ['Paste a Deadlock match ID: replay it on the map, every fight graded, and what top players do instead.', 'Match data from deadlock-api.com; replay files are read in your browser.'] },
  'deadlock/meta': { title: 'Deadlock meta & builds this patch, by position · RageView', h1: 'Deadlock meta and builds',
    desc: 'Every Deadlock hero on this patch by position: tier, win rate, pick rate and builds, plus a draft and a macro planner.',
    text: ['Every hero on this patch by position, with tier, win rate and pick rate.', 'Builds, a draft planner and a macro planner.'] },
  puzzles: { title: 'CS2 & Deadlock puzzles: find the best play · RageView', h1: 'Puzzles',
    desc: 'Find the best play in real moments from top CS2 and Deadlock matches. A daily puzzle, rush, and a rating per game.',
    text: ['Real moments from top players\' matches and your own: find the best play.', 'A daily puzzle, a 3-minute rush, weak spots and a rating per game.'] },
  pricing: { title: 'RageView pricing: free, Pro free in early access', h1: 'Free. Pro is free too, for now.',
    desc: 'RageView is free. Pro adds unlimited history and is free during early access; later $5 a month.',
    text: ['RageView is free.', 'Pro adds unlimited history; it is free during early access, later $5 a month.'] },
  privacy: { title: 'Privacy · RageView', h1: 'Privacy', desc: 'What RageView keeps: demos are read in your browser and never uploaded; logged in, only your numbers are saved.',
    text: ['Demos and replay files are read in your browser and never uploaded.', 'Log in with Steam only gives the site your SteamID, public name and avatar.'] },
  guides: { title: 'Guides: download your CS2 demo, find a Deadlock match ID, ADR and KAST · RageView', h1: 'Guides', desc: 'How to download your CS2 demo, find a Deadlock match ID, what ADR and KAST mean, and where FACEIT level-10 players die on each map.', text: ['Download your CS2 demo, find a Deadlock match ID, ADR and KAST explained, and where FACEIT level-10 players die on each map.'] },
  changelog: { title: 'What\'s new · RageView', h1: 'What\'s new', desc: 'What changed on RageView, newest first.', text: ['What changed on RageView, newest first.'] },
};
const esc = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** The page's own head and crawler text (pages without an entry keep the home ones). */
function withMeta(page, p) {
  const m = META[p];
  if (!m) return page;
  const url = `${SITE}/${p}`, og = m.ogTitle ?? m.title.replace(/ · RageView$/, '');
  return page
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(m.desc)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(og)}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(m.desc)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*"/, `$1${esc(`RageView: ${og}`)}"`)
    .replace('<meta name="twitter:card" content="summary_large_image" />', `<meta name="twitter:card" content="summary_large_image" />\n    <meta name="twitter:title" content="${esc(og)}" />\n    <meta name="twitter:description" content="${esc(m.desc)}" />`)
    .replace('<div id="root"></div>', `<div id="root"><noscript><h1>${esc(m.h1)}</h1>${m.text.map(t => `<p>${esc(t)}</p>`).join('')}</noscript></div>`);
}
for (const p of PAGES) {
  // cs2/review.html, not cs2/review/index.html: GitHub Pages serves /cs2/review from it with a 200 (a folder would
  // 301 to /cs2/review/ first); each page names itself as the canonical address
  fs.mkdirSync(path.dirname(path.join(DIST, p)), { recursive: true });
  let page = html.replace('<link rel="canonical" href="https://tsakhstvo.xyz/" />', `<link rel="canonical" href="${SITE}/${p}" />`);
  // Deadlock's pages get Deadlock's picture in link previews (Discord, X)
  if (p.startsWith('deadlock')) page = page
    .replace('content="https://tsakhstvo.xyz/images/og.png"', 'content="https://tsakhstvo.xyz/images/og-deadlock.png"')
    .replace('content="Every move you make, graded."', 'content="Every Deadlock fight, graded."')
    .replace(/(<meta property="og:description" content=")[^"]*"/, '$1Replay any Deadlock match. Every kill, death and move graded, with the better play."')
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${SITE}/${p}"`);
  // CS2's pages get CS2's picture
  if (p.startsWith('cs2')) page = page.replace('content="https://tsakhstvo.xyz/images/og.png"', 'content="https://tsakhstvo.xyz/images/og-cs2.png"');
  page = withMeta(page, p);
  // the owner's page: never in search results
  if (p === 'dev') page = page.replace('<head>', '<head><meta name="robots" content="noindex, nofollow" />');
  fs.writeFileSync(path.join(DIST, `${p}.html`), page);
}
// the front page itself (with what it is and its FAQ as structured data), and the 404 page from the untouched copy
const ld = [
  { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'RageView', url: `${SITE}/`, applicationCategory: 'GameApplication', operatingSystem: 'Web browser',
    description: META[''].desc,
    offers: [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: 'Pro (free during early access)', price: '5', priceCurrency: 'USD' }] },
  { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
];
const ldTags = ld.map(x => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n    ');
fs.writeFileSync(path.join(DIST, 'index.html'), withMeta(html, '').replace('</head>', `    ${ldTags}\n  </head>`));
// /llms.txt: what the site is, in plain words, for AI assistants (facts from the site only)
fs.writeFileSync(path.join(DIST, 'llms.txt'), `# RageView

> Every move you make, graded. Free match review for Counter-Strike 2 and Deadlock: every move gets a mark (Brilliant to Blunder), every round and match a grade (S+ to F), with the better play the coach found.

- CS2: drop a .dem demo; it is read in your browser, nothing is uploaded. The coach learned from ${MATCHES} FACEIT level-10 matches${PRO_MATCHES ? ` and ${PRO_MATCHES} pro matches` : ''}.
- Deadlock: open any match by its match ID (match data from deadlock-api.com). The coach learned from ${DL_MATCHES.toLocaleString('en-US')} Phantom-and-up matches since the patch.
- Puzzles: real moments from top players' matches and your own; a daily puzzle, a rush and a rating per game.
- Free. Pro adds unlimited history; it is free during early access, later $5 a month.
- Login is optional, through Steam (the site gets your SteamID, public name and avatar only).

## Pages

- [Home](${SITE}/)
- [CS2 review](${SITE}/cs2)
- [Deadlock review](${SITE}/deadlock)
- [Deadlock meta and builds](${SITE}/deadlock/meta)
- [Puzzles](${SITE}/puzzles)
- [Pricing](${SITE}/pricing)
- [Privacy](${SITE}/privacy)

## FAQ

${FAQ.map(f => `- **${f.q}** ${f.a}`).join('\n')}
`);
// /cs2/ and /deadlock/ (a folder, from cs2/review.html…): the game page, not a 404
for (const p of ['cs2', 'deadlock']) fs.copyFileSync(path.join(DIST, `${p}.html`), path.join(DIST, p, 'index.html'));
fs.writeFileSync(path.join(DIST, '404.html'), html.replace('<head>', '<head><meta name="robots" content="noindex" />'));
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC.map(p => `  <url><loc>${SITE}/${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`spa-pages: ${PAGES.length} pages, 404.html, sitemap (${PUBLIC.length} public)`);

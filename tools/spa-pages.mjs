// After `vite build`: a copy of dist/index.html for every page (dist/cs2/review.html …), so GitHub Pages
// answers each address with the app and a 200 (search engines skip 404s), plus 404.html for anything else (the app
// shows its own not-found page). Also writes the sitemap with every public page.
import fs from 'node:fs';
import path from 'node:path';

import { GUIDES as GUIDE_LIST } from '../src/site/guideList.ts';
import { CS2_FAQ, DEADLOCK_FAQ, DOTA2_FAQ } from '../src/site/gameFaq.ts';
const DIST = path.resolve(import.meta.dirname, '../dist');
const SITE = 'https://tsakhstvo.xyz';
// the pages (src/shell/router.ts); /m is a shared moment (its code in the query)
const PAGES = ['cs2', 'cs2/review', 'cs2/tactical', 'cs2/report', 'deadlock', 'deadlock/review', 'deadlock/tactical', 'deadlock/meta', 'deadlock/report', 'dota2', 'dota2/review', 'dota2/meta', 'dota2/tactical', 'dota2/report',
  'puzzles', 'profile', 'pricing', 'settings', 'privacy', 'changelog', 'guides', ...GUIDE_LIST.map(g => `guides/${g.slug}`), 'dev', 'm'];
const PUBLIC = ['', 'cs2', 'cs2/review', 'cs2/tactical', 'deadlock', 'deadlock/review', 'deadlock/meta', 'dota2', 'dota2/review', 'dota2/meta', 'puzzles', 'pricing', 'privacy', 'changelog', 'guides', ...GUIDE_LIST.map(g => `guides/${g.slug}`)];

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
// the front page's FAQ and the coach's numbers, from the same module the page uses (run with vite-node: it reads TS)
const { FAQ, MATCHES, PRO_MATCHES, DL_MATCHES } = await import('../src/site/faq.ts');
// each public page's own title, description and link preview, and a few lines of text for crawlers and AI bots that
// don't run the app (the page itself replaces the <noscript> text). `h1` and `text` say only what the page says.
const META = {
  '': { title: 'RageView — Free CS2, Deadlock & Dota 2 match review, every play graded', h1: 'Every move you make, graded.',
    desc: 'Drop your CS2 demo, or open a Deadlock or Dota 2 match by its ID. Every play graded S+ to F, with the better play. Free, in your browser, nothing uploaded.',
    text: ['Free match review for Counter-Strike 2, Deadlock and Dota 2: every play graded, with the play you should have made.', 'CS2 demos are read in your browser; nothing is uploaded. Deadlock and Dota 2 matches open by their match ID.'] },
  cs2: { title: 'CS2 demo review: every round graded S+ to F · RageView', h1: 'Every CS2 round, graded.',
    desc: 'Drop a CS2 demo: every round graded S+ to F, every move from Brilliant to Blunder, with the better play. Free, read in your browser.',
    text: ['Drop a .dem demo: every round graded S+ to F and every move from Brilliant to Blunder, with the better play.', 'A coach built on FACEIT level-10 games; the demo is read in your browser.'] },
  deadlock: { title: 'Deadlock match review by match ID: every fight graded · RageView', h1: 'Every Deadlock fight, graded.', ogTitle: 'Every Deadlock fight, graded.',
    desc: 'Replay any Deadlock match by its match ID. Every kill, death and move graded, with the better play. Free.',
    text: ['Paste a Deadlock match ID: replay it on the map, every fight graded, and what top players do instead.', 'Match data from deadlock-api.com; replay files are read in your browser.'] },
  dota2: { title: 'Dota 2 match review by match ID: every fight graded · RageView', h1: 'Every Dota 2 fight, graded.', ogTitle: 'Every Dota 2 fight, graded.',
    desc: 'Replay any Dota 2 match by its match ID. Every fight, pick-off and lane graded S+ to F, with the better play. Free.',
    text: ['Paste a Dota 2 match ID: replay it on the map, every fight graded, and what top players do instead.', 'Match data from OpenDota; the replay file is read in your browser.'] },
  'dota2/review': { title: 'Dota 2 match review: open a match by ID · RageView', h1: 'Review a Dota 2 match', desc: 'Open a Dota 2 match by its ID or pick a recent pro match, then replay it with the coach.', text: ['Open a match by its ID, or pick one of the latest pro matches.'] },
  'dota2/meta': { title: 'Dota 2 meta & builds this patch, by position · RageView', h1: 'Dota 2 meta and builds', desc: 'Every Dota 2 hero on this patch by position: win rate, pick rate, builds and the patch notes.', text: ['Every hero on this patch by position, with win rate and pick rate, builds and the patch notes.'] },
  settings: { title: 'Settings · RageView', h1: 'Settings', desc: 'Your RageView settings: games, notifications and account.', text: ['Your RageView settings.'] },
  profile: { title: 'Your profile · RageView', h1: 'Profile', desc: 'Your graded matches, habits and goals across the games RageView reviews.', text: ['Your graded matches, habits and goals.'] },
  'cs2/review': { title: 'Review a CS2 demo: replay every round with the coach · RageView', h1: 'Review a CS2 demo', desc: 'Drop a .dem file, pick a match from your Steam history or open the sample, then replay every round with the coach. Free, read in your browser.', text: ['Drop a CS2 demo to replay each round on the radar with every move graded.', 'Nothing is uploaded; the demo is read in your browser.'] },
  'cs2/tactical': { title: 'CS2 Tactical Board: plan a round and play it out · RageView', h1: 'CS2 Tactical Board', desc: 'Place players, utility and routes on the radar, then play the round out against the coach\'s prediction. Free, in your browser.', text: ['Place players, grenades and routes on a CS2 map and watch the round play out.', 'The coach predicts the T plays and scores your setup.'] },
  'deadlock/review': { title: 'Review a Deadlock match: open it by match ID · RageView', h1: 'Review a Deadlock match', desc: 'Paste a Deadlock match ID or pick a recent one, then replay it on the map with every fight graded. Free.', text: ['Paste a match ID to replay a Deadlock match with the coach.', 'Match data from deadlock-api.com.'] },
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
for (const g of GUIDE_LIST) META[`guides/${g.slug}`] = { title: g.title, h1: g.h1, desc: g.desc, text: [g.desc, ...g.body, 'A RageView guide: free, nothing uploaded.'] };
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
  // Dota 2, Puzzles and Pricing have their own pictures too
  if (p.startsWith('dota2')) page = page.replace('content="https://tsakhstvo.xyz/images/og.png"', 'content="https://tsakhstvo.xyz/images/og-dota2.png"');
  if (p === 'puzzles') page = page.replace('content="https://tsakhstvo.xyz/images/og.png"', 'content="https://tsakhstvo.xyz/images/og-puzzles.png"');
  if (p === 'pricing') page = page.replace('content="https://tsakhstvo.xyz/images/og.png"', 'content="https://tsakhstvo.xyz/images/og-pricing.png"');
  // CS2's pages get CS2's picture
  if (p.startsWith('dota2')) page = page.replace('content="Every move you make, graded."', 'content="Every Dota 2 fight, graded."');
  if (p.startsWith('cs2')) page = page.replace('content="https://tsakhstvo.xyz/images/og.png"', 'content="https://tsakhstvo.xyz/images/og-cs2.png"');
  page = withMeta(page, p);
  // the game pages' own questions as FAQPage data, and in the static text (crawlers that don't run the app)
  const gf = p === 'cs2' ? CS2_FAQ : p === 'deadlock' ? DEADLOCK_FAQ : p === 'dota2' ? DOTA2_FAQ : null;
  if (p === 'pricing' || p === 'puzzles') page = page.replace('</noscript></div>', `${FAQ.slice(0, 4).map(f => `<h2>${esc(f.q)}</h2><p>${esc(f.a)}</p>`).join('')}</noscript></div>`);
  // Puzzles and Pricing: the front page's first questions as structured data too (Pricing also says what it costs)
  if (p === 'pricing' || p === 'puzzles') {
    const ld = [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.slice(0, 4).map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      ...(p === 'pricing' ? [{ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'RageView', url: `${SITE}/`, applicationCategory: 'GameApplication', operatingSystem: 'Web browser',
        offers: [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: 'Pro (free during early access)', price: '5', priceCurrency: 'USD' }] }] : [])];
    page = page.replace('</head>', `${ld.map(x => `    <script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>\n`).join('')}  </head>`);
  }
  if (gf) page = page.replace('</head>', `    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: gf.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }).replace(/</g, '\\u003c')}</script>\n  </head>`)
    .replace('</noscript></div>', `${gf.map(f => `<h2>${esc(f.q)}</h2><p>${esc(f.a)}</p>`).join('')}</noscript></div>`);
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

> Every move you make, graded. Free match review for Counter-Strike 2, Deadlock and Dota 2: every move gets a mark (Brilliant to Blunder), every round and match a grade (S+ to F), with the better play the coach found.

- CS2: drop a .dem demo; it is read in your browser, nothing is uploaded. The coach learned from ${MATCHES} FACEIT level-10 matches${PRO_MATCHES ? ` and ${PRO_MATCHES} pro matches` : ''}.
- Deadlock: open any match by its match ID (match data from deadlock-api.com). The coach learned from ${DL_MATCHES.toLocaleString('en-US')} Phantom-and-up matches since the patch.
- Dota 2: open any match by its match ID (match data from OpenDota; the replay is read in your browser from Valve's servers). The coach grades fights, lanes, vision and team play; Meta & builds shows the heroes of the current patch by position.
- Puzzles: real moments from top players' matches and your own; a daily puzzle, a rush and a rating per game.
- Free. Pro adds unlimited history; it is free during early access, later $5 a month.
- Login is optional, through Steam (the site gets your SteamID, public name and avatar only).

## Pages

- [Home](${SITE}/)
- [CS2 review](${SITE}/cs2)
- [Deadlock review](${SITE}/deadlock)
- [Deadlock meta and builds](${SITE}/deadlock/meta)
- [Dota 2 review](${SITE}/dota2)
- [Dota 2 meta and builds](${SITE}/dota2/meta)
- [Puzzles](${SITE}/puzzles)
- [Pricing](${SITE}/pricing)
- [Privacy](${SITE}/privacy)

## FAQ

${FAQ.map(f => `- **${f.q}** ${f.a}`).join('\n')}
`);
// /cs2/ and /deadlock/ (a folder, from cs2/review.html…): the game page, not a 404
for (const p of ['cs2', 'deadlock', 'dota2']) fs.copyFileSync(path.join(DIST, `${p}.html`), path.join(DIST, p, 'index.html'));
fs.writeFileSync(path.join(DIST, '404.html'), html.replace('<head>', '<head><meta name="robots" content="noindex" />'));
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC.map(p => `  <url><loc>${SITE}/${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`spa-pages: ${PAGES.length} pages, 404.html, sitemap (${PUBLIC.length} public)`);

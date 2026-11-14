/** The guides, each on its own address (/guides/<slug>): used by the Guides page and by the static pages (tools/spa-pages.mjs). */
export interface GuideInfo { slug: string; id: string; title: string; h1: string; desc: string }
export const GUIDES: GuideInfo[] = [
  { slug: 'download-cs2-demo', id: 'cs2-demo', title: 'How to download your CS2 demo · RageView guides', h1: 'Download your CS2 demo',
    desc: 'Where to find your CS2 match in Watch → Your Matches, download its demo, and drop it into RageView. FACEIT and HLTV demos work too.' },
  { slug: 'deadlock-match-id', id: 'deadlock-id', title: 'How to find your Deadlock match ID · RageView guides', h1: 'Find a Deadlock match ID',
    desc: 'Open your Deadlock match history, copy the match ID and paste it into RageView, or log in with Steam and see your matches listed.' },
  { slug: 'adr-and-kast', id: 'numbers', title: 'ADR, KAST and impact explained · RageView guides', h1: 'ADR and KAST, explained',
    desc: 'What ADR, KAST, impact, grades and marks mean in CS2 and in RageView, and what a good number is at FACEIT level 10.' },
  { slug: 'where-players-die', id: 'deaths', title: 'Where FACEIT level-10 players die in CS2 · RageView guides', h1: 'Where FACEIT level-10 players die',
    desc: 'The places on each CS2 map where FACEIT level-10 players die most, in the first 40 seconds of a round and after, counted from real matches.' },
];

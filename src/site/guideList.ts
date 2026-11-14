/** The guides, each on its own address (/guides/<slug>): used by the Guides page and by the static pages (tools/spa-pages.mjs). */
export interface GuideInfo { slug: string; id: string; title: string; h1: string; desc: string; /** the guide's steps, for the static page (crawlers that don't run the app) */ body: string[] }
export const GUIDES: GuideInfo[] = [
  { slug: 'download-cs2-demo', id: 'cs2-demo', title: 'How to download your CS2 demo · RageView guides', h1: 'Download your CS2 demo',
    desc: 'Where to find your CS2 match in Watch → Your Matches, download its demo, and drop it into RageView. FACEIT and HLTV demos work too.',
    body: ["In CS2, open Watch, then Your Matches.", "Pick the match and press Download. CS2 keeps it in its replays folder.", "On RageView, open Review and drop the .dem file in, or pick your Steam folder once and new matches show up by themselves.", "FACEIT and HLTV demos work too: unzip them first. Valve keeps demos for about a month."] },
  { slug: 'deadlock-match-id', id: 'deadlock-id', title: 'How to find your Deadlock match ID · RageView guides', h1: 'Find a Deadlock match ID',
    desc: 'Open your Deadlock match history, copy the match ID and paste it into RageView, or log in with Steam and see your matches listed.',
    body: ["In Deadlock, open your Match history and pick the match: the ID is shown with it (a number like 52190833).", "On RageView, open Deadlock, then Review, and paste it.", "Logged in with Steam, your matches are listed there already; add the RageView bot as a Steam friend and new ones load by themselves.", "Match data comes from deadlock-api.com; a match shows up there a few minutes to an hour after it ends."] },
  { slug: 'adr-and-kast', id: 'numbers', title: 'ADR, KAST and impact explained · RageView guides', h1: 'ADR and KAST, explained',
    desc: 'What ADR, KAST, impact, grades and marks mean in CS2 and in RageView, and what a good number is at FACEIT level 10.',
    body: ["ADR is average damage per round. 80 is solid at FACEIT level 10; 100 and up means you carried fights.", "KAST is the share of rounds where you got a kill, an assist, survived or were traded. Around 70% is typical at level 10.", "Impact is how much your moves changed your team's chance to win the round, on average.", "A grade is S+ to F for a round or a match, against FACEIT level 10. A mark is one move, from Brilliant to Blunder."] },
  { slug: 'where-players-die', id: 'deaths', title: 'Where FACEIT level-10 players die in CS2 · RageView guides', h1: 'Where FACEIT level-10 players die',
    desc: 'The places on each CS2 map where FACEIT level-10 players die most, in the first 40 seconds of a round and after, counted from real matches.',
    body: ["Counted from real FACEIT level-10 matches: the share of each side's deaths on each map in the first 40 seconds of a round, and after.", "Pick a map on the page to see the top places for CT and T."] },
];

/** The game pages' questions: one source for the page and for its FAQPage data (tools/spa-pages.mjs). */
export const CS2_FAQ = [
  { q: 'Where do demos come from?', a: 'CS2 → Watch → Your Matches → Download, or your Steam folder (the site finds them). FACEIT and HLTV demos work too, unzipped.' },
  { q: 'Is my demo uploaded?', a: 'No. It\'s read in your browser. Logged in, only your match\'s numbers are saved to your profile.' },
  { q: 'Is it free?', a: 'Yes. Pro adds unlimited history and is free during early access.' },
] as { q: string; a: string }[];
export const DEADLOCK_FAQ = [
  { q: 'Where do matches come from?', a: 'deadlock-api.com, a free community service with Deadlock match data. A match shows up there a few minutes to an hour after it ends.' },
  { q: 'Is it free?', a: 'Yes, same as CS2. Pro adds unlimited history and is free during early access.' },
  { q: 'Which matches?', a: 'Any public match: log in with Steam for yours, or paste a match ID (in game: Match history).' },
] as { q: string; a: string }[];
export const DOTA2_FAQ = [
  { q: 'Where do matches come from?', a: 'opendota.com, a free community service with Dota 2 match data. Where heroes walked comes from the match\'s replay, read right in your browser.' },
  { q: 'What does "not parsed" mean?', a: 'OpenDota has only the final scoreboard until it has read the replay. Ask for it on the match: it takes a few minutes, while Valve still keeps the replay (about two weeks).' },
  { q: 'Why can\'t I see my matches?', a: 'Log in with Steam, and turn on Expose Public Match Data in Dota 2\'s settings. A match ID works either way.' },
  { q: 'Is it up to date with the patch?', a: 'Yes: heroes, items, skills, talents and the map are read from the game\'s own data, so a new patch shows the day it comes out.' },
] as { q: string; a: string }[];

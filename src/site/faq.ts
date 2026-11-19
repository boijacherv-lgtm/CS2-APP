// The front page's questions and answers, and the facts behind them: one copy for the page (Home.tsx) and for the
// static files the build writes (tools/spa-pages.mjs: the FAQ as JSON-LD, /llms.txt), so they can't drift apart.
import { COACH_MODEL, PRO_MODEL } from '../engine/coachModels';
import { matches as DL_MATCHES } from '../deadlock/generated/winmodel.json';
import { PLAYABLE, SOON_GAMES } from './games';

export const MATCHES = COACH_MODEL.source?.demos ?? COACH_MODEL.trainedOn;
export const PRO_MATCHES = PRO_MODEL?.source?.demos ?? 0;
export { DL_MATCHES };
const names = (gs: { name: string }[]) => gs.map(g => g.name).join(' and ');

export const FAQ: { q: string; a: string }[] = [
  { q: 'What games work?', a: `${names(PLAYABLE)} now. Next: ${SOON_GAMES.slice(0, 3).map(g => g.name).join(', ')}, then more.` },
  { q: 'Is it free?', a: 'Yes. Pro adds unlimited history and is free during early access. No card needed.' },
  { q: 'Do you upload my files?', a: 'No. Demos and replay files are read in your browser. A Deadlock match ID is looked up in deadlock-api\'s public match data. Logged in, only your numbers are saved, never the replay.' },
  { q: 'Do I need an account?', a: 'No. Log in with Steam only to sync your profile between devices.' },
  { q: 'What do I bring?', a: PLAYABLE.map(g => `${g.name}: ${g.source}`).join('. ') + '.' },
  { q: 'How smart is the coach?', a: `In CS2 it learned from ${MATCHES} FACEIT level-10 matches${PRO_MATCHES ? ` and ${PRO_MATCHES} pro ones` : ''}; in Deadlock from ${DL_MATCHES.toLocaleString()} Phantom-and-up matches since the patch. It can't hear your team's calls, and says so.` },
];

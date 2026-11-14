/**
 * CS2's page: the game kit's game page (GamePage) filled in for CS2. Reached at /cs2 (Review, Recap and Meta — the
 * Tactical board — are /cs2/review, /cs2/report and /cs2/tactical).
 */
import { MIRAGE_STRATS } from '../engine/strategies';
import { openCs2Sample } from '../ui/sample';
import { GamePage, type GamePageKit } from './GamePage';

const KIT: GamePageKit = {
  game: 'cs2',
  h1: 'Every CS2 round, graded.',
  lead: 'Drop a demo. Watch it on the radar while the coach marks every move against level-10 players.',
  review: '/cs2/review', reviewLabel: 'Review a CS2 match', sample: openCs2Sample,
  shot: { src: '/images/shots/cs2-recap.jpg', alt: 'A CS2 match recap on Mirage: the score, the player\'s grades against the lobby and level 10, and their key numbers' },
  grades: [
    { icon: 'crosshair', title: 'Aim duels', text: 'Duels you should have won, and the ones you stole.' },
    { icon: 'friends', title: 'Trades', text: 'Who traded, and who died alone.' },
    { icon: 'bomb', title: 'Utility', text: 'Flashes that worked, grenades that didn\'t.' },
    { icon: 'map', title: 'Positioning', text: 'Where you stood vs where level-10 players stand.' },
  ],
  moment: { src: '/images/shots/cs2-moment.jpg', alt: 'A graded moment from the CS2 sample match on Mirage', caption: 'From the sample: a FACEIT level-10 Mirage match, names replaced.' },
  meta: {
    title: 'Plan a round', href: '/cs2/tactical', cta: 'Tactical board',
    // the board's Mirage plays (the engine's starting plans, not a popularity count)
    load: async () => MIRAGE_STRATS.slice(0, 3).map(s => ({ title: s.label, sub: `Counter: ${s.counter}` })),
  },
  steps: [
    { title: 'Get a demo', text: 'CS2 → Watch → Your Matches → download. FACEIT and HLTV demos work too.' },
    { title: 'Drop it in', text: 'It\'s read in your browser; nothing is uploaded.' },
    { title: 'Fix one thing', text: 'The coach picks it. You track it.' },
  ],
  faq: [
    { q: 'Where do demos come from?', a: 'CS2 → Watch → Your Matches → Download, or your Steam folder (the site finds them). FACEIT and HLTV demos work too, unzipped.' },
    { q: 'Is my demo uploaded?', a: 'No. It\'s read in your browser. Logged in, only your match\'s numbers are saved to your profile.' },
    { q: 'Is it free?', a: 'Yes. Pro adds unlimited history and is free during early access.' },
  ],
  footer: 'Not affiliated with Valve. Counter-Strike 2 and its logo belong to Valve.',
};

export function Cs2Home() { return <GamePage kit={KIT} />; }

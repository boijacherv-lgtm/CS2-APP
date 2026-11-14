/**
 * Deadlock's page: the game kit's game page (GamePage) filled in for Deadlock. Reached at /deadlock (Review, Recap and
 * Meta — Meta & builds — are /deadlock/review, /deadlock/report and /deadlock/meta).
 */
import { DEADLOCK_FAQ } from './gameFaq';
import { heroArt, heroOf } from '../deadlock/data';
import { openDlSample } from '../ui/sample';
import { GamePage, type GamePageKit } from './GamePage';

const KIT: GamePageKit = {
  game: 'deadlock',
  h1: 'Every Deadlock fight, graded.',
  lead: 'Paste a match ID. Watch it on the map while the coach marks every fight, death and lane.',
  review: '/deadlock/review', reviewLabel: 'Review a Deadlock match', sample: openDlSample,
  shot: { src: '/images/shots/replay.jpg', alt: 'A Deadlock replay: both teams on the map and a graded death explained' },
  grades: [
    { icon: 'swords', title: 'Kills', text: 'What each kill was worth.' },
    { icon: 'map', title: 'Map activity', text: 'Camps, Urn, bosses, objectives.' },
    { icon: 'bolt', title: 'Abilities', text: 'Damage by ability, ult usage.' },
    { icon: 'route', title: 'Rotations', text: 'Ganks that paid off, and ones that didn\'t.' },
    { icon: 'shield', title: 'Survival', text: 'Deaths you could have avoided.' },
    { icon: 'trendUp', title: 'Laning', text: 'Souls and last hits vs your role.' },
  ],
  moment: { src: '/images/shots/coach.jpg', alt: 'The Deadlock sample\'s costliest moves and best calls, each explained', caption: 'From the sample: a public Phantom+ match, names hidden.' },
  meta: {
    title: 'Top heroes this patch', href: '/deadlock/meta', cta: 'Meta & builds',
    // the meta table's numbers (deadlock-api, every rank, since the patch): the 3 best win rates with enough games
    load: async () => {
      const { heroMeta, RANKS } = await import('../deadlock/meta');
      const m = await heroMeta(RANKS[0]);
      const top = m.rows.filter(r => r.matches >= 500).sort((a, b) => b.winRate - a.winRate).slice(0, 3);
      return top.map(r => ({ title: heroOf(r.hero).name, sub: `${(r.winRate * 100).toFixed(1)}% won · tier ${r.tier}`, img: heroArt(r.hero) }));
    },
  },
  steps: [
    { title: 'Pick a match', text: 'Yours after logging in with Steam, or any by its match ID.' },
    { title: 'Replay it', text: 'Every hero on the map, every play graded against your hero and position.' },
    { title: 'Fix one thing', text: 'The coach picks it. You track it.' },
  ],
  faq: DEADLOCK_FAQ,

  footer: 'Not affiliated with Valve. Deadlock and its logo belong to Valve.',
};

export function Deadlock() { return <GamePage kit={KIT} />; }

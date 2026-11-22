/**
 * Dota 2's page: the game kit's game page (GamePage) filled in for Dota 2, like Deadlock's. Reached at /dota2 (Review,
 * Recap and Meta — Meta & builds — are /dota2/review, /dota2/report and /dota2/meta).
 */
import { DOTA2_FAQ } from './gameFaq';
import { openD2Sample } from '../ui/sample';
import { GamePage, type GamePageKit } from './GamePage';

const KIT: GamePageKit = {
  game: 'dota2',
  h1: 'Every Dota 2 fight, graded.',
  lead: 'Paste a match ID. Watch every hero and creep on the map while the coach grades each kill, death, lane and ward.',
  review: '/dota2/review', reviewLabel: 'Review a Dota 2 match', sample: openD2Sample,
  shot: { src: '/images/shots/d2-replay.jpg', alt: 'A Dota 2 replay: both teams with their items and talents, the map, and a kill graded Great' },
  // the parts of a match the recap's grades are made of (dota2/grades.ts), with the letter's numbers as Deadlock shows them
  grades: [
    { icon: 'swords', title: 'Fights', text: 'Kills, deaths and damage in each fight, against your share.', score: [74, '2nd of 10'] },
    { icon: 'trendUp', title: 'Laning', text: 'Last hits and gold at 10:00 against your lane opponent.', score: [61, '4th of 10'] },
    { icon: 'map', title: 'Vision', text: 'Wards placed, how long they lived, on the spots pros use.', score: [68, '3rd of 10'] },
    { icon: 'friends', title: 'Team play', text: 'Stuns, saves, items used on allies, ganks on other lanes.', score: [57, '5th of 10'] },
    { icon: 'shield', title: 'Survival', text: 'Deaths you could have avoided, and what they cost.', score: [45, '7th of 10'] },
    { icon: 'grid', title: 'Draft', text: 'Picks that went with your team and against theirs.', score: [63, '3rd of 10'] },
  ],
  moment: { src: '/images/shots/d2-moment.jpg', alt: 'One graded Dota 2 moment: a death marked Mistake with the reasons, on the map at that moment', caption: 'From the sample: a pro match on patch 7.42.' },
  meta: {
    title: 'Top heroes this patch', href: '/dota2/meta', cta: 'Meta & builds',
    // the meta table's numbers (OpenDota, every rank, the last 7 days): the 3 best win rates with plenty of games
    load: async () => {
      const [{ heroMeta, heroStats, RANKS }, { heroOf }] = await Promise.all([import('../dota2/meta'), import('../dota2/data')]);
      const rows = heroMeta(await heroStats(), RANKS[0], null);
      return rows.filter(r => r.games >= 20_000).sort((a, b) => b.winRate - a.winRate).slice(0, 3)
        .map(r => ({ title: heroOf(r.hero).name, sub: `${(r.winRate * 100).toFixed(1)}% won · tier ${r.tier}`, img: heroOf(r.hero).icon }));
    },
  },
  steps: [
    { title: 'Pick a match', text: 'Yours after logging in with Steam, or any by its match ID.' },
    { title: 'Replay it', text: 'Every hero and creep on the map, every play graded against your hero and position.' },
    { title: 'Plan the next one', text: 'The meta of this patch, builds, and a draft that picks by role against theirs.' },
  ],
  faq: DOTA2_FAQ,

  footer: 'Not affiliated with Valve. Dota 2 and its logo belong to Valve.',
};

export function Dota2() { return <GamePage kit={KIT} />; }

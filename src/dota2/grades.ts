/**
 * Letter grades for a Dota 2 match, as CS2's are per round (S+ … F). Dota has no rounds, so its "rounds" are what actually
 * happened: the lane, each teamfight and each pick-off outside them, and for supports their vision and team play over the
 * match (support.ts). Only what the match's data shows counts. Positioning and who an item saved aren't in it.
 */
import { LETTERS, type Letter } from '../engine/recap';
import type { D2Move } from './coach';
import { MAP_UNITS, mins, type D2Team } from './data';
import type { D2Fight, D2Match } from './match';
import type { ReplayTracks } from './replay/parser';
import { supportNumbers, supportsOf, teamPlayLetter, visionLetter, type SupportNumbers } from './support';
import { heroAt } from './tracks';

export type ChapterKind = 'vision' | 'team' | 'lane' | 'fight' | 'pick';
export interface Grade { letter: Letter; why: string }
export interface Chapter { t: number; kind: ChapterKind; title: string; /** The side that came out ahead. */ winner: D2Team | null; /** By slot; null: wasn't part of it. */ grades: (Grade | null)[] }
export interface PlayerGrades { slot: number; letter: Letter; counts: Record<Letter, number>; graded: number; /** The average of their letters (F 0 … S+ 7). */ average: number; /** That, with the game as a whole: what the match grade comes from. */ score: number }
export interface MatchGrades { chapters: Chapter[]; players: PlayerGrades[]; best: number | null }

/** What each letter means, for the legend. */
export const GRADE_LEGEND: [Letter, string][] = [
  ['S+', 'took over a fight: 4+ kills, or 3 without dying and winning it'], ['S', '3 kills, or 2 without dying in a won fight, or carried the damage'],
  ['A', 'a double kill, a clean kill in a won fight, or a big share of the damage'], ['B', 'did the job: a kill or a fair share of damage or healing'],
  ['C', 'no real impact either way'], ['D', 'died without getting much done'], ['F', 'fed: died in a lost fight having done almost nothing'],
];
const LETTER_WORTH: Record<Letter, number> = { 'S+': 7, S: 6, A: 5, B: 4, C: 3, D: 2, F: 0 };
/** Deaths this close together outside a teamfight are one pick-off. */
const PICK_GAP = 15;

const STEP_UP: Record<Letter, Letter> = { 'S+': 'S+', S: 'S+', A: 'S', B: 'A', C: 'B', D: 'C', F: 'D' };
/**
 * How one player did in a teamfight: `share` is their part of their team's damage and healing in it, `help` how many skills
 * they cast on teammates and items meant for others they used: a step up, as a save doesn't show in kills or damage.
 */
export function fightLetter(kills: number, deaths: number, share: number, won: boolean, help = 0): Letter {
  const base = fightBase(kills, deaths, share, won);
  return help >= HELP_FOR_STEP ? STEP_UP[base] : base;
}
const HELP_FOR_STEP = 2;
function fightBase(kills: number, deaths: number, share: number, won: boolean): Letter {
  const clean = deaths === 0;
  if (kills >= 4 || (kills >= 3 && clean && won)) return 'S+';
  if (kills >= 3 || (kills >= 2 && clean && won) || (share >= 0.45 && clean && won)) return 'S';
  if (kills >= 2 || (kills >= 1 && clean && won) || (share >= 0.3 && won)) return 'A';
  if (kills >= 1 || share >= 0.2 || (clean && won)) return 'B';
  if (clean) return 'C';
  return share < 0.05 && !won ? 'F' : 'D';
}
/** How a lane went, by net worth at its end against the opposite number. */
export function laneLetter(gold: number): Letter {
  return gold >= 1500 ? 'S+' : gold >= 1000 ? 'S' : gold >= 500 ? 'A' : gold >= -200 ? 'B' : gold >= -500 ? 'C' : gold >= -1000 ? 'D' : 'F';
}

function fightChapter(m: D2Match, f: D2Fight): Chapter {
  const fallen = (team: D2Team) => m.players.filter(p => p.team === team).reduce((a, p) => a + (f.players[p.slot]?.deaths ?? 0), 0);
  const diff = fallen(1) - fallen(0) || f.gold[0] - f.gold[1];
  const winner: D2Team | null = diff > 0 ? 0 : diff < 0 ? 1 : null;
  const effort = (team: D2Team) => m.players.filter(p => p.team === team).reduce((a, p) => a + (f.players[p.slot]?.damage ?? 0) + (f.players[p.slot]?.healing ?? 0), 0);
  return {
    t: f.start, kind: 'fight', winner, title: `Fight at ${mins(f.start)}: ${fallen(1)} : ${fallen(0)} deaths`,
    grades: m.players.map(p => {
      const s = f.players[p.slot];
      if (!s || !f.present[p.team].includes(p.slot)) return null;
      const all = effort(p.team), share = all ? (s.damage + s.healing) / all : 0;
      const why = `${s.kills} K, ${s.deaths} D, ${Math.round(share * 100)}% of the team's damage and healing${s.help ? `, ${s.help} helping skills or items` : ''}`;
      return { letter: fightLetter(s.kills, s.deaths, share, winner === p.team, s.help), why };
    }),
  };
}

/** How near a killer counts as being there too (map widths), and the end of the laning phase, for telling a gank. */
const WAS_THERE = 1200 / MAP_UNITS, LANE_END = 600;
/**
 * Who else was at a pick-off, from the replay: OpenDota lists assists only per match. In the laning phase, a teammate who
 * came from another lane made a gank.
 */
function helperLetter(m: D2Match, tracks: ReplayTracks | null, slot: number, deaths: D2Match['deaths']): Grade | null {
  if (!tracks) return null;
  const p = m.players[slot], enemyFell = deaths.filter(d => m.players[d.slot].team !== p.team);
  for (const d of enemyFell) {
    const me = heroAt(tracks, p.hero, d.t), there = heroAt(tracks, m.players[d.slot].hero, d.t - 1);
    if (!me?.hp || !there || Math.hypot(me.at.x - there.at.x, me.at.y - there.at.y) > WAS_THERE) continue;
    // lanes are numbered by where they are on the map, so enemies who share a lane have the same number
    const gank = d.t < LANE_END && p.lane !== null && m.players[d.slot].lane !== null && p.lane !== m.players[d.slot].lane;
    return gank ? { letter: 'A', why: 'Came from another lane for the kill: a gank.' } : { letter: 'B', why: 'Was there for the kill.' };
  }
  return null;
}

/** Deaths outside teamfights, close ones together: the coach's own verdict on each death and kill decides. */
function pickChapters(m: D2Match, moves: D2Move[], tracks: ReplayTracks | null): Chapter[] {
  const groups: D2Match['deaths'][] = [];
  for (const d of m.deaths.filter(x => x.fight === null)) {
    const last = groups[groups.length - 1];
    if (last && d.t - last[last.length - 1].t <= PICK_GAP) last.push(d); else groups.push([d]);
  }
  const noteOf = (kind: D2Move['kind'], slot: number, t: number) => moves.find(x => x.kind === kind && x.slot === slot && x.t === t)?.note;
  return groups.map(deaths => {
    const grades = m.players.map((p): Grade | null => {
      const kills = deaths.filter(d => d.killer === p.slot && d.slot !== p.slot), died = deaths.filter(d => d.slot === p.slot);
      if (!kills.length && !died.length) return helperLetter(m, tracks, p.slot, deaths);
      if (died.length && kills.length) return { letter: 'C', why: 'Killed and was killed.' };
      if (died.length) {
        const notes = died.map(d => noteOf('death', p.slot, d.t));
        if (notes.includes('??')) return { letter: 'F', why: 'A death with nothing to show for it, by the coach.' };
        if (notes.includes('?') || notes.includes('?!')) return { letter: 'D', why: 'A death the coach marks as a mistake.' };
        return { letter: 'C', why: 'Died, but it was traded or fair.' };
      }
      const notes = kills.map(d => noteOf('kill', p.slot, d.t));
      if (kills.length >= 3 || notes.includes('!!')) return { letter: 'S', why: `${kills.length} kills in a row.` };
      if (kills.length >= 2 || notes.includes('!')) return { letter: 'A', why: kills.length >= 2 ? 'A double kill.' : 'Killed someone much richer.' };
      return { letter: 'B', why: 'A pick-off.' };
    });
    const dead = (team: D2Team) => deaths.filter(d => m.players[d.slot].team === team).length;
    return { t: deaths[0].t, kind: 'pick' as const, winner: dead(1) > dead(0) ? 0 as const : dead(0) > dead(1) ? 1 as const : null, title: `Pick-off at ${mins(deaths[0].t)}`, grades };
  });
}

export function gradeMatch(m: D2Match, moves: D2Move[], tracks: ReplayTracks | null = null): MatchGrades {
  const supports = new Set([...supportsOf(m, 0), ...supportsOf(m, 1)]);
  const whole = (kind: 'vision' | 'team', t: number, title: string, letter: (n: SupportNumbers) => Letter, why: (n: SupportNumbers, slot: number) => string): Chapter => ({
    t, kind, winner: null, title,
    grades: m.players.map(p => (supports.has(p.slot) ? { letter: letter(supportNumbers(m, p.slot)), why: why(supportNumbers(m, p.slot), p.slot) } : null)),
  });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const wholeGame = m.wards.length ? [
    whole('vision', -3, 'Vision over the match, against pro supports', visionLetter, (n, slot) => `${m.players[slot].obs} observers, ${m.players[slot].sen} sentries; observers stood ${pct(n.wardLife)} of their life, ${pct(n.onSpot)} on spots pros use; ${m.players[slot].dewards} enemy wards killed`),
    whole('team', -2, 'Team play over the match, against pro supports', teamPlayLetter, (n, slot) => `In ${pct(n.killShare)} of the team's kills; ${Math.round(m.players[slot].stuns)} s of stuns; ${m.players[slot].allyCasts} skills on teammates, ${m.players[slot].helpItems} helping items used; ${m.players[slot].stacks} camps stacked`),
  ] : [];
  const lane: Chapter = {
    t: -1, kind: 'lane', winner: null, title: 'The lane, by net worth at 10:00 against the opposite number',
    grades: m.players.map(p => {
      const gold = moves.find(x => x.kind === 'laning' && x.slot === p.slot)?.laneGold;
      return gold === undefined ? null : { letter: laneLetter(gold), why: `${gold >= 0 ? '+' : '−'}${Math.abs(Math.round(gold)).toLocaleString()} gold at 10:00` };
    }),
  };
  const chapters = [...wholeGame, ...(lane.grades.some(Boolean) ? [lane] : []), ...m.fights.map(f => fightChapter(m, f)), ...pickChapters(m, moves, tracks)].sort((a, b) => a.t - b.t);
  const players = m.players.map((p): PlayerGrades => {
    const letters = chapters.flatMap(c => (c.grades[p.slot] ? [c.grades[p.slot]!.letter] : []));
    const counts = Object.fromEntries(LETTERS.map(l => [l, letters.filter(x => x === l).length])) as Record<Letter, number>;
    const average = letters.length ? letters.reduce((a, l) => a + LETTER_WORTH[l], 0) / letters.length : 0;
    const plain = letters.length ? matchScore(average, p.kills, p.assists, p.deaths, p.team === m.winner) : 0;
    const job = supports.has(p.slot) && wholeGame.length ? [wholeGame[0].grades[p.slot]!.letter, wholeGame[1].grades[p.slot]!.letter] : null;
    const score = letters.length && job ? supportScore(plain, job[0], job[1], p.team === m.winner) : plain;
    return { slot: p.slot, letter: letters.length ? letterOfScore(score) : 'C', counts, graded: letters.length, average, score };
  });
  const played = players.filter(p => p.graded > 0);
  return { chapters, players, best: played.length ? played.reduce((a, b) => (b.score > a.score ? b : a)).slot : null };
}

/** What one kill's worth of KDA adds to a match's score, how much it can add at most, and what winning adds. */
const KDA_WORTH = 0.06, KDA_MOST = 0.6, WIN_WORTH = 0.15, WINNER_AT_LEAST = 2.4;
/**
 * A match's score: the average of its moments, plus the game as a whole. A carry's many ordinary kills and a support's
 * assists average out in the moments, though a 13/2 or a 2/2/18 game is plainly more than a row of Bs.
 */
export function matchScore(average: number, kills: number, assists: number, deaths: number, won: boolean): number {
  const score = average + Math.min(KDA_MOST, ((kills + assists) / Math.max(1, deaths)) * KDA_WORTH) + (won ? WIN_WORTH : 0);
  // an F on the winning side says more about what the data can't see (stuns, saves, vision) than about the player
  return won ? Math.max(WINNER_AT_LEAST, score) : score;
}
/**
 * What a typical support and a typical core score, and how far above typical the top tenth of each is, measured on 60 pro
 * matches. Moments are mostly kills and damage, so before this only 4% of supports reached S against 21% of cores.
 */
const SUPPORT = { middle: 3.95, spread: 0.58, jobLift: 0.3 }, CORE = { middle: 4.12, spread: 0.93 };
/**
 * A support's score: half their moments, half their own job (vision and team play), then placed among supports the way a
 * core is among cores. So an S means the same on either: about as rare, for about as good a game of that role.
 */
export function supportScore(plain: number, vision: Letter, teamPlay: Letter, won: boolean): number {
  const blended = 0.5 * plain + 0.5 * ((LETTER_WORTH[vision] + LETTER_WORTH[teamPlay]) / 2 + SUPPORT.jobLift);
  const score = CORE.middle + (blended - SUPPORT.middle) * (CORE.spread / SUPPORT.spread);
  return won ? Math.max(WINNER_AT_LEAST, score) : score;
}
/** The same steps as a CS2 match grade. */
export function letterOfScore(v: number): Letter {
  return v >= 5.4 ? 'S+' : v >= 4.8 ? 'S' : v >= 4.2 ? 'A' : v >= 3.6 ? 'B' : v >= 3 ? 'C' : v >= 2.4 ? 'D' : 'F';
}

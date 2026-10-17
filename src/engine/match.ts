import { cappedDamage, duelOdds, roundFacts, roundGrade, type DemoData, type Letter, type Replay, type Review, type Role, type Tag } from './recap';
import type { Side } from './types';

/**
 * Match report: every round's grades rolled up per player, plus an estimated rating for the game.
 *
 * Estimated game rating (Premier scale), like a chess "performance rating":
 *   duel rating — the rating at which this player's duel record (kills = wins, deaths = losses, against
 *                 each opponent's real rating) would be exactly what you'd expect
 *   game rating — duel rating + IMPACT_PER_POINT × their average round impact (win chance they added)
 * So a player who wins duels against stronger players and makes round-winning plays rates high, whatever
 * their actual rank.
 */

/** One player's line for one round (serializable: computed in a worker). */
export interface RoundLine {
  side: Side;
  letter: Letter;
  points: number; // impact points incl. tag bonuses
  impact: number; // win chance added (0..1 scale, can be negative)
  role: Role;
  kills: number;
  deaths: number;
  headshots: number;
  damage: number; // to enemies, guns + grenades
  utilDamage: number;
  kast: boolean; // kill, assist, survived or traded
  tags: Tag[];
  /** Duels: opponent id and whether this player won. */
  duels: { opp: string; won: boolean }[];
}

export interface RoundSummary { n: number; winner: Side | null; lines: Record<string, RoundLine> }

export { cappedDamage };

export function summarizeRound(rep: Replay, rv: Review): RoundSummary {
  const r = rep.round;
  const sideOf = (id: string) => r.frames.players[id]?.side;
  const lines: Record<string, RoundLine> = {};
  const dmg = cappedDamage(r);
  for (const id of Object.keys(r.frames.players)) {
    const side = sideOf(id)!;
    const moves = rv.moves.filter(m => m.player === id);
    const { letter, points } = roundGrade(moves, roundFacts(r, id));
    const kills = r.kills.filter(k => k.attacker === id && k.victim !== id && sideOf(k.victim) !== side);
    const died = r.kills.find(k => k.victim === id);
    const gunDmg = dmg.guns.filter(h => h.attacker === id && sideOf(h.victim) && sideOf(h.victim) !== side).reduce((a, h) => a + h.dmg, 0);
    const utilDamage = dmg.util.filter(h => h.attacker === id && sideOf(h.victim) && sideOf(h.victim) !== side).reduce((a, h) => a + h.dmg, 0);
    // assist: hurt an enemy (40+) a teammate then killed
    const assist = r.kills.some(k => k.attacker !== id && sideOf(k.attacker) === side
      && dmg.guns.filter(h => h.attacker === id && h.victim === k.victim && h.t <= k.t).reduce((a, h) => a + h.dmg, 0) >= 40);
    const traded = !!died && r.kills.some(k => k.victim === died.attacker && k.t > died.t && k.t - died.t <= 5);
    lines[id] = {
      side, letter, points,
      impact: moves.reduce((a, m) => a + m.gain, 0),
      role: rv.roles[id]?.role ?? 'Rifler',
      kills: kills.length, deaths: died ? 1 : 0, headshots: kills.filter(k => k.headshot).length,
      damage: gunDmg + utilDamage, utilDamage,
      kast: kills.length > 0 || assist || !died || traded,
      tags: moves.flatMap(m => m.tags),
      duels: [
        ...kills.map(k => ({ opp: k.victim, won: true })),
        ...(died && died.attacker && died.attacker !== id && sideOf(died.attacker) && sideOf(died.attacker) !== side ? [{ opp: died.attacker, won: false }] : []),
      ],
    };
  }
  return { n: r.n, winner: r.winner, lines };
}

/** Rating points per impact point per round (an average +5 impact a round ≈ +750). */
export const IMPACT_PER_POINT = 150;
const DEFAULT_RATING = 10000; // unranked players count as average when they are opponents

export interface PlayerReport {
  id: string;
  name: string;
  team: 0 | 1; // which side they started on: 0 = CT first half, 1 = T first half
  rank: number | null; // real Premier/competitive rating
  rounds: (RoundLine | null)[]; // by round index; null = not graded yet or not in that round
  played: number;
  kills: number; deaths: number; adr: number; kast: number; hs: number;
  openingKills: number; openingDeaths: number; clutches: number; multiKills: number;
  utilDamage: number; flashAssists: number; whiffs: number; upsets: number;
  impactPerRound: number; // win chance added per round, in % points
  pointsPerRound: number;
  letter: Letter; // match grade
  duelsWon: number; duelsLost: number; avgOpponent: number | null;
  duelRating: number | null; // performance rating from duels alone
  gameRating: number | null; // estimated rating for this game
  roles: { role: Role; rounds: number }[];
}

export interface MatchReport {
  players: PlayerReport[];
  score: [number, number]; // rounds won by team 0 and team 1
  graded: number;
  total: number;
}

export function buildMatchReport(data: DemoData, rounds: (RoundSummary | null)[]): MatchReport {
  const first = data.rounds[0];
  const ids = [...new Set(data.rounds.flatMap(r => Object.keys(r.frames.players)))];
  // teams by who plays alongside whom (sides swap at halftime and in overtime): team 0 started CT
  const ref = Object.keys(first.frames.players).find(id => first.frames.players[id].side === 'CT') ?? ids[0];
  const teamOf = (id: string): 0 | 1 => {
    const r = data.rounds.find(x => x.frames.players[id] && x.frames.players[ref]);
    return !r || r.frames.players[id].side === r.frames.players[ref].side ? 0 : 1;
  };
  const rankOf = (id: string) => data.ranks?.[id]?.rating ?? null;
  const score: [number, number] = [0, 0];
  data.rounds.forEach(r => {
    if (!r.winner) return;
    const someone = Object.keys(r.frames.players).find(id => r.frames.players[id].side === r.winner);
    if (someone) score[teamOf(someone)]++;
  });

  const players = ids.map((id): PlayerReport => {
    const lines = rounds.map(rs => rs?.lines[id] ?? null);
    const got = lines.filter((l): l is RoundLine => !!l);
    const n = Math.max(1, got.length);
    const sum = (f: (l: RoundLine) => number) => got.reduce((a, l) => a + f(l), 0);
    const tagCount = (t: Tag) => got.reduce((a, l) => a + l.tags.filter(x => x === t).length, 0);
    const kills = sum(l => l.kills);
    const duels = got.flatMap(l => l.duels);
    const opp = duels.map(d => rankOf(d.opp) ?? DEFAULT_RATING);
    const won = duels.filter(d => d.won).length;
    const knownRatings = duels.some(d => rankOf(d.opp) !== null);
    const duelRating = duels.length && knownRatings ? performance(opp, won) : null;
    const pointsPerRound = sum(l => l.points) / n;
    const roleCount = new Map<Role, number>();
    for (const l of got) roleCount.set(l.role, (roleCount.get(l.role) ?? 0) + 1);
    return {
      id, name: data.names[id] ?? id, team: teamOf(id), rank: rankOf(id), rounds: lines, played: got.length,
      kills, deaths: sum(l => l.deaths), adr: sum(l => l.damage) / n, kast: (got.filter(l => l.kast).length / n) * 100,
      hs: kills ? (sum(l => l.headshots) / kills) * 100 : 0,
      openingKills: got.filter(l => l.tags.includes('OPENING') && l.kills > 0 && l.duels.some(d => d.won)).length,
      openingDeaths: got.filter(l => l.tags.includes('OPENING') && l.deaths > 0 && !l.duels.some(d => d.won)).length,
      clutches: tagCount('CLUTCH'), multiKills: got.filter(l => l.kills >= 3).length,
      utilDamage: sum(l => l.utilDamage), flashAssists: tagCount('FLASH ASSIST'), whiffs: tagCount('WHIFF'), upsets: tagCount('UPSET'),
      impactPerRound: (sum(l => l.impact) / n) * 100, pointsPerRound,
      letter: matchLetter(got.map(l => l.letter)),
      duelsWon: won, duelsLost: duels.length - won, avgOpponent: opp.length ? opp.reduce((a, b) => a + b, 0) / opp.length : null,
      duelRating, gameRating: duelRating !== null ? Math.round(duelRating + IMPACT_PER_POINT * pointsPerRound) : null,
      roles: [...roleCount].map(([role, rounds]) => ({ role, rounds })).sort((a, b) => b.rounds - a.rounds),
    };
  });
  players.sort((a, b) => a.team - b.team || (b.gameRating ?? -1e9) - (a.gameRating ?? -1e9) || b.pointsPerRound - a.pointsPerRound);
  return { players, score, graded: rounds.filter(Boolean).length, total: data.rounds.length };
}

/**
 * Performance rating: the rating R at which the expected wins against these opponents equal the
 * actual wins. Half a win and half a loss against the average opponent are added so 10–0 isn't infinite.
 */
export function performance(opponents: number[], wins: number): number {
  const avg = opponents.reduce((a, b) => a + b, 0) / opponents.length;
  const opp = [...opponents, avg];
  const target = wins + 0.5;
  let lo = 0, hi = 40000;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const exp = opp.reduce((a, o) => a + duelOdds(mid, o), 0);
    if (exp < target) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

const LETTER_VALUE: Record<Letter, number> = { 'S+': 7, S: 6, A: 5, B: 4, C: 3, D: 2, F: 0 };
/**
 * Match grade from the round grades: their average (S+ = 7 … C = 3 … F = 0), lifted a step by several
 * transcendent rounds and held down by repeated blunders.
 */
export function matchLetter(rounds: Letter[]): Letter {
  if (!rounds.length) return 'C';
  const avg = rounds.reduce((a, l) => a + LETTER_VALUE[l], 0) / rounds.length;
  const count = (l: Letter) => rounds.filter(x => x === l).length;
  const v = avg + (count('S+') >= 3 ? 0.3 : 0) - (count('F') >= 3 ? 0.3 : 0);
  return v >= 5.4 ? 'S+' : v >= 4.8 ? 'S' : v >= 4.2 ? 'A' : v >= 3.6 ? 'B' : v >= 3 ? 'C' : v >= 2.4 ? 'D' : 'F';
}

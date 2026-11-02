/** Which heroes go together and which beat which, from tools/dota-draft.ts's count of recent high-rank games. */
export interface HeroPairs {
  matches: number; days: number; ids: number[]; roles: string[][];
  games: number[]; wins: number[]; withGames: number[]; withWins: number[]; vsGames: number[]; vsWins: number[];
  /** From tools/dota-positions.ts: hero id to games played at positions 1 to 5. */
  positions?: Record<number, number[]>;
}

/** Games of the expected result mixed into a pair's own: few games can't make a big claim. */
const PULL = 100;
/** What suiting a free position is worth, against win rates: a team needs all five played, more than it needs a small edge. */
const POSITION_WORTH = 0.015;
/** How many of the very best a team's first hero is drawn from, so auto-pick doesn't build the same team each time. */
const FIRST_FROM = 8;

const pairAt = (n: number, i: number, j: number) => (i * (2 * n - i - 1)) / 2 + (j - i - 1);
const lookup = (d: HeroPairs) => new Map(d.ids.map((id, i) => [id, i]));
/** A hero's own win rate, over and above even. */
function own(d: HeroPairs, i: number) { return (d.wins[i] + PULL / 2) / (d.games[i] + PULL) - 0.5; }

/** How far a pair's result is above what their own win rates lead to expect, shrinking to nothing as its games get few. */
const aboveExpected = (wins: number, games: number, expected: number) => (wins - games * expected) / (games + PULL);

/** How much better two heroes do together than their own win rates say (0 when unknown). */
export function synergy(d: HeroPairs, a: number, b: number): number {
  const at = lookup(d), i = at.get(a), j = at.get(b);
  if (i === undefined || j === undefined || i === j) return 0;
  const k = pairAt(d.ids.length, Math.min(i, j), Math.max(i, j));
  return aboveExpected(d.withWins[k], d.withGames[k], 0.5 + own(d, i) + own(d, j));
}

/** How much better `hero` does against `other` than their own win rates say: above 0, a counter (0 when unknown). */
export function counterEdge(d: HeroPairs, hero: number, other: number): number {
  const at = lookup(d), i = at.get(hero), j = at.get(other);
  if (i === undefined || j === undefined || i === j) return 0;
  const lo = Math.min(i, j), hi = Math.max(i, j), k = pairAt(d.ids.length, lo, hi);
  // the count is for the lower-numbered hero of the two
  const edge = aboveExpected(d.vsWins[k], d.vsGames[k], 0.5 + own(d, lo) - own(d, hi));
  return i < j ? edge : -edge;
}

/** Games two heroes have met in, for saying how much a number rests on. */
export function gamesAgainst(d: HeroPairs, a: number, b: number): number {
  const at = lookup(d), i = at.get(a), j = at.get(b);
  return i === undefined || j === undefined || i === j ? 0 : d.vsGames[pairAt(d.ids.length, Math.min(i, j), Math.max(i, j))];
}

export interface Counter { hero: number; edge: number; games: number }
/** The heroes who do best against this one, and those this one does best against. */
export function countersOf(d: HeroPairs, hero: number, count: number): { beatIt: Counter[]; itBeats: Counter[] } {
  const all = d.ids.filter(h => h !== hero).map(h => ({ hero: h, edge: counterEdge(d, h, hero), games: gamesAgainst(d, h, hero) }));
  const by = [...all].sort((a, b) => b.edge - a.edge);
  return { beatIt: by.slice(0, count), itBeats: by.slice(-count).reverse().map(c => ({ ...c, edge: -c.edge })) };
}

export type Position = 1 | 2 | 3 | 4 | 5;
/** The five positions of a team: what each is called, the lane it goes to and what it's there to do. */
export const POSITION_INFO: Record<Position, { name: string; job: string; lane: (team: 0 | 1) => 1 | 2 | 3 }> = {
  1: { name: 'Carry', job: 'Farm safely and last-hit; takes over the late game.', lane: team => (team === 0 ? 1 : 3) },
  2: { name: 'Mid', job: 'Get ahead in levels, take power runes and gank the side lanes.', lane: () => 2 },
  3: { name: 'Offlane', job: 'Pressure the enemy carry, survive, and start the fights.', lane: team => (team === 0 ? 3 : 1) },
  4: { name: 'Soft support', job: 'Help the offlane, then roam: ganks, stacks, smokes.', lane: team => (team === 0 ? 3 : 1) },
  5: { name: 'Hard support', job: 'Protect the carry: pull, ward, buy the team\'s vision.', lane: team => (team === 0 ? 1 : 3) },
};
/** OpenDota's lane numbers, in words. */
export const LANE_NAME: Record<1 | 2 | 3, string> = { 1: 'Bottom', 2: 'Mid', 3: 'Top' };
/** How well each of the game's hero tags suits a position. A rule of thumb: the tags don't say where a hero is really played. */
const POSITION_TAGS: Record<Position, Record<string, number>> = {
  1: { Carry: 3, Pusher: 0.5, Support: -3 },
  2: { Nuker: 2, Escape: 1, Carry: 1, Pusher: 0.5, Support: -1 },
  3: { Durable: 3, Initiator: 2, Disabler: 0.5, Support: -1 },
  4: { Support: 2, Initiator: 1.5, Disabler: 1, Nuker: 1, Escape: 0.5, Carry: -1 },
  5: { Support: 3, Disabler: 1, Carry: -2 },
};
const ALL_POSITIONS: Position[] = [1, 2, 3, 4, 5];
/** Games a hero needs before where they are really played counts for as much as their tags. */
const POSITION_GAMES = 10;
/** What being played only in a position is worth, against the tags. */
const PLAYED_WORTH = 5;

/** A hero's share of games at a position, and how many games that rests on. */
function played(d: HeroPairs, hero: number, pos: Position): { share: number; games: number } {
  const counts = d.positions?.[hero], games = counts ? counts.reduce((a, b) => a + b, 0) : 0;
  return { share: games ? counts![pos - 1] / games : 0, games };
}
/** What the game's tags say of a hero at a position. */
function tagged(d: HeroPairs, hero: number, pos: Position): number {
  return (d.roles[lookup(d).get(hero) ?? -1] ?? []).reduce((a, r) => a + (POSITION_TAGS[pos][r] ?? 0), 0);
}
/** How well a hero suits a position: where they are really played, leaning on the tags while the games are few. */
function suits(d: HeroPairs, hero: number, pos: Position): number {
  const { share, games } = played(d, hero, pos), trust = games / (games + POSITION_GAMES);
  return trust * share * PLAYED_WORTH + (1 - trust) * tagged(d, hero, pos);
}

export interface LanedPlayer { hero_id: number; lane_role?: number | null; net_worth?: number | null }
/**
 * Which position each of a team's five played, from their lanes (1 safe, 2 mid, 3 off) and net worth:
 * the richer of a side lane is its core, the other its support, and whoever is left takes what's free, richest first.
 */
export function positionsOfTeam(players: LanedPlayer[]): { hero: number; position: Position }[] {
  const rich = [...players].sort((a, b) => (b.net_worth ?? 0) - (a.net_worth ?? 0));
  const inLane = (lane: number) => rich.filter(p => p.lane_role === lane);
  const at = new Map<LanedPlayer, Position>();
  const place = (p: LanedPlayer | undefined, pos: Position) => { if (p) at.set(p, pos); };
  place(inLane(2)[0], 2);
  place(inLane(1)[0], 1); place(inLane(1)[1], 5);
  place(inLane(3)[0], 3); place(inLane(3)[1], 4);
  const free = ALL_POSITIONS.filter(pos => ![...at.values()].includes(pos));
  for (const p of rich) if (!at.has(p)) at.set(p, free.shift() ?? 5);
  return [...at].map(([p, position]) => ({ hero: p.hero_id, position }));
}

/** The heroes in the positions that suit them best together, and how well that is. Nobody shares a position. */
function bestPositions(d: HeroPairs, team: number[]): { at: Map<number, Position>; score: number } {
  let best = { at: new Map<number, Position>(), score: -Infinity };
  const walk = (i: number, free: Position[], score: number, at: [number, Position][]) => {
    if (i === team.length) { if (score > best.score) best = { at: new Map(at), score }; return; }
    for (const pos of free) walk(i + 1, free.filter(p => p !== pos), score + suits(d, team[i], pos), [...at, [team[i], pos]]);
  };
  walk(0, ALL_POSITIONS, 0, []);
  return best;
}
/** Who plays where, in position order. */
export function assignPositions(d: HeroPairs, team: number[]): { hero: number; position: Position }[] {
  return [...bestPositions(d, team.slice(0, 5)).at].map(([hero, position]) => ({ hero, position })).sort((a, b) => a.position - b.position);
}

/** What a hero would add to a team: how well they fit with it and do against the enemy, and whether the five can still play every position. */
export function fitOf(d: HeroPairs, hero: number, team: number[], enemies: number[]): number {
  const i = lookup(d).get(hero);
  return (i === undefined ? 0 : own(d, i))
    + team.reduce((a, h) => a + synergy(d, hero, h), 0)
    + enemies.reduce((a, h) => a + counterEdge(d, hero, h), 0)
    + (bestPositions(d, [...team, hero]).score - bestPositions(d, team).score) * POSITION_WORTH;
}

/**
 * Fills a team up to five, one hero at a time, each the best fit for those before them and against the enemy.
 * `random` (0–1) varies only the team's very first hero when there's nothing yet to fit with.
 */
export function autoPick(d: HeroPairs, team: number[], enemies: number[], random: () => number = Math.random): number[] {
  const chosen = [...team], added: number[] = [];
  while (chosen.length < 5) {
    const free = d.ids.filter(h => !chosen.includes(h) && !enemies.includes(h));
    const ranked = free.map(h => ({ h, fit: fitOf(d, h, chosen, enemies) })).sort((a, b) => b.fit - a.fit);
    if (!ranked.length) break;
    const nothingYet = !chosen.length && !enemies.length;
    const pick = ranked[nothingYet ? Math.floor(random() * Math.min(FIRST_FROM, ranked.length)) : 0].h;
    chosen.push(pick);
    added.push(pick);
  }
  return added;
}

/** A share of games at a position below this isn't where the hero is played. */
const PLAYED_AT_LEAST = 0.2;
/** With too few games to tell, how well the tags must suit a position instead. */
const TAGGED_AT_LEAST = 3;
/** A pairing worth less than this isn't worth naming as a reason. */
const REASON_AT_LEAST = 0.005;
/** Whether a hero is one to suggest for a position at all. Going by tags, only the position they suit best. */
function playsAt(d: HeroPairs, hero: number, pos: Position): boolean {
  const { share, games } = played(d, hero, pos);
  if (games >= POSITION_GAMES) return share >= PLAYED_AT_LEAST;
  const here = tagged(d, hero, pos);
  return here >= TAGGED_AT_LEAST && ALL_POSITIONS.every(p => tagged(d, hero, p) <= here);
}

export interface RolePick {
  hero: number;
  /** The whole gain: the hero's own win rate, with the team and against the enemy. */
  gain: number;
  /** The enemy this hero does best against, and the ally they go best with, when either helps. */
  beats: { hero: number; edge: number } | null;
  with: { hero: number; gain: number } | null;
}
export interface RoleSuggestion { position: Position; picks: RolePick[] }

/** For each position the team hasn't filled, the heroes who play it and would add most to this team against this enemy. */
export function picksByRole(d: HeroPairs, team: number[], enemies: number[], count: number): RoleSuggestion[] {
  const taken = new Set(bestPositions(d, team).at.values());
  const free = d.ids.filter(h => !team.includes(h) && !enemies.includes(h));
  const bestOf = <T extends { v: number }>(list: T[]) => list.reduce<T | null>((a, b) => (b.v >= REASON_AT_LEAST && (!a || b.v > a.v) ? b : a), null);
  return ALL_POSITIONS.filter(pos => !taken.has(pos)).map(position => ({
    position,
    picks: free.filter(h => playsAt(d, h, position)).map(hero => {
      const i = lookup(d).get(hero)!;
      const vs = bestOf(enemies.map(e => ({ hero: e, v: counterEdge(d, hero, e) })));
      const ally = bestOf(team.map(a => ({ hero: a, v: synergy(d, hero, a) })));
      return {
        hero,
        gain: own(d, i) + team.reduce((a, h) => a + synergy(d, hero, h), 0) + enemies.reduce((a, h) => a + counterEdge(d, hero, h), 0),
        beats: vs && { hero: vs.hero, edge: vs.v },
        with: ally && { hero: ally.hero, gain: ally.v },
      };
    }).sort((a, b) => b.gain - a.gain).slice(0, count),
  }));
}

/** The two heroes of a team who go together best, and how much. */
export function bestPair(d: HeroPairs, team: number[]): { a: number; b: number; gain: number } | null {
  let best: { a: number; b: number; gain: number } | null = null;
  team.forEach((a, i) => team.slice(i + 1).forEach(b => {
    const gain = synergy(d, a, b);
    if (!best || gain > best.gain) best = { a, b, gain };
  }));
  return best;
}

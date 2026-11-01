/** Which heroes go together and which beat which, from tools/dota-draft.ts's count of recent high-rank games. */
export interface HeroPairs {
  matches: number; days: number; ids: number[]; roles: string[][];
  games: number[]; wins: number[]; withGames: number[]; withWins: number[]; vsGames: number[]; vsWins: number[];
}

/** Games of the expected result mixed into a pair's own: few games can't make a big claim. */
const PULL = 100;
/** What a role the team still lacks is worth, against win rates: enough to choose between close heroes, not to pick a bad one. */
const ROLE_WORTH = 0.012;
/** A team of five usually wants this many heroes of each kind. */
const TEAM_ROLES: Record<string, number> = { Carry: 1, Support: 2, Durable: 1, Initiator: 1, Disabler: 2, Nuker: 1 };
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

/** How many more of each kind of hero this team wants. */
function lacking(d: HeroPairs, team: number[]) {
  const want = { ...TEAM_ROLES }, at = lookup(d);
  for (const h of team) for (const r of d.roles[at.get(h) ?? -1] ?? []) if (want[r]) want[r]--;
  return want;
}

/** What a hero would add to a team: how well they fit with it and do against the enemy, and the roles it's missing. */
export function fitOf(d: HeroPairs, hero: number, team: number[], enemies: number[]): number {
  const want = lacking(d, team), i = lookup(d).get(hero);
  const roles = i === undefined ? [] : d.roles[i];
  const roleGain = roles.reduce((a, r) => a + (want[r] ? ROLE_WORTH : 0), 0);
  return (i === undefined ? 0 : own(d, i))
    + team.reduce((a, h) => a + synergy(d, hero, h), 0)
    + enemies.reduce((a, h) => a + counterEdge(d, hero, h), 0)
    + roleGain;
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

/** The two heroes of a team who go together best, and how much. */
export function bestPair(d: HeroPairs, team: number[]): { a: number; b: number; gain: number } | null {
  let best: { a: number; b: number; gain: number } | null = null;
  team.forEach((a, i) => team.slice(i + 1).forEach(b => {
    const gain = synergy(d, a, b);
    if (!best || gain > best.gain) best = { a, b, gain };
  }));
  return best;
}

/**
 * Positions by farm priority (the owner's 6-position system): Pos 1 hard carry (highest farm) … Pos 6 hard support
 * (lowest). Each hero's usual position comes from how it farms in real games since the patch (tools/dl-positions.ts:
 * in each team, the players ranked by net worth at the end), split into six even groups; the owner's own examples are
 * fixed. A hero's spread (how often it ends up in each position) is kept too: pub players don't stick to positions.
 */
import POSITIONS from './generated/positions.json';
import { DL_HEROES } from './data';

export type Pos = 1 | 2 | 3 | 4 | 5 | 6;
export const POS_NAME: Record<Pos, string> = { 1: 'Hard Carry', 2: 'Soft Carry', 3: 'Offlaner', 4: 'Roamer / Flex', 5: 'Soft Support', 6: 'Hard Support' };
export const POS_JOB: Record<Pos, string> = {
  1: 'Highest farm: scale into the late game, the team\'s win condition',
  2: 'High farm: spike earlier than Pos 1, make tempo, force fights',
  3: 'Medium farm: take space, initiate, be hard to kill',
  4: 'Low to medium farm: rotate, gank, control the map, enable the carries',
  5: 'Low farm: utility damage, debuffs, semi-selfless play',
  6: 'Lowest farm: keep the team alive with heals, shields, saves and utility items',
};

/** The owner's examples, fixed whatever the data says. */
const FIXED: Record<string, Pos> = {
  Victor: 1, Wraith: 1, Pocket: 2, Celeste: 2, Mina: 2, Abrams: 3, 'Mo & Krill': 3, Dynamo: 6, Paige: 6, Rem: 6,
};

const DATA = POSITIONS as { since: string; matches: number; heroes: Record<string, { games: number; share: number[] }> };
const avgPos = (share: number[]) => share.reduce((a, x, i) => a + x * (i + 1), 0);

/** Every hero's usual position: the fixed ones, then the rest by how much they farm, filling the six positions evenly. */
const MAIN: Map<number, Pos> = (() => {
  const out = new Map<number, Pos>();
  const byName = new Map(DL_HEROES.map(h => [h.name, h.id]));
  for (const [name, pos] of Object.entries(FIXED)) { const id = byName.get(name); if (id !== undefined) out.set(id, pos); }
  const rest = DL_HEROES.filter(h => !out.has(h.id)).map(h => ({ id: h.id, a: DATA.heroes[h.id] ? avgPos(DATA.heroes[h.id].share) : 3.5 })).sort((x, y) => x.a - y.a);
  const per = Math.ceil(DL_HEROES.length / 6);
  const filled = (p: number) => [...out.values()].filter(x => x === p).length;
  let pos = 1;
  for (const r of rest) { while (filled(pos) >= per && pos < 6) pos++; out.set(r.id, pos as Pos); }
  return out;
})();

export const positionOf = (hero: number): Pos => MAIN.get(hero) ?? 3;
/** How often the hero ends up in each position (1–6), from real games; null when there's no data. */
export const spreadOf = (hero: number): number[] | null => DATA.heroes[hero]?.share ?? null;
export const POSITIONS_SOURCE = { since: DATA.since, matches: DATA.matches };

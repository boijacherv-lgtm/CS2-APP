/**
 * Where high-rank players die (tools/dl-deaths.ts → generated/deathmap.json): deaths in Phantom-and-up matches since the
 * patch on a grid, by stage of the match, turned so the dying player's base is at the bottom. A spot's heat is how its
 * deaths compare with the other spots where anyone died at that stage (a percentile: 90 = more deaths than 90% of
 * them). A busy spot is busy because players go there and fights happen there: heat says "people die here", not
 * "never go here".
 */
import DM from './generated/deathmap.json';
import type { DlTeam } from './data';

export const DEATH_GRID = 40;
export const DEATH_PHASES = [
  { from: 0, to: 600, label: 'Laning' }, { from: 600, to: 1200, label: '10–20 min' },
  { from: 1200, to: 1800, label: '20–30 min' }, { from: 1800, to: 99999, label: '30 min +' },
];
const DATA = DM as { since?: string; minBadge?: number; matches?: number; grid?: number; phases?: { deaths: number; cells: number[] }[] };
export const DEATH_SOURCE = { matches: DATA.matches ?? 0, minBadge: DATA.minBadge ?? 0, since: DATA.since ?? '' };

const phaseAt = (t: number) => DEATH_PHASES.findIndex(p => t >= p.from && t < p.to);
// each stage's busy cells, sorted, for percentiles
const SORTED = (DATA.phases ?? []).map(p => p.cells.filter(c => c > 0).sort((a, b) => a - b));

/** A spot's heat at time t for a player of `team` (0–100, null without data). */
export function heatAt(x: number, y: number, t: number, team: DlTeam): number | null {
  const ph = phaseAt(t), p = DATA.phases?.[ph];
  if (!p || !SORTED[ph]?.length) return null;
  const mx = team === 0 ? x : 1 - x, my = team === 0 ? y : 1 - y;
  const gx = Math.floor(mx * DEATH_GRID), gy = Math.floor(my * DEATH_GRID);
  if (gx < 0 || gy < 0 || gx >= DEATH_GRID || gy >= DEATH_GRID) return null;
  const c = p.cells[gy * DEATH_GRID + gx], xs = SORTED[ph];
  if (!c) return 0;
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < c) lo = mid + 1; else hi = mid; }
  return Math.round((lo / xs.length) * 100);
}

/** The grid at time t for a team's player (cells in map order, team 1's turned back to the real map), scaled 0–1. */
export function heatGrid(t: number, team: DlTeam): number[] | null {
  const p = DATA.phases?.[phaseAt(t)];
  if (!p) return null;
  const max = Math.max(1, ...p.cells);
  return team === 0 ? p.cells.map(c => c / max) : [...p.cells].reverse().map(c => c / max);
}

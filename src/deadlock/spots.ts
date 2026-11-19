/**
 * Where good players in your position are at each stage of the match (tools/dl-spots.ts → generated/spots.json:
 * high-rank players' paths, by position, on a grid turned so their base is at the bottom), and how your own match
 * compares: the share of your time spent where they usually are, and the longest stretches you spent where they rarely go.
 *
 * "Usually" is by time: the grid's cells sorted busiest first, a spot is usual when it's among the cells that hold 85%
 * of good players' time at that stage. Rare spots aren't wrong (a flank, a smoke gank): the coach shows them to look at,
 * it doesn't mark them as mistakes.
 */
import SP from './generated/spots.json';
import type { DlTeam } from './data';
import type { DlDemo } from './demo';
import { heroAt } from './demo';
import { playerAt, type DlMatch } from './match';
import { matchPosition } from './bench';

export const SPOT_GRID = 24;
export const SPOT_PHASES = [
  { from: 0, to: 300, label: '0–5 min' }, { from: 300, to: 600, label: '5–10 min' }, { from: 600, to: 900, label: '10–15 min' },
  { from: 900, to: 1200, label: '15–20 min' }, { from: 1200, to: 1800, label: '20–30 min' }, { from: 1800, to: 99999, label: '30 min +' },
];
const DATA = SP as { since?: string; minBadge?: number; matches?: number; grid?: number; pos?: number[][][] };
export const SPOT_SOURCE = { matches: DATA.matches ?? 0, minBadge: DATA.minBadge ?? 0, since: DATA.since ?? '' };
/** Share of good players' time a spot's cell must fall within (busiest first) to count as usual. */
const USUAL = 0.85;
const STEP = 5;
/** A rare stretch worth showing: this long or longer. */
const STRETCH = 30;

const phaseAt = (t: number) => SPOT_PHASES.findIndex(p => t >= p.from && t < p.to);
// for each position and stage: each cell's share of time in the cells busier than it (0: the busiest)
const RANK: (Float32Array | null)[][] = (DATA.grid === SPOT_GRID ? DATA.pos ?? [] : []).map(byPhase => byPhase.map(cells => {
  const total = cells.reduce((a, c) => a + c, 0);
  if (!total) return null;
  const order = cells.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]);
  const out = new Float32Array(cells.length).fill(1);
  let acc = 0;
  for (const [c, i] of order) { if (!c) break; out[i] = acc / total; acc += c; }
  return out;
}));
const cellOf = (x: number, y: number, team: DlTeam) => {
  const mx = team === 0 ? x : 1 - x, my = team === 0 ? y : 1 - y;
  const gx = Math.floor(mx * SPOT_GRID), gy = Math.floor(my * SPOT_GRID);
  return gx < 0 || gy < 0 || gx >= SPOT_GRID || gy >= SPOT_GRID ? -1 : gy * SPOT_GRID + gx;
};

/** Whether a spot is usual for a good player in this position at time t (null without data). */
export function usualAt(pos: number, t: number, x: number, y: number, team: DlTeam): boolean | null {
  const r = RANK[pos - 1]?.[phaseAt(t)], c = cellOf(x, y, team);
  return r && c >= 0 ? r[c] < USUAL : null;
}

/** Good players' grid in a position at a stage, scaled 0–1, in real map order for a player of `team`. */
export function spotGrid(pos: number, phase: number, team: DlTeam): number[] | null {
  const cells = DATA.grid === SPOT_GRID ? DATA.pos?.[pos - 1]?.[phase] : undefined;
  if (!cells) return null;
  const max = Math.max(1, ...cells);
  return team === 0 ? cells.map(c => c / max) : [...cells].reverse().map(c => c / max);
}

export interface Positioning {
  pos: number;
  /** Per stage: samples alive, and how many in usual spots. */
  phases: { label: string; n: number; usual: number }[];
  /** Where you were every 5 s (alive), and whether it was usual. */
  path: { t: number; x: number; y: number; usual: boolean }[];
  /** The longest stretches in rare spots (30 s or more), longest first. */
  stretches: { t: number; dur: number; x: number; y: number }[];
}
/** A player's match next to good players in their position; null without data or a position. */
export function positioning(m: DlMatch, slot: number, demo: DlDemo | null): Positioning | null {
  const pos = matchPosition(m, slot), me = m.players.find(p => p.slot === slot);
  if (!pos || !me || !RANK[pos - 1]?.some(Boolean)) return null;
  const phases = SPOT_PHASES.map(p => ({ label: p.label, n: 0, usual: 0 }));
  const path: Positioning['path'] = [], stretches: Positioning['stretches'] = [];
  let run: { t: number; x: number; y: number; last: number } | null = null;
  const close = () => { if (run && run.last - run.t >= STRETCH) stretches.push({ t: run.t, dur: run.last - run.t + STEP, x: run.x, y: run.y }); run = null; };
  for (let t = 0; t < m.duration; t += STEP) {
    const at = (demo ? heroAt(demo, slot, t) : null) ?? playerAt(m, slot, t);
    const usual = at ? usualAt(pos, t, at.x, at.y, me.team) : null;
    if (!at || usual === null) { close(); continue; }
    const ph = phases[phaseAt(t)];
    ph.n++; if (usual) ph.usual++;
    path.push({ t, x: at.x, y: at.y, usual });
    if (usual) close();
    else if (!run) run = { t, x: at.x, y: at.y, last: t };
    else run.last = t;
  }
  close();
  return { pos, phases, path, stretches: stretches.sort((a, b) => b.dur - a.dur).slice(0, 4) };
}

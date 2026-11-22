/**
 * Where good players are, and which wards pay off, learned from pro replays (tools/dota-spots.ts → generated/spots.json).
 *
 * Positions: for each position (1–5) and stage of the match, how much of pros' time falls in each cell of a grid laid over
 * the map, turned so their own base is bottom-left (the map is the same turned 180°). A spot is usual when it's among the
 * busiest cells holding 85% of their time at that stage; rare spots aren't wrong (a smoke, a flank): the coach shows them
 * to look at, it doesn't mark them as mistakes.
 *
 * Wards: every pro observer was checked against the replay: for how many seconds it showed enemy heroes, per minute it
 * stood (its circle cut by trees, as the site draws it), and whether an enemy died in its sight. Averaged by cell and stage
 * (pulled toward the stage's average where few wards went), that's what a ward at a spot is worth.
 */
import SP from './generated/spots.json';
import { OBS_VISION, visionShape, type D2Team, type Pt } from './data';
import { positionsOfTeam, type Position } from './draft';
import type { D2Match, D2Ward } from './match';
import type { ReplayTracks } from './replay/parser';
import { heroAt } from './tracks';

export const SPOT_GRID = 24;
export const SPOT_PHASES = [
  { from: -90, to: 300, label: '0–5 min' }, { from: 300, to: 600, label: '5–10 min' }, { from: 600, to: 900, label: '10–15 min' },
  { from: 900, to: 1200, label: '15–20 min' }, { from: 1200, to: 1800, label: '20–30 min' }, { from: 1800, to: 99999, label: '30 min +' },
];
export const WARD_STAGES = [{ from: -90, to: 600, label: 'Laning' }, { from: 600, to: 1500, label: 'Mid game' }, { from: 1500, to: 99999, label: 'Late game' }];
/** How often a hero's spot is read (s). */
export const SPOT_STEP = 5;
/** Share of good players' time a cell must fall within (busiest first) to count as usual. */
const USUAL = 0.85;
/** A rare stretch worth showing: this long or longer (s). */
const STRETCH = 30;
/** How many wards' worth of the stage's average a cell's own average is pulled toward. */
const PRIOR = 6;

export interface SpotData {
  since: string; matches: number; grid: number;
  /** [position 1–5][stage][cell]: samples. */
  pos: number[][][];
  /** By ward stage: per cell, wards and the sums of seconds seen per minute and of kills seen. */
  wards: { n: number[]; seen: number[]; kills: number[] }[];
  /** How well a spot's worth called a held-out ward's (correlation), and how often usual spots held held-out pros. */
  test?: { wardCorr: number; usualShare: number; wards: number };
}
const DATA = SP as unknown as Partial<SpotData>;
export const SPOT_SOURCE = { matches: DATA.matches ?? 0, since: DATA.since ?? '', test: DATA.test ?? null };
export const HAS_SPOTS = DATA.grid === SPOT_GRID && (DATA.pos?.length ?? 0) === 5 && (DATA.matches ?? 0) > 0;

export const phaseAt = (t: number) => Math.max(0, SPOT_PHASES.findIndex(p => t >= p.from && t < p.to));
export const wardStageAt = (t: number) => Math.max(0, WARD_STAGES.findIndex(p => t >= p.from && t < p.to));

/** The grid cell of a map point (0–1) for a player of `team`, turned so their base is bottom-left; -1 off the map. */
export function cellOf(at: Pt, team: D2Team): number {
  const x = team === 0 ? at.x : 1 - at.x, y = team === 0 ? at.y : 1 - at.y;
  const gx = Math.floor(x * SPOT_GRID), gy = Math.floor(y * SPOT_GRID);
  return gx < 0 || gy < 0 || gx >= SPOT_GRID || gy >= SPOT_GRID ? -1 : gy * SPOT_GRID + gx;
}

/** Each player's position (1–5) by slot: their lane (safe, mid, off, jungle) and net worth, as in the draft's data. */
export function positionsOf(m: D2Match): Map<number, Position> {
  const out = new Map<number, Position>();
  for (const team of [0, 1] as D2Team[]) {
    const mine = m.players.filter(p => p.team === team);
    // OpenDota's lanes: 1 bottom, 2 mid, 3 top, 4 jungle; Radiant's safe lane is the bottom one, Dire's the top
    const role = (lane: number | null) => (lane === 2 ? 2 : lane === 4 ? 4 : lane === 1 ? (team === 0 ? 1 : 3) : lane === 3 ? (team === 0 ? 3 : 1) : null);
    for (const { hero, position } of positionsOfTeam(mine.map(p => ({ hero_id: p.hero, lane_role: role(p.lane), net_worth: p.netWorth })))) {
      const p = mine.find(x => x.hero === hero);
      if (p) out.set(p.slot, position);
    }
  }
  return out;
}

// ---- positions

// for each position and stage: each cell's share of time in the cells busier than it (0: the busiest)
const RANK: (Float32Array | null)[][] = (HAS_SPOTS ? DATA.pos! : []).map(byPhase => byPhase.map(cells => {
  const total = cells.reduce((a, c) => a + c, 0);
  if (!total) return null;
  const order = cells.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]);
  const out = new Float32Array(cells.length).fill(1);
  let acc = 0;
  for (const [c, i] of order) { if (!c) break; out[i] = acc / total; acc += c; }
  return out;
}));

/** Whether a spot is usual for a good player in this position at time t (null without data). */
export function usualAt(pos: number, t: number, at: Pt, team: D2Team): boolean | null {
  const r = RANK[pos - 1]?.[phaseAt(t)], c = cellOf(at, team);
  return r && c >= 0 ? r[c] < USUAL : null;
}

/** Good players' grid in a position at a stage, scaled 0–1, in real map order for a player of `team`. */
export function spotGrid(pos: number, phase: number, team: D2Team): number[] | null {
  const cells = HAS_SPOTS ? DATA.pos?.[pos - 1]?.[phase] : undefined;
  if (!cells) return null;
  const max = Math.max(1, ...cells);
  return team === 0 ? cells.map(c => c / max) : [...cells].reverse().map(c => c / max);
}

export interface Positioning {
  pos: Position;
  /** Per stage: samples alive, and how many in usual spots. */
  phases: { label: string; n: number; usual: number }[];
  /** Where they were every 5 s (alive), and whether it was usual. */
  path: { t: number; x: number; y: number; usual: boolean }[];
  /** The longest stretches in rare spots (30 s or more), longest first. */
  stretches: { t: number; dur: number; x: number; y: number }[];
}
/** A player's match next to pros in their position, from the replay; null without it, the data or a position. */
export function positioning(m: D2Match, slot: number, tracks: ReplayTracks | null): Positioning | null {
  const pos = positionsOf(m).get(slot), me = m.players[slot];
  if (!tracks || !pos || !me || !RANK[pos - 1]?.some(Boolean)) return null;
  const phases = SPOT_PHASES.map(p => ({ label: p.label, n: 0, usual: 0 }));
  const path: Positioning['path'] = [], stretches: Positioning['stretches'] = [];
  let run: { t: number; x: number; y: number; last: number } | null = null;
  const close = () => { if (run && run.last - run.t >= STRETCH) stretches.push({ t: run.t, dur: run.last - run.t + SPOT_STEP, x: run.x, y: run.y }); run = null; };
  for (let t = 0; t < m.duration; t += SPOT_STEP) {
    const h = heroAt(tracks, me.hero, t);
    const usual = h && h.hp > 0 ? usualAt(pos, t, h.at, me.team) : null;
    if (!h || usual === null) { close(); continue; }
    const ph = phases[phaseAt(t)];
    ph.n++; if (usual) ph.usual++;
    path.push({ t, x: h.at.x, y: h.at.y, usual });
    if (usual) close();
    else if (!run) run = { t, x: h.at.x, y: h.at.y, last: t };
    else run.last = t;
  }
  close();
  return { pos, phases, path, stretches: stretches.sort((a, b) => b.dur - a.dur).slice(0, 4) };
}

// ---- wards

/** Whether a ward at `at` sees point p: inside its circle, short of the first tree on that ray. */
export function seesFrom(at: Pt, p: Pt): boolean {
  const dx = p.x - at.x, dy = p.y - at.y, d = Math.hypot(dx, dy);
  if (d > OBS_VISION) return false;
  const { points } = visionShape(at, OBS_VISION), rays = points.length / 2;
  const ray = Math.round(((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / rays)) % rays;
  return d <= Math.hypot(points[ray * 2] - at.x, points[ray * 2 + 1] - at.y);
}

/** What an observer really did, from the replay: seconds it showed enemy heroes, per minute it stood; enemies who died in its sight. */
export function wardDid(m: D2Match, w: D2Ward, tracks: ReplayTracks): { seen: number; kills: number } {
  const enemies = m.players.filter(p => p.team !== w.team);
  let seen = 0;
  for (let t = w.t; t < w.until; t++) for (const e of enemies) { const h = heroAt(tracks, e.hero, t); if (h && h.hp > 0 && seesFrom(w.at, h.at)) seen++; }
  const kills = m.deaths.filter(d => d.t >= w.t && d.t <= w.until && m.players[d.slot]?.team !== w.team)
    .filter(d => { const h = heroAt(tracks, m.players[d.slot].hero, d.t - 1); return !!h && seesFrom(w.at, h.at); }).length;
  return { seen: seen / Math.max(1, (w.until - w.t) / 60), kills };
}

const WARDS = HAS_SPOTS ? DATA.wards ?? [] : [];
const stageMean = WARDS.map(s => { const n = s.n.reduce((a, b) => a + b, 0); return { n, seen: n ? s.seen.reduce((a, b) => a + b, 0) / n : 0, kills: n ? s.kills.reduce((a, b) => a + b, 0) / n : 0 }; });
export const HAS_WARD_VALUE = stageMean.length === WARD_STAGES.length && stageMean.every(s => s.n > 0);

/** What an observer at this spot is worth at time t, from the pros' wards there: seconds of enemies seen per minute, kills seen. */
export function wardWorth(team: D2Team, t: number, at: Pt): { seen: number; kills: number; wards: number } | null {
  const st = wardStageAt(t), s = WARDS[st], mean = stageMean[st];
  if (!HAS_WARD_VALUE || !s || !mean) return null;
  const c = cellOf(at, team);
  if (c < 0) return { seen: mean.seen, kills: mean.kills, wards: 0 };
  // the cell and its neighbours, the neighbours counting half
  let n = 0, seen = 0, kills = 0;
  const gx = c % SPOT_GRID, gy = Math.floor(c / SPOT_GRID);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = gx + dx, y = gy + dy;
    if (x < 0 || y < 0 || x >= SPOT_GRID || y >= SPOT_GRID) continue;
    const i = y * SPOT_GRID + x, k = dx || dy ? 0.5 : 1;
    n += s.n[i] * k; seen += s.seen[i] * k; kills += s.kills[i] * k;
  }
  return { seen: (seen + PRIOR * mean.seen) / (n + PRIOR), kills: (kills + PRIOR * mean.kills) / (n + PRIOR), wards: Math.round(n) };
}
/** A pro observer's average worth at a stage. */
export const proWardWorth = (stage: number) => stageMean[stage] ?? null;

export interface WardReview {
  wards: { w: D2Ward; worth: number; did: { seen: number; kills: number } | null }[];
  /** The average worth of their observers' spots against pros' average for the same stages (1: as good). */
  worth: number; pros: number;
  /** From the replay, when it was read: what they really saw, per minute, against what pros' wards see. */
  seen: number | null;
  kills: number;
}
/** How much a player's observers were worth; null without data or observers. */
export function wardReview(m: D2Match, slot: number, tracks: ReplayTracks | null): WardReview | null {
  if (!HAS_WARD_VALUE) return null;
  const mine = m.wards.filter(w => w.slot === slot && w.kind === 'obs');
  if (!mine.length) return null;
  const wards = mine.map(w => ({ w, worth: wardWorth(w.team, w.t, w.at)?.seen ?? 0, did: tracks ? wardDid(m, w, tracks) : null }));
  const pros = mine.reduce((a, w) => a + (proWardWorth(wardStageAt(w.t))?.seen ?? 0), 0) / mine.length;
  const worth = wards.reduce((a, x) => a + x.worth, 0) / wards.length;
  const did = wards.filter(x => x.did);
  return {
    wards, worth, pros,
    seen: did.length ? did.reduce((a, x) => a + x.did!.seen, 0) / did.length : null,
    kills: did.reduce((a, x) => a + (x.did?.kills ?? 0), 0),
  };
}

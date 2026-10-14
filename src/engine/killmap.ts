import { FLASH_BLIND, HAZARD, HE_RADIUS_U, MAX_RANGE_PX, PEEKER_EDGE, rangeFactor, SIM_DT, TURN_AFTER, type Simulation } from './combat';
import { activeSmokes, CELL, MOLLY_DURATION, popAt, type MapGrid } from './grid';
import { FOV, inFov, type TacticalEngine } from './predict';
import { mulberry32 } from './rng';
import { bakeRoute } from './timeline';
import type { BoardState, Utility, Vec2, Weapon } from './types';

/**
 * Kill map: for every spot on the floor, how a CT holding there would do against the Ts'
 * movement. Each T's path is swept once (360° vision casts along it) to find when that T
 * first comes into view of each cell, and whether the T is already looking that way.
 * Encounters are then resolved in order with the same duel rules as the combat sim.
 */

export interface KillMap {
  /** Chance to get at least one kill. NaN = no T ever comes into view from here. */
  pKill: Float32Array;
  /** Expected kills. */
  expKills: Float32Array;
  /** Chance to still be alive after every encounter. */
  survive: Float32Array;
  /** Where the T movement came from. */
  source: 'players' | 'default paths';
  tracks: number;
}

export interface Track { samples: { t: number; pos: Vec2; heading: number }[]; weapon: Weapon }

const SAMPLE_DT = 0.5; // seconds between vision casts along a T path
const RAYS = 900; // per full-circle cast
const BUSY_WINDOW = 1.0; // a second T inside this window catches the CT mid-fight
const BUSY_PENALTY = 0.6;

export function computeKillMap(engine: TacticalEngine, board: BoardState, sim: Simulation | null, ctWeapon: Weapon = 'rifle'): KillMap {
  const g = engine.grid;
  const n = g.w * g.h;
  const { tracks, source } = tTracks(engine, board, sim);

  const { first, aware, distU, tPos } = sweepFirstSight(engine, board, tracks);

  // 2. Resolve encounters per cell; grenades and flashes tilt each duel.
  const util = board.utility.filter(u => u.type !== 'smoke');
  const scale = engine.map.radar.scale;
  const pKill = new Float32Array(n).fill(NaN);
  const expKills = new Float32Array(n).fill(NaN);
  const survive = new Float32Array(n).fill(NaN);
  const enc: { t: number; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!g.walk[i]) continue;
    enc.length = 0;
    const cell = util.length ? { x: ((i % g.w) + 0.5) * CELL, y: (((i / g.w) | 0) + 0.5) * CELL } : null;
    for (let k = 0; k < tracks.length; k++) {
      if (first[k][i] === Infinity) continue;
      let w = duelWin(!!aware[k][i], distU[k][i], ctWeapon, tracks[k].weapon);
      if (cell) w = utilityTilt(g, util, scale, first[k][i], cell, { x: tPos[k][i * 2], y: tPos[k][i * 2 + 1] }, w);
      enc.push({ t: first[k][i], w });
    }
    if (!enc.length) continue;
    enc.sort((a, b) => a.t - b.t);
    // default paths are alternative routes, not five Ts at once: duel the first T to show up
    if (source === 'default paths') enc.length = 1;
    let alive = 1, exp = 0;
    for (let e = 0; e < enc.length; e++) {
      const w = e > 0 && enc[e].t - enc[e - 1].t < BUSY_WINDOW ? enc[e].w * BUSY_PENALTY : enc[e].w;
      exp += alive * w;
      alive *= w;
    }
    pKill[i] = enc[0].w; // at least one kill = winning the first duel
    expKills[i] = exp;
    survive[i] = alive;
  }
  return { pKill, expKills, survive, source, tracks: tracks.length };
}

/** T movement to test positions against: placed Ts (cut at their simulated death), or default paths. */
/** When each T track is first seen from every cell, whether that T is looking, and from where. */
export function sweepFirstSight(engine: TacticalEngine, board: BoardState, tracks: Track[]) {
  const g = engine.grid;
  const n = g.w * g.h;
  const first = tracks.map(() => new Float32Array(n).fill(Infinity));
  const aware = tracks.map(() => new Uint8Array(n));
  const distU = tracks.map(() => new Float32Array(n));
  const tPos = tracks.map(() => new Float32Array(n * 2)); // where the T was when first seen
  tracks.forEach((tr, k) => {
    let last: Vec2 | null = null;
    for (const smp of tr.samples) {
      if (last && Math.hypot(smp.pos.x - last.x, smp.pos.y - last.y) < 10 && smp !== tr.samples[tr.samples.length - 1]) continue;
      last = smp.pos;
      const smokes = activeSmokes(board.utility, smp.t, engine.map.radar.scale);
      g.castVision(smp.pos, 0, Math.PI * 2, smokes, i => {
        if (first[k][i] !== Infinity) return;
        first[k][i] = smp.t;
        const c = { x: ((i % g.w) + 0.5) * CELL, y: (((i / g.w) | 0) + 0.5) * CELL };
        aware[k][i] = inFov(smp.pos, smp.heading, c, FOV) ? 1 : 0;
        distU[k][i] = Math.hypot(c.x - smp.pos.x, c.y - smp.pos.y) * engine.map.radar.scale;
        tPos[k][i * 2] = smp.pos.x;
        tPos[k][i * 2 + 1] = smp.pos.y;
      }, MAX_RANGE_PX, RAYS);
    }
  });

  return { first, aware, distU, tPos };
}

export function tTracks(engine: TacticalEngine, board: BoardState, sim: Simulation | null): { tracks: Track[]; source: KillMap['source'] } {
  const ts = board.players.filter(p => p.side === 'T');
  const tracks: Track[] = [];
  if (ts.length) {
    for (const p of ts) {
      const death = sim ? sim.deathT[sim.ids.indexOf(p.id)] ?? Infinity : Infinity;
      const samples: Track['samples'] = [];
      if (sim && sim.ids.includes(p.id)) {
        const i = sim.ids.indexOf(p.id);
        const step = Math.round(SAMPLE_DT / SIM_DT);
        for (let s = 0; s < sim.steps && s * SIM_DT <= death; s += step)
          samples.push({ t: s * SIM_DT, pos: { x: sim.x[i][s], y: sim.y[i][s] }, heading: sim.facing[i][s] });
      } else {
        const r = bakeRoute(engine, p);
        const f0 = p.facing ?? engine.facing(p);
        samples.push({ t: 0, pos: p.pos, heading: f0 });
        if (r) for (let t = r.start; t <= r.end + SAMPLE_DT; t += SAMPLE_DT) {
          const at = pointAt(r.pts, r.times, Math.min(t, r.end));
          samples.push({ t, pos: at.pos, heading: at.heading });
        }
      }
      tracks.push({ samples, weapon: p.weapon });
    }
    return { tracks, source: 'players' };
  }
  // No Ts placed: the shortest paths from T spawn to each site, and through each chokepoint.
  const spawn = engine.map.spawns.T[0];
  if (!spawn) return { tracks, source: 'default paths' };
  const goals: Vec2[][] = [[engine.map.sites.A.center], [engine.map.sites.B.center]];
  for (const c of engine.map.chokepoints) {
    const m = { x: (c.portal[0].x + c.portal[1].x) / 2, y: (c.portal[0].y + c.portal[1].y) / 2 };
    goals.push([m, engine.map.sites[c.feeds[0]].center]);
  }
  const secPerPx = engine.secPerPx('T', 'rifle');
  for (const via of goals) {
    const pts: Vec2[] = [spawn];
    for (const w of via) {
      const leg = engine.grid.shortestPath(pts[pts.length - 1], w);
      if (leg) pts.push(...leg.slice(1));
    }
    if (pts.length < 2) continue;
    const times = [0.4];
    for (let i = 1; i < pts.length; i++) times.push(times[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) * secPerPx);
    const samples: Track['samples'] = [];
    for (let t = 0; t <= times[times.length - 1] + SAMPLE_DT; t += SAMPLE_DT) {
      const at = pointAt(pts, times, Math.min(t, times[times.length - 1]));
      samples.push({ t, pos: at.pos, heading: at.heading });
    }
    tracks.push({ samples, weapon: 'rifle' });
  }
  return { tracks, source: 'default paths' };
}

/**
 * How utility changes a CT-vs-T duel at time t: a blinded or HE-damaged CT loses more often,
 * a blinded or damaged T less, and nobody can hold a spot that is on fire.
 */
export function utilityTilt(g: MapGrid, util: Utility[], scale: number, t: number, ct: Vec2, tp: Vec2, w: number) {
  const blind = (p: Vec2, u: Utility) => {
    const pop = popAt(u);
    return t >= pop && t <= pop + FLASH_BLIND && Math.hypot(p.x - u.pos.x, p.y - u.pos.y) < 560 && g.lineOfSight(p, u.pos);
  };
  const heDmg = (p: Vec2, u: Utility) => {
    const pop = popAt(u);
    if (t < pop) return 0;
    const d = Math.hypot(p.x - u.pos.x, p.y - u.pos.y) * scale;
    return d < HE_RADIUS_U && g.lineOfSight(p, u.pos) ? 1 - d / HE_RADIUS_U : 0;
  };
  for (const u of util) {
    if (u.type === 'flash') {
      if (blind(ct, u)) w *= 0.25;
      if (blind(tp, u)) w = 1 - (1 - w) * 0.25;
    } else if (u.type === 'he') {
      w *= 1 - 0.4 * heDmg(ct, u);
      w = 1 - (1 - w) * (1 - 0.4 * heDmg(tp, u));
    } else if (u.type === 'molotov') {
      const burning = t >= popAt(u) && t <= popAt(u) + MOLLY_DURATION;
      if (burning && Math.hypot(ct.x - u.pos.x, ct.y - u.pos.y) * scale < 120) w *= 0.3;
    }
  }
  return w;
}

function pointAt(pts: Vec2[], times: number[], t: number) {
  let i = 1;
  while (i < pts.length - 1 && times[i] < t) i++;
  const f = Math.max(0, Math.min(1, (t - times[i - 1]) / (times[i] - times[i - 1] || 1)));
  const a = pts[i - 1], b = pts[i];
  return { pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}

const duelCache = new Map<string, number>();

/**
 * Chance that a CT holding an angle (pre-aimed, standing still) wins a duel against a T
 * walking into view, using the combat sim's reaction and hazard rules. Cached per bucket.
 */
export function duelWin(tAware: boolean, units: number, ct: Weapon, t: Weapon): number {
  const bucket = Math.min(12, Math.floor(units / 250));
  const key = `${tAware ? 1 : 0}|${bucket}|${ct}|${t}`;
  const hit = duelCache.get(key);
  if (hit !== undefined) return hit;
  const d = bucket * 250 + 125;
  const rng = mulberry32(bucket * 7919 + (tAware ? 1 : 0) + ct.length * 31 + t.length * 131);
  const dt = 0.02, trials = 3000;
  let wins = 0;
  for (let k = 0; k < trials; k++) {
    const ctReact = 0.12 + PEEKER_EDGE + rng() * 0.22;
    const tReact = (tAware ? 0.22 : TURN_AFTER + 0.22) + rng() * 0.22;
    for (let time = 0; time < 6; time += dt) {
      const tMoving = time < 0.1; // the T stops to shoot right after spotting
      const pc = time >= ctReact ? 1 - Math.exp(-HAZARD[ct] * rangeFactor(ct, d) * (tMoving ? 0.85 : 1) * dt) : 0;
      const pt = time >= tReact ? 1 - Math.exp(-HAZARD[t] * rangeFactor(t, d) * dt) : 0;
      const ctHits = rng() < pc, tHits = rng() < pt;
      if (ctHits && tHits) { if (rng() < 0.5) wins++; break; }
      if (ctHits) { wins++; break; }
      if (tHits) break;
    }
  }
  const w = wins / trials;
  duelCache.set(key, w);
  return w;
}

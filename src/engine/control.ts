import { activeSmokes, CELL, MOLLY_DURATION, popAt } from './grid';
import { FOV, type TacticalEngine } from './predict';
import { simPlayersAt, SIM_DT, type Simulation } from './combat';
import { bakeRoute, playersAt } from './timeline';
import type { BoardState, Player, Vec2 } from './types';

/** Who owns a cell of the map at a given round time. */
export enum Ctl {
  None = 0, // Ts can reach it unseen, but not yet at this round time
  CtCross = 1, // watched by 2+ CTs
  CtSeen = 2, // watched by one CT
  CtZone = 3, // behind CT lines: Ts can't get here without walking through CT vision
  Denied = 4, // burning molotov
  Contested = 5, // Ts can be here unseen, but a CT can get there about as fast
  TZone = 6, // Ts can be here unseen and before any CT / ground T players have walked
  TSeen = 7, // watched by a T player
  TSide = 8, // T players are closer than any CT (front line)
}

const CONTEST_WINDOW = 1.5; // seconds
const FRONT_WINDOW = 0.75; // seconds; width of the front line between placed teams
const TRAIL_R = 10; // radar px either side of a T route that counts as walked
const REACTION = 0.4; // matches the engine's spawn reaction delay

export interface ControlMap {
  cls: Uint8Array;
  /** Territory per cell: +1 firm CT … 0 contested … −1 firm T (NaN off the floor). */
  owner: Float32Array;
  /** Cells on the front line between CT and T ground. */
  front: Uint8Array;
  /** Cells someone is watching (1 = CT, 2 = T, 3 = both). */
  watched: Uint8Array;
  /** Ownership of each named area: share of its floor held by each side. */
  zones: { name: string; pos: Vec2; ct: number; t: number; contested: number; tArrive: number; watchers: number }[];
  /** Fraction of walkable floor per bucket. */
  share: { ct: number; contested: number; t: number; neutral: number };
  /** Status of each named callout. */
  callouts: { name: string; cls: Ctl; tArrive: number; watchers: number }[];
  /** Players at their animated positions for this round time. */
  live: Player[];
}

/**
 * Classifies every walkable cell at round time `t` from the CTs' positions, facing and
 * sightlines, their utility, and how fast Ts can arrive from spawn.
 */
export function computeControl(engine: TacticalEngine, board: BoardState, t: number, sim?: Simulation | null): ControlMap {
  const g = engine.grid;
  const n = g.w * g.h;
  // Everyone where their route (and, with combat, the fights) has taken them at time t. Dead players drop out.
  const live = sim ? simPlayersAt(sim, board.players, t) : playersAt(engine, board.players, t);
  const cts = live.filter(p => p.side === 'CT');
  const ts = live.filter(p => p.side === 'T');
  const tMode = ts.length > 0; // placed Ts replace the "Ts flow out of spawn" assumption
  const smokes = activeSmokes(board.utility, t, engine.map.radar.scale);

  // 1. Vision: count distinct players of each side watching each cell (cone-limited).
  const vision = (team: Player[]) => {
    const seen = new Uint8Array(n);
    const stamp = new Int32Array(n).fill(-1);
    team.forEach((p, k) => g.castVision(p.pos, p.facing ?? engine.facing(p), FOV, smokes, i => {
      if (stamp[i] !== k) { stamp[i] = k; if (seen[i] < 255) seen[i]++; }
    }));
    return seen;
  };
  const seen = vision(cts);
  const seenT = vision(ts);

  // 2. Molotovs deny ground while burning.
  const mollyR = 120 / engine.map.radar.scale;
  const mollies = board.utility.filter(u => u.type === 'molotov' && t >= popAt(u) && t <= popAt(u) + MOLLY_DURATION);
  const denied = new Uint8Array(n);
  if (mollies.length) for (let i = 0; i < n; i++) if (g.walk[i] && mollies.some(m => near(g, i, m.pos, mollyR))) denied[i] = 1;

  // 3. Ground T players have already walked (their route up to now).
  const trail = new Uint8Array(n);
  for (const p of board.players.filter(q => q.side === 'T')) {
    if (sim) {
      // walked ground = simulated positions so far (stops where they died)
      const i = sim.ids.indexOf(p.id);
      const last = Math.min(sim.steps - 1, Math.floor(Math.min(t, sim.deathT[i]) / SIM_DT));
      for (let k = 0; k <= last; k += 2) stampDisc(g, trail, { x: sim.x[i][k], y: sim.y[i][k] }, TRAIL_R);
      continue;
    }
    const baked = bakeRoute(engine, p);
    if (!baked || t <= baked.start) continue;
    for (let k = 1; k < baked.pts.length && baked.times[k - 1] < t; k++) {
      const a = baked.pts[k - 1], b = baked.pts[k];
      const f = Math.min(1, (t - baked.times[k - 1]) / (baked.times[k] - baked.times[k - 1] || 1));
      const steps = Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) * f) / 2);
      for (let s = 0; s <= steps; s++) stampDisc(g, trail, { x: a.x + (b.x - a.x) * f * (s / steps || 0), y: a.y + (b.y - a.y) * f * (s / steps || 0) }, TRAIL_R);
    }
  }

  // 4. Where can Ts get without being seen? CT-watched and burning cells are walls for them.
  const blocked = new Uint8Array(n);
  for (let i = 0; i < n; i++) blocked[i] = seen[i] > 0 || denied[i] ? 1 : 0;
  const kT = engine.secPerPx('T', 'rifle');
  const tFree = tMode
    ? g.distanceField(ts.map(p => p.pos), { blocked })
    : cts.length ? g.distanceField(engine.map.spawns.T, { blocked }) : null;

  // 5. How fast can a CT get there (not through T sightlines when Ts are placed).
  const kC = engine.secPerPx('CT', 'rifle');
  const ctBlocked = tMode ? seenT : undefined;
  const ctReach = cts.length
    ? g.distanceField(cts.map(p => p.pos), {
        blocked: ctBlocked,
        start: cts.map(p => {
          const base = board.players.find(q => q.id === p.id) ?? p;
          return (tMode ? Math.max(0, engine.readyAt(base) - t) : engine.readyAt(base)) / kC;
        }),
      })
    : new Float64Array(n).fill(Infinity);

  const cls = new Uint8Array(n);
  const owner = new Float32Array(n).fill(NaN);
  const front = new Uint8Array(n);
  const watched = new Uint8Array(n);
  const tSeen = new Float64Array(n).fill(Infinity);
  const count = new Array(9).fill(0);
  let walkable = 0;
  for (let i = 0; i < n; i++) {
    if (!g.walk[i]) continue;
    walkable++;
    let c: Ctl;
    const ct = ctReach[i] * kC; // tMode: seconds from now; spawn mode: absolute round time
    const tt = tFree ? (tMode ? tFree[i] * kT : tFree[i] * kT + REACTION) : engine.tTime[i];
    tSeen[i] = tMode ? t + tt : tt;
    if (denied[i]) c = Ctl.Denied;
    else if (seen[i] && seenT[i]) c = Ctl.Contested; // both sides have eyes on it: a fight
    else if (seen[i] >= 2) c = Ctl.CtCross;
    else if (seen[i] === 1) c = Ctl.CtSeen;
    else if (seenT[i]) c = Ctl.TSeen;
    else if (trail[i]) c = Ctl.TZone;
    else if (tMode) {
      if (!Number.isFinite(tt) || ct + FRONT_WINDOW < tt) c = Ctl.CtZone;
      else if (tt + FRONT_WINDOW < ct) c = Ctl.TSide;
      else c = Ctl.Contested;
    } else if (!Number.isFinite(tt) || ct + CONTEST_WINDOW < tt) c = Ctl.CtZone;
    else if (tt > t) c = Ctl.None;
    else if (ct <= tt + CONTEST_WINDOW) c = Ctl.Contested;
    else c = Ctl.TZone;
    cls[i] = c;
    count[c]++;
    owner[i] = ownership(c, seen[i], seenT[i], ct, tt, t, tMode);
    watched[i] = (seen[i] ? 1 : 0) | (seenT[i] ? 2 : 0);
  }
  // Front line: floor cells whose neighbour belongs to the other side (or open fights).
  for (let i = 0; i < n; i++) {
    if (!g.walk[i]) continue;
    if (watched[i] === 3) { front[i] = 1; continue; }
    const o = owner[i];
    if (Math.abs(o) < FRONT_MIN) continue;
    const x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const j = (y + dy) * g.w + x + dx;
      if (x + dx >= g.w || y + dy >= g.h || !g.walk[j]) continue;
      if (Math.abs(owner[j]) >= FRONT_MIN && Math.sign(owner[j]) !== Math.sign(o)) { front[i] = 1; front[j] = 1; }
    }
  }
  const w = Math.max(1, walkable);
  const share = {
    ct: (count[Ctl.CtCross] + count[Ctl.CtSeen] + count[Ctl.CtZone] + count[Ctl.Denied]) / w,
    contested: count[Ctl.Contested] / w,
    t: (count[Ctl.TZone] + count[Ctl.TSeen] + count[Ctl.TSide]) / w,
    neutral: count[Ctl.None] / w,
  };

  const callouts = engine.map.callouts
    .filter(c => !/spawn/i.test(c.name))
    .map(c => {
      const i = g.snap(c.pos);
      return { name: c.name, cls: i >= 0 ? (cls[i] as Ctl) : Ctl.None, tArrive: i >= 0 ? tSeen[i] : Infinity, watchers: i >= 0 ? seen[i] : 0 };
    });

  // Areas: every floor cell belongs to its nearest callout (within reach); share held by each side.
  const named = engine.map.callouts.filter(c => !/spawn/i.test(c.name));
  const acc = named.map(() => ({ ct: 0, t: 0, mid: 0, n: 0 }));
  if (named.length)
    for (let i = 0; i < n; i++) {
      if (!g.walk[i]) continue;
      const x = ((i % g.w) + 0.5) * CELL, y = (((i / g.w) | 0) + 0.5) * CELL;
      let best = -1, bd = ZONE_REACH_PX * ZONE_REACH_PX;
      named.forEach((c, k) => { const d = (c.pos.x - x) ** 2 + (c.pos.y - y) ** 2; if (d < bd) { bd = d; best = k; } });
      if (best < 0) continue;
      const a = acc[best];
      a.n++;
      if (owner[i] > FRONT_MIN) a.ct++; else if (owner[i] < -FRONT_MIN) a.t++; else a.mid++;
    }
  const zones = named.map((c, k) => {
    const a = acc[k], m = Math.max(1, a.n);
    const i = g.snap(c.pos);
    return { name: c.name, pos: c.pos, ct: a.ct / m, t: a.t / m, contested: a.mid / m, tArrive: i >= 0 ? tSeen[i] : Infinity, watchers: i >= 0 ? seen[i] : 0 };
  });

  return { cls, owner, front, watched, zones, share, callouts, live };
}

const FRONT_MIN = 0.15;
const ZONE_REACH_PX = 120;

/**
 * Territory value for one cell. Eyes on a spot decide it outright; otherwise whoever gets there
 * first owns it, more firmly the bigger the time gap. Ground Ts can't reach yet is CT-leaning but faint.
 */
function ownership(c: Ctl, ctEyes: number, tEyes: number, ct: number, tt: number, t: number, tMode: boolean): number {
  if (c === Ctl.Denied) return 0;
  if (ctEyes && tEyes) return 0;
  if (ctEyes) return Math.min(1, 0.7 + 0.15 * ctEyes);
  if (tEyes) return -Math.min(1, 0.7 + 0.15 * tEyes);
  if (c === Ctl.TZone) return -0.9;
  if (!Number.isFinite(tt)) return 0.9;
  const lead = Math.tanh((tt - ct) / 3); // + = CTs get there first
  if (!tMode && tt > t) return lead > 0 ? lead * 0.85 : lead * 0.35; // Ts not there yet: only a threat
  return lead * 0.9;
}

function stampDisc(g: TacticalEngine['grid'], out: Uint8Array, c: Vec2, r: number) {
  const r2 = Math.ceil(r / CELL);
  const cx = Math.floor(c.x / CELL), cy = Math.floor(c.y / CELL);
  for (let dy = -r2; dy <= r2; dy++)
    for (let dx = -r2; dx <= r2; dx++) {
      if (dx * dx + dy * dy > r2 * r2) continue;
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < g.w && y < g.h) out[y * g.w + x] = 1;
    }
}

function near(g: TacticalEngine['grid'], i: number, c: Vec2, r: number) {
  const x = ((i % g.w) + 0.5) * CELL, y = (Math.floor(i / g.w) + 0.5) * CELL;
  return (x - c.x) ** 2 + (y - c.y) ** 2 < r * r;
}

export const CTL_COLORS: Record<Ctl, [number, number, number, number] | null> = {
  [Ctl.None]: null,
  [Ctl.CtCross]: [40, 130, 255, 150],
  [Ctl.CtSeen]: [78, 163, 255, 105],
  [Ctl.CtZone]: [78, 163, 255, 40],
  [Ctl.Denied]: [255, 90, 31, 110],
  [Ctl.Contested]: [255, 200, 40, 125],
  [Ctl.TZone]: [232, 120, 40, 115],
  [Ctl.TSeen]: [240, 110, 30, 160],
  [Ctl.TSide]: [232, 120, 40, 45],
};

export const CTL_LABEL: Record<Ctl, string> = {
  [Ctl.None]: 'Not reached yet',
  [Ctl.CtCross]: 'Crossfire',
  [Ctl.CtSeen]: 'Watched',
  [Ctl.CtZone]: 'CT ground',
  [Ctl.Denied]: 'Molotov',
  [Ctl.Contested]: 'Contested',
  [Ctl.TZone]: 'T control',
  [Ctl.TSeen]: 'T vision',
  [Ctl.TSide]: 'T side',
};

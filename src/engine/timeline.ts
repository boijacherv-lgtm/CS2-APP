import type { TacticalEngine } from './predict';
import type { Player, Vec2 } from './types';

const WALK_FACTOR = 0.52; // shift-walk speed vs running

/** A route resolved onto the walkable floor, with the round time at every corner. */
export interface BakedRoute {
  pts: Vec2[];
  times: number[];
  start: number;
  end: number;
  /** Waypoints the user placed that could not be reached (route stops before them). */
  unreachable: boolean;
}

export interface LiveState {
  pos: Vec2;
  /** Look direction: travel direction while moving, last heading after arriving. */
  facing: number | undefined;
  moving: boolean;
}

const cache = new Map<string, BakedRoute | null>();

export function bakeRoute(engine: TacticalEngine, p: Player): BakedRoute | null {
  const r = p.route;
  if (!r || !r.pts.length) return null;
  const key = `${engine.map.id}|${engine.map.radarImage}|${p.side}|${p.weapon}|${p.pos.x},${p.pos.y}|${JSON.stringify(r)}`;
  if (cache.has(key)) return cache.get(key)!;

  const secPerPx = engine.secPerPx(p.side, p.weapon) / (r.mode === 'walk' ? WALK_FACTOR : 1);
  const pts: Vec2[] = [p.pos];
  let unreachable = false;
  for (const w of r.pts) {
    const leg = engine.grid.shortestPath(pts[pts.length - 1], w);
    if (!leg) { unreachable = true; break; }
    pts.push(...leg.slice(1));
  }
  const times = [r.start];
  for (let i = 1; i < pts.length; i++)
    times.push(times[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) * secPerPx);
  const baked = pts.length > 1 ? { pts, times, start: r.start, end: times[times.length - 1], unreachable } : null;
  if (cache.size > 500) cache.clear();
  cache.set(key, baked);
  return baked;
}

export function liveState(p: Player, baked: BakedRoute | null, t: number): LiveState {
  if (!baked || t <= baked.start) return { pos: p.pos, facing: p.facing, moving: false };
  const { pts, times } = baked;
  if (t >= baked.end) {
    const n = pts.length;
    return { pos: pts[n - 1], facing: heading(pts[n - 2], pts[n - 1]), moving: false };
  }
  let i = 1;
  while (times[i] < t) i++;
  const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
  const a = pts[i - 1], b = pts[i];
  return { pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, facing: heading(a, b), moving: true };
}

/** Every player as they stand at round time t (position + facing). */
export function playersAt(engine: TacticalEngine, players: Player[], t: number): Player[] {
  return players.map(p => {
    const s = liveState(p, bakeRoute(engine, p), t);
    return s.pos === p.pos && s.facing === p.facing ? p : { ...p, pos: s.pos, facing: s.facing };
  });
}

/** Length of the animation: last route end plus a few seconds to watch the result. */
export function timelineEnd(engine: TacticalEngine, players: Player[]) {
  const ends = players.map(p => bakeRoute(engine, p)?.end ?? 0);
  return Math.min(115, Math.max(20, ...ends) + 4);
}

const heading = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);

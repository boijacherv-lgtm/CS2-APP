// Holding a spot means watching a way in: a stay only counts as a hold when the player faced the way the enemy comes.
// "Ways in" to a spot are the first stretch of the shortest walk from it toward the enemy's spawn spots (spread out, so
// a spot with two entrances gets both); "faced" is the view within AIM_DEG of one of them, most of the time.
import type { TacticalEngine } from './predict';
import type { DemoRound } from './recap';
import type { Side, Vec2 } from './types';
import { worldToRadar } from './coords';

/** How far off a way in the view can be and still count as watching it (degrees, either side). */
export const AIM_DEG = 40;
/** How much of the stay the player has to watch a way in for it to be a hold. */
export const AIM_SHARE = 0.5;
/** How far along the path the "way in" points (world units): far enough to pass the corner the spot looks at. */
const AHEAD = 450;

const cache = new Map<string, number[]>();
/** Directions (world radians, as CS's yaw) of the ways an enemy of `mine` reaches the spot `at` (radar px). */
export function waysIn(engine: TacticalEngine, at: Vec2, mine: Side): number[] {
  const cell = engine.grid.snap(at);
  const key = `${engine.map.id}|${engine.map.radarImage}|${cell}|${mine}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spawns = engine.map.spawns as Partial<Record<Side, Vec2[]>> | undefined;
  const targets = spawns?.[mine === 'CT' ? 'T' : 'CT'] ?? [];
  const scale = engine.map.radar.scale, out: number[] = [];
  for (const goal of targets) {
    if (Math.hypot(goal.x - at.x, goal.y - at.y) * scale < 200) continue; // standing on it: no way in from there
    const path = engine.grid.shortestPath(at, goal);
    if (!path || path.length < 2) continue;
    let walked = 0, p = path[path.length - 1];
    for (let i = 1; i < path.length; i++) {
      walked += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) * scale;
      if (walked >= AHEAD) { p = path[i]; break; }
    }
    // radar y grows downward, world y upward
    out.push(Math.atan2(-(p.y - at.y), p.x - at.x));
  }
  if (cache.size > 20000) cache.clear();
  cache.set(key, out);
  return out;
}

const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The share (0–1) of a player's stay from `from` to `to` (round seconds) spent facing a way in; null without view data. */
export function aimedShare(engine: TacticalEngine, r: DemoRound, id: string, from: number, to: number): number | null {
  const f = r.frames.players[id], ft = r.frames.t;
  if (!f?.yaw?.length || !ft.length) return null;
  const lim = (AIM_DEG * Math.PI) / 180;
  let n = 0, on = 0;
  for (let k = 0; k < ft.length; k++) {
    if (ft[k] < from || ft[k] > to || !f.alive[k]) continue;
    const at = worldToRadar({ x: f.x[k], y: f.y[k] }, engine.map.radar);
    const ways = waysIn(engine, at, f.side);
    if (!ways.length) continue;
    const yaw = (f.yaw[k] * Math.PI) / 180;
    n++;
    if (ways.some(w => off(yaw, w) <= lim)) on++;
  }
  return n ? on / n : null;
}

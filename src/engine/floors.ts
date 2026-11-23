/**
 * Which radar (floor) each thing in a round belongs to, for maps with two (Nuke, Vertigo, Train): players by the height
 * in their track, the bomb by the planter's height, kills by the victim's. The ranges come from the map's levels
 * (map/floors.ts).
 */
import type { MapLevel, RadarCalib, SiteId, Vec2 } from './types';
import { levelOf, levelsOfMap, SITE_FLOOR } from '../map/floors';
import { worldToRadar } from './coords';
import type { DemoRound } from './recap';

/** The sample index of time t in a round's tracks (the last one at or before t). */
export function frameAt(r: DemoRound, t: number): number {
  const ft = r.frames.t;
  let lo = 0, hi = ft.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ft[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

/** A player's height at time t, when the track has it. */
export function playerZ(r: DemoRound, id: string, t: number): number | undefined {
  const p = r.frames.players[id];
  return p?.z?.[frameAt(r, t)];
}

/** The planted bomb's height: the plant event's own, else the planter's at that moment (matches saved before it was kept). */
export function plantZ(r: DemoRound): number | undefined {
  const e = (r.bomb ?? []).find(b => b.kind === 'plant');
  if (!e) return undefined;
  return e.z ?? playerZ(r, e.id, e.t);
}

/** The floor the bomb was planted on (null: no plant). */
export function plantFloor(r: DemoRound, levels: MapLevel[]): number | null {
  const e = (r.bomb ?? []).find(b => b.kind === 'plant');
  return e ? levelOf(levels, plantZ(r)) : null;
}

const memory = new Map<string, number>();
/** The floor a player is on at time t. Near the split they keep the one they had (the last call for them). */
export function playerFloor(r: DemoRound, id: string, t: number, levels: MapLevel[], key = ''): number {
  if (levels.length < 2) return 0;
  const k = `${key}|${id}`;
  const f = levelOf(levels, playerZ(r, id, t), memory.get(k));
  memory.set(k, f);
  return f;
}

/**
 * Which bomb site a round's plant was on, and its floor (0 upper, 1 lower): the nearest site on the plant's floor, where
 * a map puts its sites on different floors (SITE_FLOOR), else the nearest. Null when the round had no plant.
 */
export function plantSite(map: { id: string; radar: RadarCalib; sites: Partial<Record<SiteId, { center: Vec2 }>> }, r: DemoRound): { site: SiteId; floor: number } | null {
  const e = (r.bomb ?? []).find(b => b.kind === 'plant');
  if (!e) return null;
  const floor = levelOf(levelsOfMap(map.id), plantZ(r));
  const at = worldToRadar({ x: e.x, y: e.y }, map.radar);
  const only = SITE_FLOOR[map.id];
  let best: SiteId | null = null, near = Infinity;
  for (const site of ['A', 'B'] as SiteId[]) {
    const c = map.sites[site]?.center;
    if (!c || (only?.[site] !== undefined && only[site] !== floor)) continue;
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d < near) { near = d; best = site; }
  }
  return best ? { site: best, floor } : null;
}
/** "B" or "B, lower": how a card or tooltip names it on a map with two floors. */
export const siteText = (p: { site: SiteId; floor: number }, twoFloors: boolean) => `${p.site}${twoFloors && p.floor > 0 ? ', lower' : ''}`;

/**
 * Maps with two radars (Nuke, Vertigo, Train): which radar a height belongs to. Each level in maps.json carries the
 * range of heights it covers; nothing here is specific to a map.
 */
import type { MapLevel, SiteId } from '../engine/types';
import maps from './generated/maps.json';

/** Units either side of the split where a player keeps the floor they were on, so stairs and ramps don't flicker. */
export const FLOOR_HYSTERESIS = 40;

type Ranged = Pick<MapLevel, 'altitude'>;

/**
 * The level (index into the map's levels) a height belongs to. `prev` is the level they were on a moment ago: near
 * the split they stay on it. No height, or a map with one level, is level 0.
 */
export function levelOf(levels: Ranged[], z: number | null | undefined, prev?: number): number {
  if (levels.length < 2 || z == null || !Number.isFinite(z)) return prev ?? 0;
  const inside = (i: number, pad: number) => {
    const a = levels[i]?.altitude;
    return !!a && z >= a[0] - pad && z <= a[1] + pad;
  };
  if (prev !== undefined && prev < levels.length && inside(prev, FLOOR_HYSTERESIS)) return prev;
  const hit = levels.findIndex((_, i) => inside(i, 0));
  return hit >= 0 ? hit : prev ?? 0;
}

/** A map's levels, from the generated data (no engine needed). */
export const levelsOfMap = (mapId: string): MapLevel[] => (maps as unknown as { id: string; levels: MapLevel[] }[]).find(m => m.id === mapId)?.levels ?? [];

/** Maps where a bomb site is on one floor only: a plant there belongs to the site of its floor (Nuke's B is under A). */
export const SITE_FLOOR: Record<string, Partial<Record<SiteId, number>>> = { de_nuke: { A: 0, B: 1 } };

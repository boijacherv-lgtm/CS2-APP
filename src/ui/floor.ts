import { MAPS } from '../map/catalog';
import { levelOf } from '../map/floors';
import { playerFloor, playerZ, plantFloor } from '../engine/floors';
import { useStore } from '../store';
import type { Store as StoreState } from '../store';

/** How many radars a map has (1 for most; 2 for Nuke, Vertigo and Train). */
export const floorCount = (mapId: string) => MAPS.find(m => m.id === mapId)?.levels.length ?? 1;
export const FLOOR_NAME = ['Upper', 'Lower'];

let held = { key: '', floor: 0 };
/**
 * The radar the review shows: the chosen one, or on Auto the plant's once it's down, else the floor of the move you
 * picked, else of the player you follow, else the one it showed last (upper at first).
 */
export function viewFloor(s: StoreState): number {
  const rv = s.review;
  if (!rv || s.mode !== 'review') return 0;
  const levels = MAPS.find(m => m.id === rv.data.map)?.levels ?? [];
  if (levels.length < 2) return 0;
  if (s.reviewFloor !== 'auto') return Math.min(s.reviewFloor, levels.length - 1);
  const key = `${rv.data.map}|${rv.round}`;
  if (held.key !== key) held = { key, floor: 0 };
  const r = rv.data.rounds[rv.round];
  const plant = (r.bomb ?? []).find(b => b.kind === 'plant');
  let f: number | null = null;
  if (plant && s.time >= plant.t) f = plantFloor(r, levels);
  if (f === null && s.feedPick) {
    const kill = r.kills.find(k => Math.abs(k.t - s.feedPick!.t) < 0.5);
    if (kill) f = levelOf(levels, playerZ(r, kill.victim, kill.t), held.floor);
  }
  if (f === null && s.selectedId && r.frames.players[s.selectedId]) f = playerFloor(r, s.selectedId, s.time, levels, `view${key}`);
  held.floor = f ?? held.floor;
  return held.floor;
}
export const useFloor = () => useStore(viewFloor);

import type { Side, UtilType, Vec2 } from '../engine/types';

/**
 * Grenade line-ups: where you stand, where it lands, how you throw it.
 * Built-in ones are approximate starting points placed on the radar; line them up in-game
 * and save your exact version (custom line-ups live in this browser's storage).
 */

export type Technique = 'throw' | 'jump-throw' | 'run-jump-throw' | 'walk-throw' | 'right-click';

export interface Lineup {
  id: string;
  map: string;
  level: number;
  name: string;
  type: UtilType;
  side: Side | 'any';
  from: Vec2;
  to: Vec2;
  technique: Technique;
  notes?: string;
  custom?: boolean;
}

/** Horizontal grenade speed by technique (world units per second), roughly. */
const SPEED: Record<Technique, number> = { 'right-click': 380, 'walk-throw': 620, throw: 680, 'jump-throw': 760, 'run-jump-throw': 900 };

/**
 * Seconds from release until the grenade does its thing: smokes bloom after landing and
 * settling, molotovs burn on landing, flashes and HEs explode on a fuse.
 */
export function flightTime(l: Pick<Lineup, 'from' | 'to' | 'technique' | 'type'>, unitsPerPx: number): number {
  const air = 0.35 + (Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y) * unitsPerPx) / SPEED[l.technique];
  if (l.type === 'flash' || l.type === 'he') return Math.min(1.65, Math.max(0.9, air));
  if (l.type === 'smoke') return Math.min(5, air + 0.6);
  return Math.min(4, air);
}

const L = (map: string, name: string, type: UtilType, side: Side | 'any', from: [number, number], to: [number, number], technique: Technique, notes: string): Lineup => ({
  id: `${map}:${name}`, map, level: 0, name, type, side, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, technique, notes,
});

export const BUILTIN_LINEUPS: Lineup[] = [
  // Mirage — T side
  L('de_mirage', 'Window smoke', 'smoke', 'T', [892, 336], [400, 492], 'jump-throw', 'From T spawn: cuts the Window AWP off Mid.'),
  L('de_mirage', 'CT smoke (A)', 'smoke', 'T', [880, 560], [482, 718], 'jump-throw', 'From the top of A ramp: blocks CT/Ticket rotations onto A.'),
  L('de_mirage', 'Jungle smoke', 'smoke', 'T', [850, 590], [505, 640], 'jump-throw', 'From A ramp: blocks Jungle/Connector for the A execute.'),
  L('de_mirage', 'Stairs smoke', 'smoke', 'T', [830, 610], [702, 690], 'throw', 'From A ramp: covers the Stairs player.'),
  L('de_mirage', 'Connector smoke', 'smoke', 'T', [705, 455], [513, 575], 'throw', 'From Top Mid: blocks Connector for a Mid take.'),
  L('de_mirage', 'Short (Catwalk) smoke', 'smoke', 'T', [702, 462], [415, 395], 'jump-throw', 'From Top Mid: isolates Short for the mid-to-B split.'),
  L('de_mirage', 'Market window smoke', 'smoke', 'T', [470, 235], [245, 440], 'jump-throw', 'From Apartments: blocks the Market window on a B hit.'),
  L('de_mirage', 'A ramp pop flash', 'flash', 'T', [790, 600], [715, 645], 'throw', 'Bounce it over the ramp corner as the entry swings.'),
  L('de_mirage', 'Apps flash (B)', 'flash', 'T', [380, 238], [300, 225], 'throw', 'Pop it over the B apps exit before peeking.'),
  // Mirage — CT side
  L('de_mirage', 'Top Mid smoke', 'smoke', 'CT', [400, 520], [715, 440], 'jump-throw', 'From Window/ladder room: slows a fast Mid take.'),
  L('de_mirage', 'Palace molotov', 'molotov', 'CT', [640, 760], [692, 806], 'throw', 'From A site: delays a Palace push.'),
  L('de_mirage', 'Ramp molotov', 'molotov', 'CT', [660, 700], [722, 645], 'throw', 'From Stairs: burns the A ramp entry.'),
  L('de_mirage', 'Apps molotov', 'molotov', 'CT', [255, 300], [214, 215], 'throw', 'From B site: burns the Apps exit on a rush.'),
  L('de_mirage', 'Underpass molotov', 'molotov', 'CT', [430, 470], [482, 345], 'throw', 'From bottom Mid: stops an Underpass lurk.'),
  // Dust II
  L('de_dust2', 'Xbox smoke', 'smoke', 'T', [440, 900], [455, 560], 'jump-throw', 'From T spawn: covers the Mid-to-Short cross.'),
  L('de_dust2', 'CT smoke (A)', 'smoke', 'T', [858, 520], [700, 230], 'jump-throw', 'From Long A: blocks CT rotations onto A.'),
  L('de_dust2', 'Long corner smoke', 'smoke', 'T', [860, 600], [880, 300], 'throw', 'From Long doors: blocks the A site long angle.'),
  L('de_dust2', 'B doors smoke', 'smoke', 'T', [140, 420], [267, 135], 'jump-throw', 'From upper tunnels: cuts the B doors rotation.'),
  L('de_dust2', 'Long doors molotov', 'molotov', 'CT', [858, 440], [860, 560], 'throw', 'From Long A: delays a Long push.'),
  L('de_dust2', 'Tunnels flash (CT)', 'flash', 'CT', [180, 260], [130, 380], 'throw', 'From B site: blinds a B tunnels rush.'),
];

const KEY = 'cs2t:lineups';

export function loadCustomLineups(): Lineup[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function saveCustomLineups(list: Lineup[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable: kept in memory only */ }
}

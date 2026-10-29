/**
 * Deadlock's static data (generated/, from deadlock-api.com by `npm run dl:assets`): heroes, the map's objectives,
 * lanes and camps, and where a game position lands on the minimap (public/images/maps/deadlock.png).
 */
import HEROES from './generated/heroes.json';
import MAP from './generated/map.json';

export interface DlHero { id: number; name: string; color: string; icon: string | null; card: string | null }
export const DL_HEROES = HEROES as DlHero[];
const byId = new Map(DL_HEROES.map(h => [h.id, h]));
export const heroOf = (id: number): DlHero => byId.get(id) ?? { id, name: `Hero ${id}`, color: '#888888', icon: null, card: null };

export const DL_MAP = MAP;
export const DL_MAP_IMAGE = '/images/maps/deadlock.png';
export const DL_MAP_FRAME = '/images/maps/deadlock-frame.png';

/** A game position (units) on the minimap, 0–1 across and down (the map is a square 2 × radius wide). */
export function toMap(x: number, y: number): { x: number; y: number } {
  const r = MAP.radius;
  return { x: (x + r) / (2 * r), y: (r - y) / (2 * r) };
}
/** Game units in one minimap width (for distances drawn on the map). */
export const MAP_UNITS = 2 * MAP.radius;

export type DlTeam = 0 | 1;
/** The two teams' names in game, and their colours here. */
export const TEAM_NAME: Record<DlTeam, string> = { 0: 'Amber Hand', 1: 'Sapphire Flame' };
export const TEAM_COLOR: Record<DlTeam, string> = { 0: '#E8A33D', 1: '#5B8DEF' };

/** The three lanes (left to right on the map), by the colour of their zipline. */
export interface DlLane { id: 1 | 3 | 4; name: string; color: string }
export const LANES: DlLane[] = [
  { id: 1, name: 'Yellow', color: '#F1CC30' }, { id: 3, name: 'Blue', color: '#29B1CC' }, { id: 4, name: 'Green', color: '#59B247' },
];
/** The lane a player was assigned in the match data (1 / 4 / 6), as a map lane. */
export const laneOfAssigned = (a: number): DlLane | null => LANES[{ 1: 0, 4: 1, 6: 2 }[a] ?? -1] ?? null;

/** Valve's team objectives (ECitadelTeamObjective): what each id is, and its spot on the map when known. */
export type ObjectiveKind = 'patron' | 'guardian' | 'walker' | 'shrine' | 'base guardian' | 'titan';
export function objectiveOf(id: number): { kind: ObjectiveKind; lane: 1 | 3 | 4 | null; name: string } {
  const lane = (n: number) => (n === 1 || n === 3 || n === 4 ? n : null) as 1 | 3 | 4 | null;
  const laneName = (n: number) => LANES.find(l => l.id === n)?.name ?? `lane ${n}`;
  if (id === 0) return { kind: 'patron', lane: null, name: 'Patron' };
  if (id >= 1 && id <= 4) return { kind: 'guardian', lane: lane(id), name: `${laneName(id)} Guardian` };
  if (id >= 5 && id <= 8) return { kind: 'walker', lane: lane(id - 4), name: `${laneName(id - 4)} Walker` };
  if (id === 9) return { kind: 'titan', lane: null, name: 'Patron (weakened)' };
  if (id === 10 || id === 11) return { kind: 'shrine', lane: null, name: `Shrine ${id - 9}` };
  return { kind: 'base guardian', lane: lane(id - 11), name: `${laneName(id - 11)} Base Guardian` };
}
/** The map data's key for an objective (generated/map.json: `team<0|1>_<key>`). */
export function objectiveKey(id: number): string | null {
  const o = objectiveOf(id);
  // the patron stands in the middle of the base (the map data's "titan" spot)
  return o.kind === 'guardian' ? `tier1_${o.lane}` : o.kind === 'walker' ? `tier2_${o.lane}` : o.kind === 'patron' || o.kind === 'titan' ? 'titan'
    : o.kind === 'shrine' ? `shrine_${id - 9}` : o.kind === 'base guardian' && o.lane ? `base_${o.lane}` : null;
}
/** Where an objective stands on the map (0–1): guardians, walkers, base guardians, shrines and the patron. */
export function objectiveSpot(team: DlTeam, id: number): { x: number; y: number } | null {
  const key = objectiveKey(id);
  const spot = key ? MAP.objectives.find(x => x.id === `team${team}_${key}`) : null;
  return spot ? { x: spot.x, y: spot.y } : null;
}

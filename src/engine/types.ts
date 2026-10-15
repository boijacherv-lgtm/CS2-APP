// Core data model. Geometry is authored in "radar space" (pixels on a 1024x1024 overview),
// which maps 1:1 to game world units through RadarCalib (see coords.ts).

export type Side = 'T' | 'CT';
export type Vec2 = { x: number; y: number };

export interface RadarCalib {
  sizePx: number;
  posX: number;
  posY: number;
  scale: number; // world units per radar pixel
}

/** Walkable floor, rasterised into the nav/visibility grid. */
export type FloorShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'poly'; pts: Vec2[] }
  | { kind: 'path'; pts: Vec2[]; w: number };

export type SiteId = 'A' | 'B';

export interface Chokepoint {
  id: string;
  name: string;
  portal: [Vec2, Vec2]; // segment attackers must cross
  feeds: SiteId[];
  /** Area name used for vulnerability messages ("Mid", "A Ramp"...). */
  area: string;
}

/** Authoring form: a point inside the doorway; the portal is fitted to the walls along `axis`. */
export type ChokepointSpec = Omit<Chokepoint, 'portal'> & { at: Vec2; axis: 'h' | 'v'; maxHalf?: number };

/** Packed walkability bitset produced by tools/build-maps.mjs. */
export interface PackedGrid { size: number; w: number; h: number; bits: string }

export interface MapLevel {
  id: 'upper' | 'lower';
  image: string;
  grid: PackedGrid;
  altitude?: [number, number];
}

export interface Callout {
  name: string;
  pos: Vec2;
  size?: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  radar: RadarCalib;
  radarImage?: string;
  /** Walkable floor: either a packed grid from the official radar, or hand-drawn shapes. */
  grid?: PackedGrid;
  floor?: FloorShape[];
  /** Extra wall polylines carved into the grid (walls the radar only shows as colour edges). */
  walls?: Vec2[][];
  chokepoints: Chokepoint[];
  callouts: Callout[];
  spawns: Record<Side, Vec2[]>;
  /**
   * Seconds after the round starts at which each spawn point is "live". Used on levels players
   * only enter through stairs/ramps (Nuke's lower floor): the entries become spawns with a delay.
   */
  spawnDelay?: Partial<Record<Side, number[]>>;
  sites: Record<SiteId, { center: Vec2; radius: number }>;
  /** Fudge factor on computed travel times until demo calibration exists. */
  timingScale: number;
}

export type Weapon = 'rifle' | 'awp' | 'smg' | 'pistol';
export type UtilType = 'smoke' | 'flash' | 'molotov' | 'he';

export interface Player {
  id: string;
  side: Side;
  pos: Vec2;
  weapon: Weapon;
  /** Exact gun (id from engine/guns.ts). Undefined = the side's default for `weapon`. */
  gun?: string;
  label: string;
  /** View direction in radians (radar space). Undefined = auto-aim toward the enemy's approach. */
  facing?: number;
  /** Planned movement, starting from `pos`. */
  route?: Route;
}

export interface Utility {
  id: string;
  type: UtilType;
  pos: Vec2;
  throwAt: number; // seconds into the round (release)
  /** Seconds from release to pop/landing; defaults per type. Line-ups set it from the throw distance. */
  flight?: number;
  /** Where it's thrown from (line-ups), drawn as an arc to the landing spot. */
  from?: Vec2;
  /** Line-up this grenade came from. */
  lineup?: string;
  /** Real flight path from a demo (release → landing), drawn instead of a generic arc. */
  path?: Vec2[];
  /** How long the smoke/fire lasted (demo); defaults per type. */
  duration?: number;
}

export interface Route {
  /** Waypoints after the start position; the walker path-finds between them. */
  pts: Vec2[];
  /** Round time (s) at which the player starts moving. */
  start: number;
  mode: 'run' | 'walk';
}

export type Econ = 'eco' | 'force' | 'half' | 'full';
export type Phase = 'early' | 'late';

export interface RoundContext {
  userSide: Side;
  phase: Phase;
  economy: { user: Econ; enemy: Econ };
}

export interface BoardState {
  players: Player[];
  utility: Utility[];
  context: RoundContext;
}

import { buildAutoLayer, type AutoLayer } from '../engine/autolayer';
import { CELL, MapGrid } from '../engine/grid';
import { TacticalEngine } from '../engine/predict';
import { MIRAGE_STRATS, type StrategyArchetype } from '../engine/strategies';
import type { Callout, ChokepointSpec, MapDefinition, MapLevel, Player, RadarCalib, SiteId, Vec2, Weapon } from '../engine/types';
import { CALLOUTS } from './callouts';
import generated from './generated/maps.json';

/** Raw entry produced by tools/build-maps.mjs from Valve's radar + overview files. */
interface GeneratedMap {
  id: string;
  name: string;
  radar: RadarCalib;
  spawns: { T?: Vec2; CT?: Vec2 };
  bombs: { A?: Vec2; B?: Vec2 };
  levels: MapLevel[];
}

/** Hand-authored tactical layer on top of the radar (chokepoints, callouts, strats). */
interface MapExtras {
  chokepoints?: ChokepointSpec[];
  callouts?: Callout[];
  walls?: Vec2[][];
  sites?: Partial<Record<SiteId, Vec2>>;
  /** Sites left out of the generated layer (e.g. on a lower level the 2D grid can't reach). */
  skipSites?: SiteId[];
  /** Generated layer is unreliable (walls drawn only as lines, multi-level sites). */
  rough?: string;
  strats?: StrategyArchetype[];
  presets?: Record<string, [x: number, y: number, weapon?: Weapon][]>;
  /** T plays: start spot, waypoints (path-found between), leave time, weapon. */
  tPlays?: Record<string, { at: [number, number]; via: [number, number][]; start?: number; mode?: 'run' | 'walk'; weapon?: Weapon }[]>;
  /**
   * For levels nobody spawns on: where each side comes in, the matching spot on the upper level,
   * and the extra seconds the stairs/ramp take. Arrival = upper-level travel time + extra.
   */
  entries?: Partial<Record<'T' | 'CT', { at: [number, number]; from: [number, number]; extra: number; name: string }[]>>;
  /** Tactical layer for the lower radar (Nuke B, Vertigo lower, Train lower). */
  lower?: MapExtras;
}

/** Extras for one level of a map (level 0 = the main radar). */
const ex = (mapId: string, level: number): MapExtras => (level === 0 ? EXTRAS[mapId] ?? {} : EXTRAS[mapId]?.lower ?? {});

const p = (x: number, y: number) => ({ x, y });

const EXTRAS: Record<string, MapExtras> = {
  de_mirage: {
    chokepoints: [
      { id: 'top_mid', name: 'Top Mid', area: 'Mid', feeds: ['A', 'B'], at: p(715, 402), axis: 'h' },
      { id: 'short', name: 'Short / Catwalk', area: 'Mid', feeds: ['B'], at: p(410, 392), axis: 'h' },
      { id: 'connector', name: 'Connector', area: 'Mid', feeds: ['A'], at: p(513, 560), axis: 'h' },
      { id: 'underpass', name: 'Underpass', area: 'Mid', feeds: ['B'], at: p(482, 334), axis: 'h' },
      { id: 'ramp', name: 'A Ramp', area: 'A Ramp', feeds: ['A'], at: p(708, 668), axis: 'v' },
      { id: 'palace', name: 'Palace', area: 'Palace', feeds: ['A'], at: p(690, 808), axis: 'v' },
      { id: 'apps', name: 'B Apps', area: 'B Apps', feeds: ['B'], at: p(212, 203), axis: 'h', maxHalf: 24 },
    ],
    walls: [
      [p(248, 208), p(348, 208)], // apartments balcony rail over B
      [p(401, 205), p(401, 272)],
    ],
    callouts: [
      // from the team's own Mirage callout map (fitted to the game's spawn and bomb-site markers); minor = only when
      // zoomed in or 'All callout names' is on
      { name: 'B Apps', pos: p(292, 184) }, { name: 'Van', pos: p(187, 198), minor: true }, { name: 'Apps', pos: p(443, 227), minor: true },
      { name: 'Underpass', pos: p(484, 259) }, { name: 'Bench', pos: p(128, 277) }, { name: 'B Short', pos: p(417, 303) },
      { name: 'Boost', pos: p(461, 335), minor: true }, { name: 'Trash', pos: p(158, 359), minor: true }, { name: '90', pos: p(314, 379), minor: true },
      { name: 'Ladder Room', pos: p(417, 369), minor: true }, { name: 'Kitchen Door', pos: p(175, 414), minor: true },
      { name: 'Kitchen Window', pos: p(252, 405), minor: true }, { name: 'Kitchen', pos: p(279, 455) }, { name: 'Short', pos: p(550, 422) },
      { name: 'Window', pos: p(408, 465) }, { name: 'Mid Bench', pos: p(443, 487), minor: true }, { name: 'Mid', pos: p(544, 472) },
      { name: 'Top Mid', pos: p(709, 465) }, { name: 'Start', pos: p(687, 392), minor: true }, { name: 'T Spawn', pos: p(892, 359) },
      { name: 'Chair', pos: p(590, 519), minor: true }, { name: 'Water', pos: p(696, 519), minor: true }, { name: 'Connector', pos: p(508, 551) },
      { name: 'Jungle', pos: p(417, 624) }, { name: 'Stairs', pos: p(544, 650) }, { name: 'Tetris', pos: p(616, 639) },
      { name: 'A Ramp', pos: p(727, 657) }, { name: 'Under Palace', pos: p(655, 743), minor: true }, { name: 'Firebox', pos: p(519, 743) },
      { name: 'Default', pos: p(584, 755), minor: true }, { name: 'Ninja', pos: p(597, 807) }, { name: 'CT', pos: p(392, 806) },
      { name: 'Ticket', pos: p(469, 852) }, { name: 'CT Spawn', pos: p(292, 717) }, { name: 'Palace', pos: p(687, 800) },
      { name: 'Pillars', pos: p(763, 771), minor: true }, { name: 'TV', pos: p(735, 171), minor: true },
    ],
    strats: MIRAGE_STRATS,
    tPlays: {
      'A execute': [
        { at: [885, 350], via: [[880, 520], [740, 640], [640, 690]], start: 6 },
        { at: [905, 365], via: [[880, 520], [750, 645], [660, 720]], start: 6.5 },
        { at: [925, 385], via: [[900, 580], [820, 800], [690, 808], [610, 790]], start: 5 },
        { at: [895, 405], via: [[900, 580], [820, 800], [690, 808], [600, 760]], start: 5.5 },
        { at: [915, 335], via: [[715, 430], [600, 470], [513, 560], [520, 650]], start: 3 },
      ],
      'Mid → B split': [
        { at: [885, 350], via: [[715, 430], [560, 470], [410, 392], [330, 300]], start: 2 },
        { at: [905, 365], via: [[715, 430], [560, 470], [410, 392], [300, 330]], start: 2.5 },
        { at: [925, 385], via: [[715, 430], [600, 470], [482, 334], [430, 240], [300, 185], [212, 240]], start: 1 },
        { at: [895, 405], via: [[700, 180], [300, 185], [212, 240]], start: 4 },
        { at: [915, 335], via: [[700, 180], [300, 185], [230, 270]], start: 4.5 },
      ],
      'Fast B apps': [
        { at: [885, 350], via: [[700, 180], [300, 185], [212, 240], [240, 290]] },
        { at: [905, 365], via: [[700, 180], [300, 185], [212, 240], [200, 300]], start: 0.4 },
        { at: [925, 385], via: [[700, 180], [300, 185], [212, 240], [280, 260]], start: 0.8 },
        { at: [895, 405], via: [[700, 180], [300, 185], [212, 240]], start: 1.2 },
        { at: [915, 335], via: [[715, 430], [560, 470]], start: 0, mode: 'walk' },
      ],
    },
    presets: {
      'Default 2-1-2': [[690, 650], [455, 625], [405, 470, 'awp'], [330, 300], [180, 330]],
      'Stack A, Mid open': [[690, 650], [470, 640], [600, 800], [330, 300], [180, 330]],
      'Aggro Mid': [[690, 650], [513, 590], [405, 470, 'awp'], [410, 420], [180, 330]],
      'Stack B': [[690, 650], [330, 300], [180, 330], [250, 230], [260, 440]],
    },
  },
  // Callouts (src/map/callouts.ts) also name the chokepoints the geometry analysis finds (nearest within 90 px).
  de_dust2: {
    callouts: CALLOUTS.de_dust2,
  },
  de_inferno: {
    callouts: CALLOUTS.de_inferno,
  },
  de_ancient: {
    callouts: CALLOUTS.de_ancient,
  },
  de_anubis: {
    sites: { A: p(765, 255), B: p(335, 505) },
    callouts: CALLOUTS.de_anubis,
  },
  de_overpass: {
    callouts: CALLOUTS.de_overpass,
  },
  de_cache: {
    callouts: CALLOUTS.de_cache,
  },
  de_train: {
    callouts: CALLOUTS.de_train,
  },
  // Nuke, hand-made. Upper radar = A (Lobby → Squeaky / Hut, Outside → Main). Lower radar = B,
  // entered via Ramp (from Lobby) and Secret (from Outside); CTs come down from the A side.
  de_nuke: {
    sites: { A: p(594, 520) },
    chokepoints: [
      { id: 'squeaky', name: 'Squeaky', area: 'Lobby', feeds: ['A'], at: p(529, 490), axis: 'v', maxHalf: 30 },
      { id: 'hut', name: 'Hut', area: 'Lobby', feeds: ['A'], at: p(531, 584), axis: 'v', maxHalf: 30 },
      { id: 'main', name: 'Main', area: 'Outside', feeds: ['A'], at: p(583, 628), axis: 'h', maxHalf: 30 },
    ],
    callouts: [
      // the team's own names and spots
      { name: 'Lobby', pos: p(486, 540) }, { name: 'Squeaky', pos: p(498, 592) }, { name: 'Hut', pos: p(548, 566) },
      { name: 'A site', pos: p(600, 470) }, { name: 'Heaven', pos: p(662, 477) }, { name: 'Main', pos: p(583, 642) },
      { name: 'Outside', pos: p(560, 720) }, { name: 'Silo', pos: p(505, 690) }, { name: 'Garage', pos: p(740, 700) },
      { name: 'Ramp', pos: p(584, 396) }, { name: 'Radio', pos: p(519, 423) }, { name: 'Wardrobe', pos: p(662, 517) },
      { name: 'White', pos: p(701, 638) }, { name: 'Red', pos: p(578, 746) },
    ],
    strats: [
      {
        id: 'nuke_lobby_rush', label: 'Lobby rush A (Hut + Squeaky)', kind: 'rush', target: 'A', basePrior: 0.8,
        groups: [{ route: ['hut'], size: 3, delay: 0, util: ['flash'] }, { route: ['squeaky'], size: 2, delay: 0, util: ['flash'] }],
        counter: 'Molotov Hut early and keep Heaven on Squeaky.',
      },
      {
        id: 'nuke_a_exec', label: 'A execute (Hut + Squeaky + Main)', kind: 'execute', target: 'A', basePrior: 1,
        groups: [
          { route: ['hut'], size: 2, delay: 9, util: ['smoke', 'flash'] },
          { route: ['squeaky'], size: 2, delay: 9, util: ['flash'] },
          { route: ['main'], size: 1, delay: 8, util: ['smoke'] },
        ],
        counter: 'Heaven + Mini crossfire; save a molotov for the plant on default.',
      },
      {
        id: 'nuke_outside_split', label: 'Outside → Main split with Hut', kind: 'split', target: 'A', basePrior: 0.8,
        groups: [{ route: ['main'], size: 3, delay: 6, util: ['smoke', 'flash'] }, { route: ['hut'], size: 2, delay: 10, util: ['flash'] }],
        counter: 'Contest Outside early (Garage/Secret) so Main is not free.',
      },
    ],
    presets: {
      'A default 3': [[600, 455], [615, 600], [560, 470], [720, 650], [470, 620]],
      'A heavy 4': [[600, 455], [615, 600], [560, 470], [640, 540], [720, 650]],
    },
    tPlays: {
      'Lobby rush': [
        { at: [190, 545], via: [[531, 584], [580, 560]] }, { at: [200, 560], via: [[531, 584], [600, 590]], start: 0.3 },
        { at: [210, 550], via: [[531, 584], [570, 520]], start: 0.6 }, { at: [195, 565], via: [[529, 490], [590, 480]], start: 0.2 },
        { at: [205, 540], via: [[529, 490], [610, 500]], start: 0.5 },
      ],
      'Outside → Main': [
        { at: [190, 545], via: [[450, 700], [583, 628], [600, 580]], start: 2 }, { at: [200, 560], via: [[460, 710], [583, 628], [620, 560]], start: 2.3 },
        { at: [210, 550], via: [[470, 700], [583, 628], [580, 560]], start: 2.6 }, { at: [195, 565], via: [[531, 584], [580, 560]], start: 6 },
        { at: [205, 540], via: [[531, 584], [570, 520]], start: 6.4 },
      ],
    },
    lower: {
      sites: { A: p(585, 500), B: p(585, 500) },
      entries: {
        T: [
          { at: [497, 642], from: [490, 600], extra: 2.5, name: 'Ramp (from Lobby)' },
          { at: [712, 756], from: [712, 752], extra: 1.5, name: 'Secret (from Outside)' },
        ],
        CT: [
          { at: [585, 300], from: [600, 455], extra: 3, name: 'From A (CT drop)' },
          { at: [690, 470], from: [720, 480], extra: 3, name: 'CT stairs' },
        ],
      },
      chokepoints: [
        { id: 'ramp', name: 'Ramp', area: 'Ramp', feeds: ['B'], at: p(538, 600), axis: 'v', maxHalf: 30 },
        { id: 'secret', name: 'Secret', area: 'Secret', feeds: ['B'], at: p(654, 562), axis: 'h', maxHalf: 30 },
      ],
      callouts: [
        { name: 'B site', pos: p(585, 470) }, { name: 'Ramp room', pos: p(518, 618) }, { name: 'Lower tunnel', pos: p(580, 642) },
        { name: 'Secret', pos: p(654, 610) }, { name: 'Vents / CT side', pos: p(688, 500) },
      ],
      strats: [
        {
          id: 'nuke_ramp_rush', label: 'Ramp rush B', kind: 'rush', target: 'B', basePrior: 0.8,
          groups: [{ route: ['ramp'], size: 5, delay: 0, util: ['flash'] }],
          counter: 'Molotov Ramp and hold it from the B site boxes.',
        },
        {
          id: 'nuke_b_exec', label: 'B execute (Ramp + Secret)', kind: 'execute', target: 'B', basePrior: 1,
          groups: [{ route: ['ramp'], size: 3, delay: 6, util: ['smoke', 'flash'] }, { route: ['secret'], size: 2, delay: 6, util: ['flash'] }],
          counter: 'One on Ramp, one on Secret, rotators from A through the drop.',
        },
        {
          id: 'nuke_secret', label: 'Secret take (Outside → Secret)', kind: 'split', target: 'B', basePrior: 0.8,
          groups: [{ route: ['secret'], size: 4, delay: 3, util: ['smoke', 'flash'] }, { route: ['ramp'], size: 1, delay: 8, util: [] }],
          counter: 'Watch Secret early; a lone Ramp lurker is the fake.',
        },
      ],
      presets: {
        'B 2 (Ramp + Secret)': [[560, 560], [615, 520]],
        'B 3 stack': [[560, 560], [615, 520], [585, 470]],
      },
      tPlays: {
        'Ramp rush': [0, 0.3, 0.6, 0.9, 1.2].map((d, i) => ({ at: [497, 642] as [number, number], via: [[538, 600], [570 + i * 8, 540 - i * 10]] as [number, number][], start: d })),
        'Secret + Ramp': [
          { at: [712, 756], via: [[654, 562], [600, 520]] }, { at: [712, 756], via: [[654, 562], [620, 500]], start: 0.4 },
          { at: [712, 756], via: [[654, 562], [610, 470]], start: 0.8 },
          { at: [497, 642], via: [[538, 600], [570, 540]], start: 1 }, { at: [497, 642], via: [[538, 600], [560, 500]], start: 1.4 },
        ],
      },
    },
  },
  de_vertigo: {
    callouts: [{ name: 'Mid', pos: p(353, 449) }],
    rough: 'Vertigo is two stacked floors and many walls are only drawn as lines, so the generated layer finds just Mid and one B route.',
  },
};

export interface CatalogEntry {
  id: string;
  name: string;
  levels: MapLevel[];
  hasPredictions: boolean;
}

const RAW = generated as unknown as GeneratedMap[];

export const MAPS: CatalogEntry[] = RAW.map(m => ({
  id: m.id,
  name: m.name,
  levels: m.levels,
  hasPredictions: true, // hand-authored layer (Mirage) or one derived from geometry
}));

/** Why a generated layer should be taken with a grain of salt (undefined = fine). */
export const roughNote = (mapId: string) => EXTRAS[mapId]?.rough;

/** True when the map's chokepoints/strategies were generated from geometry. */
export const isAutoLayer = (mapId: string, level = 0) => level === 0 && !EXTRAS[mapId]?.chokepoints?.length;

/** True when this level has its own tactical layer (chokepoints and strategies). */
export const hasLayer = (mapId: string, level = 0) => level === 0 || !!ex(mapId, level).chokepoints?.length;

const autoCache = new Map<string, AutoLayer>();

/** Lanes, chokepoints, strategies and setups derived from the radar for maps without a hand-made layer. */
export function getAutoLayer(mapId: string): AutoLayer | null {
  if (!isAutoLayer(mapId)) return null;
  const hit = autoCache.get(mapId);
  if (hit) return hit;
  const raw = RAW.find(m => m.id === mapId)!;
  const base = baseDefinition(raw, 0);
  const grid = new MapGrid(base);
  const spawns = spawnSpread(grid, raw.spawns.T);
  const ctSpawns = spawnSpread(grid, raw.spawns.CT);
  const kT = raw.radar.scale / 215, kC = raw.radar.scale / 225;
  const tTime = grid.distanceField(spawns).map(d => d * kT + 0.4);
  const ctTime = grid.distanceField(ctSpawns).map(d => d * kC + 0.4);
  const layer = buildAutoLayer({
    grid, tSpawns: spawns, sites: { A: base.sites.A.center, B: base.sites.B.center }, tTime, ctTime,
    names: EXTRAS[mapId]?.callouts ?? [], skipSites: EXTRAS[mapId]?.skipSites,
  });
  autoCache.set(mapId, layer);
  return layer;
}

export function presetsFor(mapId: string, level = 0): Record<string, () => Player[]> {
  const out: Record<string, () => Player[]> = {};
  for (const [name, pts] of Object.entries(ex(mapId, level).presets ?? (level === 0 ? getAutoLayer(mapId)?.presets : undefined) ?? {}))
    out[name] = () => pts.map(([x, y, weapon]) => ({ id: Math.random().toString(36).slice(2, 9), side: 'CT', pos: { x, y }, weapon: weapon ?? 'rifle', label: '' }));
  out.Empty = () => [];
  return out;
}

export function tPlaysFor(mapId: string, level = 0): Record<string, () => Player[]> {
  const out: Record<string, () => Player[]> = {};
  for (const [name, list] of Object.entries(ex(mapId, level).tPlays ?? (level === 0 ? getAutoLayer(mapId)?.tPlays : undefined) ?? {}))
    out[name] = () => list.map(t => ({
      id: Math.random().toString(36).slice(2, 9), side: 'T', pos: { x: t.at[0], y: t.at[1] }, weapon: t.weapon ?? 'rifle', label: '',
      route: { pts: t.via.map(([x, y]) => ({ x, y })), start: (t.start ?? 0) + entryDelay(mapId, level, t.at), mode: t.mode ?? 'run' },
    }));
  return out;
}

/** On entry-only levels, Ts can't leave an entry before they could have reached it. */
function entryDelay(mapId: string, level: number, at: [number, number]) {
  if (!ex(mapId, level).entries?.T?.length) return 0;
  const m = getEngine(mapId, level).map;
  let best = 0, bd = Infinity;
  m.spawns.T.forEach((sp, i) => { const d = Math.hypot(sp.x - at[0], sp.y - at[1]); if (d < bd) { bd = d; best = m.spawnDelay?.T?.[i] ?? 0; } });
  return Math.round(best * 10) / 10;
}

const cache = new Map<string, TacticalEngine>();

/** Engine for one level of a map (built lazily, then cached). */
export function getEngine(mapId: string, level = 0): TacticalEngine {
  const key = `${mapId}:${level}`;
  let e = cache.get(key);
  if (!e) {
    const strats = ex(mapId, level).strats ?? (level === 0 ? getAutoLayer(mapId)?.strats : undefined) ?? [];
    e = new TacticalEngine(buildDefinition(mapId, level), strats);
    cache.set(key, e);
  }
  return e;
}

function baseDefinition(raw: GeneratedMap, level: number): MapDefinition {
  const extras = ex(raw.id, level);
  const lvl = raw.levels[level];
  return {
    id: raw.id, name: raw.name, radar: raw.radar, radarImage: lvl.image,
    grid: lvl.grid, walls: extras.walls,
    chokepoints: [], callouts: [], spawns: { T: [], CT: [] },
    sites: {
      A: { center: extras.sites?.A ?? raw.bombs.A ?? p(0, 0), radius: 90 },
      B: { center: extras.sites?.B ?? raw.bombs.B ?? p(0, 0), radius: 90 },
    },
    timingScale: 1,
  };
}

const spawnSpread = (grid: MapGrid, c?: Vec2) =>
  c ? [p(0, 0), p(-14, 0), p(14, 0), p(0, -14), p(0, 14)].map(o => cellCenter(grid, { x: c.x + o.x, y: c.y + o.y })) : [];

function buildDefinition(mapId: string, level: number): MapDefinition {
  const raw = RAW.find(m => m.id === mapId)!;
  const extras = ex(mapId, level);
  const base = baseDefinition(raw, level);
  const grid = new MapGrid(base);
  const auto = level === 0 ? getAutoLayer(mapId) : null;
  const chokepoints = extras.chokepoints
    ? extras.chokepoints.map(({ at, axis, maxHalf, ...c }) => ({ ...c, portal: grid.fitPortal(at, axis, maxHalf) }))
    : auto?.chokepoints ?? [];

  // Spawns: the overview's spawn icons, or for an entry-only level the stair/ramp entries,
  // timed by how long the upper level takes to reach them.
  let spawns = { T: spawnSpread(grid, raw.spawns.T), CT: spawnSpread(grid, raw.spawns.CT) };
  let spawnDelay: MapDefinition['spawnDelay'];
  const entryCallouts: Callout[] = [];
  if (extras.entries) {
    const upper = getEngine(mapId, 0);
    const T = extras.entries.T ?? [], CT = extras.entries.CT ?? [];
    spawns = { T: T.map(e => cellCenter(grid, p(...e.at))), CT: CT.map(e => cellCenter(grid, p(...e.at))) };
    spawnDelay = {
      T: T.map(e => upper.tArrival(p(...e.from)).min + e.extra),
      CT: CT.map(e => upper.grid.at(upper.ctTime, p(...e.from)) + e.extra),
    };
    for (const e of [...T, ...CT]) entryCallouts.push({ name: e.name, pos: p(...e.at) });
  }
  return {
    ...base,
    spawns,
    spawnDelay,
    chokepoints,
    callouts: [
      // spawn labels, unless the hand-made callouts already place them
      ...(!extras.entries && raw.spawns.T && !extras.callouts?.some(c => c.name === 'T Spawn') ? [{ name: 'T Spawn', pos: raw.spawns.T, size: 13 }] : []),
      ...(!extras.entries && raw.spawns.CT && !extras.callouts?.some(c => c.name === 'CT Spawn') ? [{ name: 'CT Spawn', pos: raw.spawns.CT, size: 13 }] : []),
      ...entryCallouts,
      ...(extras.callouts ?? []),
      // unnamed generated chokepoints still get a label
      ...(auto ? auto.chokepoints.filter(c => / lane /.test(c.name)).map(c => ({ name: c.name, pos: mid(c.portal) })) : []),
    ],
  };
}

const mid = ([a, b]: [Vec2, Vec2]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function cellCenter(grid: MapGrid, q: Vec2): Vec2 {
  const i = grid.snap(q);
  if (i < 0) return q;
  return { x: ((i % grid.w) + 0.5) * CELL, y: (Math.floor(i / grid.w) + 0.5) * CELL };
}

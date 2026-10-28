import { FLASH_POP, HE_POP, SIM_DT, type KillEvent, type Simulation } from './combat';
import { computeControl } from './control';
import { radarToWorld, worldToRadar } from './coords';
import { gunFromName, primaryGun } from './guns';
import { lifeOf, popAt, segmentHitsCircle, smokeBlasts, smokeOpenAt, SMOKE_CLEAR, SMOKE_RADIUS_UNITS, UTIL_FLIGHT } from './grid';
import type { TacticalEngine } from './predict';
import UTIL_SPOTS from '../map/generated/util-spots.json';
import { placeOf as calloutOfSpot } from './situations';
import { analyzeRound } from './analyst';
import { duelOdds as duelModelOdds, pctOdds } from './duelModel';
import { COST_SCALE, keySearchMoments, searchRound, walkDistance, type RoundSearch } from './search';
import { ACTION_TEXT, judgeMoment, keyMoments, momentLine, pctPlay, PLAY_MODEL, roundMoments, type Action, type MomentVerdict } from './playModel';
import { controlCounts, learnedLogit, tradePending, WIN_MODEL } from './winprob';
import { analystBench, proAnalystAvailable, proTradeConversion } from './analystModel';
import { tradeSpotOf } from './analystBench';
import type { BoardState, Player, Side, Utility, UtilType, Vec2, Weapon } from './types';

/**
 * Round review: replays a real round from a demo and grades what each player did, chess-style.
 * Win probability ("eval") is estimated every second from players alive, health, bomb state,
 * time left and map control; every kill, death and flash is graded by how much it moved it.
 */

// ---- demo data (shape produced by tools/demo.mjs) -------------------------------------------

export interface DemoRound {
  n: number;
  winner: Side | null;
  reason: string;
  duration: number;
  plant: number | null;
  frames: { t: number[]; players: Record<string, FrameTrack> };
  kills: {
    t: number; attacker: string; victim: string; weapon: string; headshot: boolean; x: number; y: number; ax: number; ay: number;
    /** Newer parses: walls the bullet went through, through a smoke, the shooter flashed / in the air / AWP unscoped, metres apart. */
    wall?: number; smoke?: boolean; blind?: boolean; air?: boolean; noscope?: boolean; dist?: number;
    /** Newer parses: who got the assist, and whether it was a flash. */
    assist?: string; flashAssist?: boolean;
  }[];
  util: {
    t: number; type: UtilType; thrower: string; x: number; y: number;
    /** Release time, flight path (world x/y) and when the smoke/fire ended; older parses don't have them. */
    throwT?: number; path?: ([number, number] | [number, number, number])[]; end?: number;
    /** Where it was thrown from (world x/y) when there's no flight path (browser build). */
    from?: [number, number];
    /** Newer parses with a flight: where it hit a wall (1) or the floor / a roof (0) on the way, and when. */
    bounces?: [x: number, y: number, t: number, wall: 0 | 1][];
  }[];
  /** Damage done by HE grenades and fire. */
  nadeDamage?: { t: number; attacker: string; victim: string; dmg: number; weapon: 'he' | 'molotov' }[];
  /**
   * Every gun shot fired (newer parses: the shooter's speed in game units a second, from 4 ticks before, their
   * stance bits as in FrameTrack.fl, and the weapon), and every gun hit (damage to health).
   */
  shots?: { t: number; id: string; spd?: number; fl?: number; w?: string }[];
  hits?: { t: number; attacker: string; victim: string; dmg: number; head: boolean }[];
  blind: { t: number; victim: string; attacker: string; dur: number }[];
  /** Each player's economy a few seconds into the round (after buying). */
  econ?: Record<string, PlayerEcon>;
  /** Newer parses: each player's gear once a second, only when it changed: [t, inventory, armour, helmet, kit, money (−1 unknown)]. */
  gear?: Record<string, GearPoint[]>;
  /** What happens to the bomb (world x/y = the player's position); older parses don't have it. */
  bomb?: BombEvent[];
  /** Newer parses: every plant and defuse attempt, start to end (done, or let go), and whether the defuser had a kit. */
  bombTries?: BombTry[];
  /**
   * Every kill's last 3 s at 16 samples a second for both players (world x/y/z, yaw/pitch in degrees): spotting,
   * reaction time, crosshair placement, shooting while moving. Older parses don't have it.
   */
  fights?: Fight[];
}

/** A player over the round, 4 samples a second (world x/y/z, yaw in degrees, health, alive 0/1). */
export interface FrameTrack {
  side: Side; x: number[]; y: number[]; z: number[]; yaw: number[]; hp: number[]; alive: number[];
  /** Newer parses: aim pitch (degrees, negative = up), stance bits (1 walking, 2 crouching, 4 scoped, 8 in the air, 16 spotted by the enemy), weapon in hand ("ak47"), ammo in the magazine (-1 unknown). */
  pitch?: number[]; fl?: number[]; w?: string[]; am?: number[];
}
export const FL = { walking: 1, crouching: 2, scoped: 4, airborne: 8, spotted: 16 } as const;

export interface FightTrack { x: number[]; y: number[]; z: number[]; yaw: number[]; pitch: number[] }
export interface Fight { t0: number; dt: number; attacker: string; victim: string; a: FightTrack; v: FightTrack }

export interface BombEvent { t: number; kind: 'carry' | 'drop' | 'plant' | 'defuse' | 'explode'; id: string; x: number; y: number }
export interface BombTry { t: number; end: number; kind: 'plant' | 'defuse'; id: string; done: boolean; kit?: boolean }
export const PLANT_SECONDS = 3.2, DEFUSE_SECONDS = 10, DEFUSE_KIT_SECONDS = 5;
/**
 * The plant or defuse going on at time t, if any. Older parses don't have the attempts: the finished ones are
 * worked out backwards from the plant / defuse (how long it takes, with or without a kit).
 */
export function bombTryAt(r: DemoRound, t: number): BombTry | null {
  const tries = r.bombTries ?? (r.bomb ?? []).filter(b => b.kind === 'plant' || b.kind === 'defuse').map(b => {
    const kit = b.kind === 'defuse' ? !!gearAt(r, b.id, b.t - 1)?.kit : undefined;
    const len = b.kind === 'plant' ? PLANT_SECONDS : kit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS;
    return { t: b.t - len, end: b.t, kind: b.kind as 'plant' | 'defuse', id: b.id, done: true, kit };
  });
  return tries.find(x => x.t <= t && t < x.end) ?? null;
}
export type BombState =
  | { kind: 'carry'; id: string }
  | { kind: 'drop' | 'plant' | 'defuse' | 'explode'; x: number; y: number; since: number; plantedAt: number | null };

/** Where the bomb is at time t: carried by someone, or lying on the map (dropped / planted / defused / exploded). */
export function bombAt(r: DemoRound, t: number): BombState | null {
  let state: BombState | null = null;
  let spot: { x: number; y: number; at: number } | null = null; // the planted bomb stays where it was planted
  for (const e of r.bomb ?? []) {
    if (e.t > t) break;
    if (e.kind === 'carry') state = { kind: 'carry', id: e.id };
    else if (e.kind === 'drop' || e.kind === 'plant') {
      if (e.kind === 'plant') spot = { x: e.x, y: e.y, at: e.t };
      state = { kind: e.kind, x: e.x, y: e.y, since: e.t, plantedAt: spot?.at ?? null };
    } else if (spot) state = { kind: e.kind, x: spot.x, y: spot.y, since: e.t, plantedAt: spot.at };
  }
  return state;
}

export type GearPoint = [number, string[], number, 0 | 1, 0 | 1, number];

/** What a player carries at time t: the gear log when the parse has it, else the buy (minus grenades thrown since). */
export interface Gear { inv: string[]; armor: number; helmet: boolean; kit: boolean; money: number | null; exact: boolean }
const NADE_NAME = /grenade|flashbang|molotov|incendiary|decoy/i;
const UTIL_NAME: Record<string, RegExp> = { smoke: /smoke/i, flash: /flash/i, he: /high explosive|hegrenade/i, molotov: /molotov|incendiary|incgrenade/i };
export function gearAt(r: DemoRound, id: string, t: number): Gear | null {
  const log = r.gear?.[id];
  if (log?.length) {
    let g = log[0];
    for (const x of log) { if (x[0] <= t + 0.01) g = x; else break; }
    return { inv: g[1], armor: g[2], helmet: !!g[3], kit: !!g[4], money: g[5] >= 0 ? g[5] : null, exact: true };
  }
  const e = r.econ?.[id];
  if (!e) return null;
  // older parses: what they bought, minus the grenades they've thrown since
  const inv = [...e.weapons];
  for (const u of r.util.filter(u => u.thrower === id && (u.throwT ?? u.t - 1.5) <= t)) {
    const i = inv.findIndex(w => NADE_NAME.test(w) && UTIL_NAME[u.type]?.test(w));
    if (i >= 0) inv.splice(i, 1);
  }
  return { inv, armor: e.armor, helmet: e.helmet, kit: e.defuser, money: e.money, exact: false };
}
export const isGrenade = (w: string) => NADE_NAME.test(w);
/** Under this round win chance for their side, a death or a move isn't graded as a mistake (the round was lost). */
export const LOST_CAUSE = 0.15;
/** The class of the best gun a player carries at t ('rifle', 'awp', 'smg', 'pistol', 'shotgun'…), or null when unknown. */
export function bestGunClass(r: DemoRound, id: string, t: number): string | null {
  const inv = gearAt(r, id, t)?.inv ?? [];
  const guns = inv.map(w => gunFromName(w)).filter((g): g is NonNullable<typeof g> => !!g);
  if (!guns.length) return null;
  const rank = (c: string) => (c === 'awp' ? 5 : c === 'rifle' ? 4 : c === 'heavy' || c === 'shotgun' ? 3 : c === 'smg' ? 2 : 1);
  return guns.sort((a, b) => rank(b.cls) - rank(a.cls))[0].cls;
}

export interface PlayerEcon {
  money: number | null; // cash left after buying
  equip: number | null; // value of what they carry
  armor: number;
  helmet: boolean;
  defuser: boolean;
  weapons: string[];
}

// ---- economy ----------------------------------------------------------------------------------

/** Approximate CS2 prices, used when the demo has no equipment value. */
const PRICES: [RegExp, number][] = [
  [/awp/, 4750], [/scar|g3sg1/, 5000], [/m249/, 5200], [/negev/, 1700], [/aug/, 3300], [/sg ?553/, 3000], [/m4a4/, 3100],
  [/m4a1/, 2900], [/ak-?47/, 2700], [/famas/, 2050], [/galil/, 1800], [/ssg ?08|scout/, 1700], [/p90/, 2350],
  [/mp7|mp5/, 1500], [/mp9/, 1250], [/ump/, 1200], [/mac-?10/, 1050], [/bizon/, 1400], [/xm1014/, 2000], [/mag-?7/, 1300],
  [/nova/, 1050], [/sawed/, 1100], [/deagle|desert eagle/, 700], [/revolver|r8/, 600], [/tec-?9|five-?seven|cz75/, 500],
  [/p250/, 300], [/dual/, 300], [/incendiary/, 500], [/molotov/, 400], [/smoke/, 300], [/flash/, 200], [/he ?grenade|high explosive/, 300],
  [/decoy/, 50], [/zeus|taser/, 200],
];

/** What kind of gun a player is really holding (best weapon in their inventory). */
export function weaponClass(weapons: string[]): Weapon {
  const w = weapons.map(x => x.toLowerCase());
  if (w.some(x => /awp/.test(x))) return 'awp';
  if (w.some(x => /ak-?47|m4a|famas|galil|sg ?553|aug|ssg ?08|scout|scar|g3sg1|m249|negev/.test(x))) return 'rifle';
  if (w.some(x => /mp9|mac-?10|mp7|mp5|ump|p90|bizon|nova|xm1014|mag-?7|sawed/.test(x))) return 'smg';
  return 'pistol';
}

/** Equipment value: the demo's own number when present, otherwise priced from the inventory. */
export function equipValue(e: PlayerEcon | undefined): number | null {
  if (!e) return null;
  if (e.equip !== null && e.equip > 0) return e.equip;
  let v = 0;
  for (const w of e.weapons) { const hit = PRICES.find(([re]) => re.test(w.toLowerCase())); if (hit) v += hit[1]; }
  if (e.armor > 0) v += e.helmet ? 1000 : 650;
  if (e.defuser) v += 400;
  return v;
}

export type BuyType = 'Pistol round' | 'Eco' | 'Semi-eco' | 'Force buy' | 'Full buy';

export interface TeamEcon { side: Side; equip: number; avgEquip: number; money: number; buy: BuyType; known: boolean }

/** Each side's buy for the round, classified from average equipment value per player. */
export function teamEconomy(r: DemoRound, totalRounds: number): Record<Side, TeamEcon> {
  const out = {} as Record<Side, TeamEcon>;
  for (const side of ['CT', 'T'] as Side[]) {
    const ids = Object.keys(r.frames.players).filter(id => r.frames.players[id].side === side);
    const vals = ids.map(id => equipValue(r.econ?.[id])).filter((v): v is number => v !== null);
    const equip = vals.reduce((a, b) => a + b, 0);
    const avg = vals.length ? equip / vals.length : 0;
    const money = ids.reduce((a, id) => a + (r.econ?.[id]?.money ?? 0), 0);
    // MR12: rounds 1 and 13 are pistol rounds
    const pistol = r.n === 1 || (totalRounds > 12 && r.n === 13);
    const buy: BuyType = pistol ? 'Pistol round' : avg < 1200 ? 'Eco' : avg < 2500 ? 'Semi-eco' : avg < 3900 ? 'Force buy' : 'Full buy';
    out[side] = { side, equip, avgEquip: avg, money, buy, known: vals.length > 0 };
  }
  return out;
}

const num = (v: number) => Math.round(v).toLocaleString('en-US');
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export interface PlayerRank { rating: number; type: 'premier' | 'competitive'; wins: number }

/** Premier points that make one player a 10:1 favourite in a single duel (a 2,400 gap ≈ 2:1). */
export const RATING_SCALE = 8000;
/** Chance a player rated ra wins a duel against rb (Elo curve). */
export const duelOdds = (ra: number, rb: number) => 1 / (1 + 10 ** ((rb - ra) / RATING_SCALE));

export interface DemoData {
  map: string;
  tickrate: number;
  names: Record<string, string>;
  rounds: DemoRound[];
  /** Each player's Premier (or competitive) rating at the start of the match. */
  ranks?: Record<string, PlayerRank>;
  /** When the match was played (ms): the demo file's date, which CS2 sets as it saves the demo after the match. */
  playedAt?: number;
}

// ---- replay -----------------------------------------------------------------------------------

export interface Replay {
  board: BoardState;
  sim: Simulation;
  names: Record<string, string>;
  round: DemoRound;
  ranks: Record<string, PlayerRank>;
  /** Each player's usual job on their side this match: where they are early in the round (learned from the other rounds). */
  usual?: Record<string, UsualSpot>;
}

/** Where a player usually goes first on a side: the spot (out of spawn) they're at ROLE_T s into most of their rounds there. */
export interface UsualSpot { place: string; rounds: number; of: number }
const ROLE_T = 10;
/** A spot is their job when they're there in at least this share of at least ROLE_MIN of their rounds on that side. */
const ROLE_SHARE = 0.5, ROLE_MIN = 4;

export function usualSpots(engine: TacticalEngine, demo: DemoData, roundIdx: number): Record<string, UsualSpot> {
  const out: Record<string, UsualSpot> = {};
  const here = demo.rounds[roundIdx];
  for (const [id, me] of Object.entries(here.frames.players)) {
    const count = new Map<string, number>();
    let of = 0;
    demo.rounds.forEach((r, j) => {
      const p = r.frames.players[id];
      if (j === roundIdx || !p || p.side !== me.side) return;
      const k = r.frames.t.findIndex(t => t >= ROLE_T), k0 = r.frames.t.findIndex(t => t >= 1);
      if (k < 0 || k0 < 0 || !p.alive[k]) return;
      const at = (i: number) => calloutOfSpot(engine, worldToRadar({ x: p.x[i], y: p.y[i] }, engine.map.radar));
      const place = at(k);
      // still around spawn isn't a job, nor a spot the team goes through together
      if (!place || place === at(k0)) return;
      const with_ = Object.entries(r.frames.players).filter(([o, q]) => o !== id && q.side === p.side && q.alive[k]
        && calloutOfSpot(engine, worldToRadar({ x: q.x[k], y: q.y[k] }, engine.map.radar)) === place).length;
      if (with_ >= 2) return;
      of++;
      count.set(place, (count.get(place) ?? 0) + 1);
    });
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    if (top && of >= ROLE_MIN && top[1] / of >= ROLE_SHARE) out[id] = { place: top[0], rounds: top[1], of };
  }
  return out;
}

const POP: Record<UtilType, number> = { smoke: UTIL_FLIGHT, molotov: UTIL_FLIGHT, flash: FLASH_POP, he: HE_POP };

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/**
 * A grenade's flight seen from above when only the throw and the pop are known: a thrown grenade goes straight (from
 * above) at a steady speed. Flashes and HEs go off in the air, molotovs on landing; smokes slow down as they roll and
 * sit for a moment before they pop. Samples are evenly spaced in time from the throw to the pop.
 */
export function flightPath(type: UtilType, from: Vec2, to: Vec2, samples = 16): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const g = type === 'smoke' ? Math.min(1, 1 - (1 - Math.min(1, f / 0.85)) ** 2) : f;
    out.push({ x: from.x + (to.x - from.x) * g, y: from.y + (to.y - from.y) * g });
  }
  return out;
}

/** Builds a board + simulation-shaped replay so the normal board, kill feed and map control work. */
export function buildReplay(engine: TacticalEngine, demo: DemoData, roundIdx: number, context: BoardState['context']): Replay {
  const r = demo.rounds[roundIdx];
  const toR = (x: number, y: number) => worldToRadar({ x, y }, engine.map.radar);
  const ids = Object.keys(r.frames.players);
  // by characters, not UTF-16 units: fancy names (𝖫𝖺𝗒2𝗇) would be cut in half
  const shortName = (id: string) => [...(demo.names[id] ?? id).replace(/[^\p{L}\p{N}]/gu, '')].slice(0, 3).join('') || '?';

  const steps = Math.max(1, Math.ceil(r.duration / SIM_DT) + 1);
  const sim: Simulation = {
    end: r.duration, steps, ids,
    x: ids.map(() => new Float32Array(steps)), y: ids.map(() => new Float32Array(steps)),
    facing: ids.map(() => new Float32Array(steps)), deathT: ids.map(() => Infinity), kills: [],
    hp: ids.map(() => new Uint8Array(steps)), blind: ids.map(() => new Uint8Array(steps)), utilEvents: [],
  };
  const ft = r.frames.t;
  ids.forEach((id, i) => {
    const f = r.frames.players[id];
    let k = 0;
    for (let s = 0; s < steps; s++) {
      const t = s * SIM_DT;
      while (k < ft.length - 2 && ft[k + 1] <= t) k++;
      const a = Math.max(0, Math.min(1, (t - ft[k]) / ((ft[k + 1] ?? ft[k]) - ft[k] || 1)));
      // smooth curve through the 4-a-second samples (Catmull-Rom) instead of straight lines with corners
      const at = (arr: number[], j: number) => arr[Math.max(0, Math.min(arr.length - 1, j))];
      const curve = (arr: number[]) => catmullRom(at(arr, k - 1), at(arr, k), at(arr, k + 1), at(arr, k + 2), a);
      const p = toR(curve(f.x), curve(f.y));
      sim.x[i][s] = p.x; sim.y[i][s] = p.y;
      // turn the short way round between samples (350° → 10° is a 20° turn, not 340°)
      const y0 = at(f.yaw, k), y1 = at(f.yaw, k + 1);
      const yaw = y0 + ((((y1 - y0) % 360) + 540) % 360 - 180) * a;
      sim.facing[i][s] = (-yaw * Math.PI) / 180; // world yaw is counter-clockwise, radar y points down
      sim.hp[i][s] = Math.max(0, Math.min(100, f.hp[k]));
      if (!f.alive[k] && !Number.isFinite(sim.deathT[i])) sim.deathT[i] = ft[k];
    }
  });

  for (const k of r.kills) {
    const v = ids.indexOf(k.victim);
    if (v < 0) continue;
    sim.deathT[v] = Math.min(sim.deathT[v], k.t);
    const w = k.weapon.toLowerCase();
    const cause: KillEvent['cause'] = w.includes('hegrenade') ? 'he' : w.includes('inferno') || w.includes('molotov') ? 'molotov'
      : /smokegrenade|flashbang|decoy/.test(w) ? 'impact' : 'gun';
    sim.kills.push({ t: k.t, killer: ids.includes(k.attacker) && k.attacker !== k.victim ? k.attacker : '', victim: k.victim, at: toR(k.x, k.y), cause });
  }
  sim.kills.sort((a, b) => a.t - b.t);

  // grenades as they were really thrown: release time, flight path and how long the smoke/fire lasted
  const utility: Utility[] = r.util.map((u, i) => {
    const throwAt = u.throwT ?? Math.max(0, u.t - POP[u.type]);
    // the real flight when the parser has it; otherwise from where it was thrown (or the thrower) to where it went off
    const thrower = ids.indexOf(u.thrower);
    const step = Math.max(0, Math.min(steps - 1, Math.round(throwAt / SIM_DT)));
    const from = u.from ? toR(u.from[0], u.from[1]) : thrower >= 0 ? { x: sim.x[thrower][step], y: sim.y[thrower][step] } : null;
    const path = u.path && u.path.length > 1 ? u.path.map(([x, y]) => toR(x, y))
      : from ? flightPath(u.type, from, toR(u.x, u.y)) : undefined;
    return {
      id: `u${i}`, type: u.type, pos: toR(u.x, u.y), throwAt, flight: u.t - throwAt,
      ...(path ? { path, from: path[0] } : {}),
      // the flight's height at each point (newer reads), for drawing the high part of the throw as "in the air"
      ...(u.path && u.path.length > 1 && u.path.every(p => p.length === 3) ? { heights: u.path.map(p => p[2]!) } : {}),
      ...(u.bounces?.length ? { bounces: u.bounces.map(([x, y, t, wall]) => ({ ...toR(x, y), t, wall: wall === 1 })) } : {}),
      ...(u.end !== undefined && u.end > u.t ? { duration: u.end - u.t } : {}),
    };
  });
  for (const b of r.blind) {
    const v = ids.indexOf(b.victim);
    if (v < 0 || !(b.dur > 0)) continue;
    for (let s = Math.floor(b.t / SIM_DT); s < Math.min(steps, Math.ceil((b.t + b.dur) / SIM_DT)); s++) sim.blind[v][s] = 1;
    const src = r.util.findIndex(u => u.type === 'flash' && u.thrower === b.attacker && Math.abs(u.t - b.t) < 0.5);
    sim.utilEvents.push({ t: b.t, kind: 'blind', id: b.victim, amount: b.dur, src: src >= 0 ? `u${src}` : '' });
  }

  const players: Player[] = ids.map((id, i) => {
    const s = r.frames.players[id].side;
    const gun = r.econ?.[id] ? primaryGun(r.econ[id].weapons) : undefined;
    return { id, side: s, pos: { x: sim.x[i][0], y: sim.y[i][0] }, weapon: gun?.cls ?? 'rifle', gun: gun?.id, label: shortName(id) };
  });
  return { board: { players, utility, context }, sim, names: demo.names, round: r, ranks: demo.ranks ?? {}, usual: usualSpots(engine, demo, roundIdx) };
}

/**
 * A match's fingerprint: the map, the round count and a hash of the players and of each round's length. The same match
 * read anywhere (site, desktop, the learning tools) gets the same one, so verdicts saved in Review find it again.
 */
export function matchFingerprint(d: DemoData): string {
  const text = `${d.map}|${Object.keys(d.names).sort().join(',')}|${d.rounds.map(r => r.duration.toFixed(1)).join(',')}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${d.map}-${d.rounds.length}-${h.toString(36)}`;
}

// ---- evaluation ---------------------------------------------------------------------------------

const ROUND_TIME = 115;
const BOMB_TIME = 40;

/** CT win probability from the state of the round at time t. */
export function evalState(state: {
  ct: number; t: number; ctHp: number; tHp: number; ctMap: number; tMap: number; planted: number | null; time: number;
  /** Average equipment value of the living players on each side (null = unknown). */
  ctEquip?: number | null; tEquip?: number | null;
  /** Average rating of the living players on each side (null = unknown). */
  ctRating?: number | null; tRating?: number | null;
  /** For the learned model: areas each side holds (winprob.controlCounts) and trades about to happen (tradePending). */
  ctAreas?: number; tAreas?: number; tradeCT?: number; tradeT?: number;
  /** A plant or defuse under way (the boosted model reads it). */
  bombAct?: 'plant' | 'defuse' | null; kit?: boolean;
  /** The map, for its own trees in the learned model. */
  map?: string;
}): number {
  const { ct, t } = state;
  if (t === 0 && state.planted === null) return 1;
  if (ct === 0) return 0;
  if (t === 0 && state.planted !== null) {
    // every T is dead: the CTs only have to defuse in time (5 s with a kit, 10 without, plus getting there)
    const left = BOMB_TIME - (state.time - state.planted);
    return left >= 13 ? 0.97 : left >= 9 ? 0.85 : left >= 6 ? 0.5 : left >= 4 ? 0.2 : 0.03;
  }
  // the model learned from level-10 rounds, when it's trained and the state has control and trades
  const learned = state.ctAreas !== undefined ? learnedLogit({
    ct, t, ctHp: state.ctHp, tHp: state.tHp, ctEquip: state.ctEquip ?? null, tEquip: state.tEquip ?? null, planted: state.planted, time: state.time,
    ctAreas: state.ctAreas, tAreas: state.tAreas ?? 0, tradeCT: state.tradeCT ?? 0, tradeT: state.tradeT ?? 0,
    bombAct: state.bombAct ?? null, kit: state.kit ?? false, map: state.map,
  }) : null;
  if (learned !== null) {
    let zl = learned;
    if (state.ctRating != null && state.tRating != null) zl += 0.25 * ((state.ctRating - state.tRating) / 1000);
    return 1 / (1 + Math.exp(-zl));
  }
  const diff = ct - t;
  let z = 0.55 * diff + (0.35 * diff) / Math.max(1, Math.min(ct, t)); // man advantage matters more when few are left
  z += 0.004 * (state.ctHp - state.tHp);
  z += 0.9 * (state.ctMap - state.tMap);
  // guns win fights: a full buy (~$4.5k a head) vs an eco (~$700) is worth ~+2 on its own (≈88%)
  if (state.ctEquip != null && state.tEquip != null) z += 0.52 * ((state.ctEquip - state.tEquip) / 1000);
  // better players win more rounds: a 2,000-point team gap is worth ~62% on its own
  if (state.ctRating != null && state.tRating != null) z += 0.25 * ((state.ctRating - state.tRating) / 1000);
  if (state.planted !== null) z -= 0.9 + 0.035 * Math.max(0, state.time - state.planted); // defuse gets harder as the timer runs
  else z += Math.max(0, state.time - (ROUND_TIME - 25)) * 0.07; // Ts running out of time to plant
  return 1 / (1 + Math.exp(-z));
}

/**
 * Two scales, like a chess game's analysis:
 *   moves   a chess-style annotation (Annotation): !! brilliant, ! good, book (the expected, sound play: a standard
 *           smoke, an ordinary trade of kills), ? mistake, ?? blunder. Decided from what happened, not from a formula:
 *           see annotateKill / annotateDeath / the grenade and bomb rules in reviewRound.
 *   rounds  a letter per player per round, S+ … F (roundGrade), and per match (matchLetter in match.ts).
 */
export type Letter = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export const LETTER_COLOR: Record<Letter, string> = {
  'S+': '#f5c542', S: '#22c55e', A: '#7fbf4d', B: '#5c8bd6', C: '#a39b8f', D: '#e5a52a', F: '#e5483a',
};
export const LETTERS: Letter[] = ['S+', 'S', 'A', 'B', 'C', 'D', 'F'];
export const LETTER_INFO: Record<Letter, string> = {
  'S+': 'Transcendent: dominated the round and won the objective (a clutch, a solo anchor, entry and plant)',
  S: 'Exceptional: three kills, or two with the entry plus great utility or the plant / defuse',
  A: 'Great: a double kill, a key trade, or utility that carried the team',
  B: 'Good: did their job (an impact kill, an even trade, useful utility)',
  C: 'Average: no real impact either way',
  D: 'Poor: an early untraded death, a bad fight or wasted utility',
  F: 'Detrimental: a game-losing mistake (team kill, dying to an eco with full utility)',
};

/** Where good players (FACEIT level 10) land their smokes and molotovs, per map (tools/learn-spots.ts). */
type Spot = { type: string; side: string; x: number; y: number; throws: number; demos: number };
const SPOTS = UTIL_SPOTS as Record<string, Spot[]>;
/** The standard spot a grenade landed on (world units, within ~a smoke's radius), if any. */
export function standardSpot(map: string, type: UtilType, side: Side, x: number, y: number): Spot | null {
  let best: Spot | null = null, bd = 150;
  for (const sp of SPOTS[map] ?? []) {
    if (sp.type !== type || sp.side !== side) continue;
    const d = Math.hypot(sp.x - x, sp.y - y);
    if (d < bd) { bd = d; best = sp; }
  }
  return best;
}

/** Whether enough spots are known on this map and side to call a smoke away from all of them a miss. */
export const knowsSpots = (map: string, type: UtilType, side: Side) => (SPOTS[map] ?? []).filter(sp => sp.type === type && sp.side === side).length >= 5;

/** A move's annotation, as in chess. */
export type Annotation = '!!' | '!' | 'book' | '?!' | '?' | '??';
export const NOTES: Annotation[] = ['!!', '!', 'book', '?!', '?', '??'];
export const NOTE_INFO: Record<Annotation, { mark: string; label: string; color: string; tip: string }> = {
  '!!': { mark: '!!', label: 'Brilliant', color: '#1baca6', tip: 'Exceptional, statistically unlikely: a 1v3 clutch, a ninja defuse, a solo anchor, a pistol beating full gear' },
  '!': { mark: '!', label: 'Good move', color: '#5c9ced', tip: 'Swung the round: a quick trade, a multi-kill, the opening kill, a flash or HE that won fights' },
  book: { mark: '', label: 'Book', color: '#a88865', tip: 'The expected, sound play: a standard smoke, an ordinary kill or grenade' },
  '?!': { mark: '?!', label: 'Inaccuracy', color: '#f7c045', tip: 'Not the best: a level-10 player would have played it a little better' },
  '?': { mark: '?', label: 'Mistake', color: '#e58f2a', tip: 'Cost the team: an untraded opening or isolated death, a team flash, dying with utility' },
  '??': { mark: '??', label: 'Blunder', color: '#ca3431', tip: 'A round-losing error: a team kill, a team flash that got a teammate killed, dying to an eco with full gear and grenades unused' },
};

/** Context tags: the one-word "why" next to a grade (like a match feed). */
/** "smokegrenade" → "smoke": the grenade that hit someone directly. */
const impactName = (w?: string) => /flash/.test(w ?? '') ? 'flashbang' : /decoy/.test(w ?? '') ? 'decoy' : 'smoke';

export type Tag =
  | 'OPENING' | 'TRADE' | 'TRADED' | 'ISOLATED' | 'CROSSFIRE' | 'CLUTCH' | 'MULTI-KILL' | 'ECO FRAG' | 'AWP DOWN' | 'AWP LOST'
  | 'FLASH ASSIST' | 'NADE ASSIST' | 'BLIND' | 'LOW HP' | 'TEAM FLASH' | 'TEAM DAMAGE' | 'WASTED' | 'DENIED' | 'POST-PLANT' | 'UNUSED UTIL' | 'WHIFF' | 'UPSET'
  | 'FLANK' | 'ANCHOR' | 'TEAM KILL' | 'ECO DEATH' | 'PLANT' | 'DEFUSE' | 'NINJA'
  | 'NO TRADE' | 'LATE ROTATION' | 'OVER-ROTATION' | 'DRY PEEK'
  | 'KNIFE OUT' | 'NO AMMO' | 'MOVING SHOT' | 'LOUD' | 'BAD PEEK' | 'LONG ODDS' | 'STALL' | 'OUTGUNNED'
  | 'WALLBANG' | 'THROUGH SMOKE' | 'BLIND SHOT' | 'NO-SCOPE' | 'JUMP SHOT' | 'NADE KILL' | 'SMOKE CLEAR';
const GOOD = '#22c55e', BAD = '#ef4444', UTIL = '#3b82f6', INFO = '#a39b8f';
export const TAG_INFO: Record<Tag, { color: string; tip: string }> = {
  OPENING: { color: INFO, tip: 'First kill of the round.' },
  TRADE: { color: GOOD, tip: 'Killed the enemy who had just killed a teammate.' },
  TRADED: { color: INFO, tip: 'A teammate killed their killer within 5 s, so the death bought space.' },
  ISOLATED: { color: BAD, tip: 'Died with no teammate close enough to trade.' },
  CROSSFIRE: { color: BAD, tip: 'Was in view of two or more enemies at once.' },
  CLUTCH: { color: GOOD, tip: 'Last player alive on the team, against two or more.' },
  'MULTI-KILL': { color: GOOD, tip: 'Two or more kills within a few seconds.' },
  'ECO FRAG': { color: GOOD, tip: 'Won it with much cheaper gear than the victim.' },
  'AWP DOWN': { color: GOOD, tip: 'Killed the enemy AWPer.' },
  'AWP LOST': { color: BAD, tip: 'Died with the AWP: a $4,750 weapon lost.' },
  'FLASH ASSIST': { color: UTIL, tip: 'The enemy was blind when they died.' },
  'NADE ASSIST': { color: UTIL, tip: 'Grenade damage set up a kill.' },
  BLIND: { color: BAD, tip: 'Died while flashed.' },
  'LOW HP': { color: INFO, tip: 'Was already hurt before the duel.' },
  'TEAM FLASH': { color: BAD, tip: 'Blinded a teammate.' },
  'TEAM DAMAGE': { color: BAD, tip: 'Damaged teammates.' },
  WASTED: { color: BAD, tip: 'The grenade did nothing useful.' },
  DENIED: { color: UTIL, tip: 'Took sightlines or ground away from the enemy.' },
  'POST-PLANT': { color: INFO, tip: 'After the bomb was planted.' },
  'UNUSED UTIL': { color: BAD, tip: 'Died holding two or more grenades.' },
  WHIFF: { color: BAD, tip: 'Fired a burst right before dying and barely hit anything.' },
  UPSET: { color: GOOD, tip: 'Beat a much higher-rated player (Premier rating).' },
  FLANK: { color: GOOD, tip: 'Caught the enemy from behind or from an angle they weren\'t watching.' },
  ANCHOR: { color: GOOD, tip: 'Held a site alone: three or more kills against a full push.' },
  'TEAM KILL': { color: BAD, tip: 'Killed a teammate.' },
  'ECO DEATH': { color: BAD, tip: 'Died to a player on an eco while fully bought, with grenades unused.' },
  PLANT: { color: INFO, tip: 'Planted the bomb.' },
  DEFUSE: { color: GOOD, tip: 'Defused the bomb.' },
  NINJA: { color: GOOD, tip: 'Defused with enemies still alive, or with almost no time left.' },
  'NO TRADE': { color: BAD, tip: 'A teammate died close by while you could see the killer, and you didn\'t trade.' },
  'LATE ROTATION': { color: BAD, tip: 'Arrived at the site after the bomb was down.' },
  'OVER-ROTATION': { color: BAD, tip: 'Left a site that then got hit, for one that didn\'t.' },
  'DRY PEEK': { color: BAD, tip: 'Swung into a player holding the angle, without a flash or a teammate.' },
  'KNIFE OUT': { color: BAD, tip: 'Died holding a knife, grenade or the bomb instead of a gun.' },
  'NO AMMO': { color: BAD, tip: 'Died with 3 bullets or fewer in the magazine: should have reloaded in cover first.' },
  'MOVING SHOT': { color: BAD, tip: 'Their first shot was fired while moving too fast to be accurate (no counter-strafe).' },
  LOUD: { color: BAD, tip: 'Was running (footsteps) right before dying with the enemy close: they heard them coming.' },
  'BAD PEEK': { color: BAD, tip: 'Peeked into a fight level-10 players lose most of the time from there (behind on health, armour or gun): wait, fall back or bring a flash.' },
  'LONG ODDS': { color: GOOD, tip: 'Won a fight level-10 players usually lose from that situation.' },
  OUTGUNNED: { color: INFO, tip: 'Had a pistol or SMG against a rifle or AWP: a fight most players lose, not a mistake on its own.' },
  STALL: { color: UTIL, tip: 'Thrown early as CT to slow a push down: nobody coming through is the point.' },
  WALLBANG: { color: INFO, tip: 'The killing bullet went through a wall (or a door, a box): the shooter knew or guessed where the victim was.' },
  'THROUGH SMOKE': { color: INFO, tip: 'The killing bullet went through a smoke.' },
  'BLIND SHOT': { color: INFO, tip: 'The shooter was flashed when they got the kill.' },
  'NO-SCOPE': { color: INFO, tip: 'A sniper kill without scoping in.' },
  'SMOKE CLEAR': { color: UTIL, tip: 'An HE grenade that blew the enemy smoke open for a few seconds.' },
  'NADE KILL': { color: UTIL, tip: 'Killed with an HE grenade, fire, or a grenade that hit them directly.' },
  'JUMP SHOT': { color: INFO, tip: 'The shooter was in the air (jumping or falling) when they got the kill.' },
};

export interface Move {
  t: number;
  player: string;
  side: Side;
  kind: 'kill' | 'death' | 'flash' | 'utility' | 'objective' | 'teamplay' | 'position';
  /** The grenade this move is about (Utility id in the replay board). */
  util?: string;
  /** Change in this player's team win chance (e.g. +0.12 = +12%). */
  gain: number;
  note: Annotation;
  title: string;
  why: string[];
  tags: Tag[];
  /** The owner took this move's mark off by hand (engine/corrections.ts). */
  removed?: boolean;
}

export type Role = 'Entry' | 'Lurk' | 'Support' | 'AWPer' | 'Anchor' | 'Rotator' | 'Rifler';
export interface PlayerRole { role: Role; note: string }

const TAG_POINTS: Partial<Record<Tag, number>> = { CLUTCH: 5, 'MULTI-KILL': 2, ANCHOR: 4, NINJA: 3, 'TEAM KILL': -6, 'TEAM FLASH': -2, 'TEAM DAMAGE': -3, 'UNUSED UTIL': -2 };
/** Impact points: win chance added (in %) plus a few things % misses. Ranks players and feeds the game rating. */
export function impactPoints(moves: Move[]): number {
  let pts = 0;
  for (const m of moves) { pts += m.gain * 100; for (const t of m.tags) pts += TAG_POINTS[t] ?? 0; }
  return pts;
}

/** What else a player's round grade needs besides their moves. */
export interface RoundFacts {
  kills: number;
  /** Damage to enemies (capped at their health). */
  damage: number;
  died: boolean;
  traded: boolean;
  /** Round time they died at. */
  deathT: number | null;
  /** Their team won the round (null while it's still being played). */
  won: boolean | null;
  /** Their team planted the bomb. */
  teamPlanted: boolean;
}

/**
 * A player's round, S+ … F, from what they did (not a points formula):
 *   S+  3+ kills (or 300+ damage) plus a critical objective: a won clutch, a solo anchor, the entry and the plant, a defuse
 *   S   3 kills; or 2 with the entry plus a good grenade or the plant / defuse; or a ninja defuse
 *   A   2 kills, a brilliant move, a good trade, two good grenades or a defuse
 *   B   one impact kill, a traded death with real damage, a good grenade, useful utility or the plant
 *   C   no real impact
 *   D   no impact kill and a mistake (?) or an early untraded death
 *   F   a blunder (??: team kill, dying to an eco with full utility) with fewer than two kills
 */
export function roundGrade(all: Move[], f: RoundFacts): { letter: Letter; points: number; why: string } {
  // positioning decisions are judged in the Positions tab, not in the round grade
  const moves = all.filter(m => m.kind !== 'position');
  const points = impactPoints(moves);
  const kills = moves.filter(m => m.kind === 'kill' && !m.tags.includes('TEAM KILL'));
  const impactKills = kills.filter(m => m.gain >= 0.03).length;
  const has = (t: Tag) => moves.some(m => m.tags.includes(t));
  const notes = (n: Annotation) => moves.filter(m => m.note === n).length;
  const nades = moves.filter(m => m.kind === 'utility' || m.kind === 'flash');
  const goodNades = nades.filter(m => m.note === '!' || m.note === '!!').length;
  const usefulNades = nades.filter(m => !m.tags.includes('WASTED') && m.note !== '?' && m.note !== '??').length;
  const entry = kills.some(m => m.tags.includes('OPENING'));
  const planted = has('PLANT'), defused = has('DEFUSE'), ninja = has('NINJA');
  const clutchWon = has('CLUTCH') && f.won === true;
  const big = f.kills >= 3 || f.damage >= 300;
  const goodTrade = kills.some(m => m.tags.includes('TRADE') && (m.note === '!' || m.note === '!!'));

  let letter: Letter = 'C', why = 'No real impact either way.';
  if (big && (clutchWon || has('ANCHOR') || (entry && f.teamPlanted) || defused)) {
    letter = 'S+'; why = clutchWon ? 'Won a clutch with a big round.' : has('ANCHOR') ? 'Held the site alone.' : defused ? 'Big round and the defuse.' : 'Entry kill, more kills and the plant.';
  } else if (f.kills >= 3 || (f.kills >= 2 && entry && (goodNades >= 1 || planted || defused)) || ninja) {
    letter = 'S'; why = ninja ? 'Ninja defuse.' : f.kills >= 3 ? `${f.kills} kills.` : 'The entry, another kill and great utility or the objective.';
  } else if (f.kills >= 2 || notes('!!') > 0 || goodTrade || goodNades >= 2 || defused) {
    letter = 'A'; why = f.kills >= 2 ? 'A double kill.' : defused ? 'Defused the bomb.' : goodTrade ? 'A key trade.' : notes('!!') ? 'A brilliant move.' : 'Utility that carried the team.';
  } else if (impactKills >= 1 || (f.died && f.traded && f.damage >= 50) || goodNades >= 1 || usefulNades >= 2 || planted) {
    letter = 'B'; why = impactKills ? 'An impact kill.' : planted ? 'Planted the bomb.' : f.died && f.traded ? 'Traded evenly.' : 'Useful utility.';
  }
  const blunder = moves.some(m => m.note === '??');
  const earlyUntraded = f.died && !f.traded && f.deathT !== null && f.deathT < 30;
  if (blunder && f.kills < 2) { letter = 'F'; why = has('TEAM KILL') ? 'Killed a teammate.' : 'A round-losing blunder.'; }
  else if ((letter === 'B' || letter === 'C') && impactKills === 0 && (notes('?') > 0 || earlyUntraded)) {
    letter = 'D'; why = earlyUntraded ? 'Died early without a trade.' : 'A costly mistake.';
  }
  return { letter, points, why };
}

/** Damage each hit really did: cut to the health the victim had left (the demo reports the whole hit). */
export function cappedDamage(r: DemoRound) {
  type Hit = { t: number; attacker: string; victim: string; dmg: number; util: boolean };
  const all: Hit[] = [
    ...(r.hits ?? []).map(h => ({ t: h.t, attacker: h.attacker, victim: h.victim, dmg: h.dmg, util: false })),
    ...(r.nadeDamage ?? []).map(h => ({ t: h.t, attacker: h.attacker, victim: h.victim, dmg: h.dmg, util: true })),
  ].sort((a, b) => a.t - b.t);
  const hp = new Map<string, number>();
  for (const h of all) {
    const left = hp.get(h.victim) ?? 100;
    h.dmg = Math.max(0, Math.min(h.dmg, left));
    hp.set(h.victim, left - h.dmg);
  }
  return { guns: all.filter(h => !h.util), util: all.filter(h => h.util) };
}

/** The facts for roundGrade from the round data, counting only what happened up to time `upTo`. */
export function roundFacts(r: DemoRound, id: string, upTo = Infinity): RoundFacts {
  const side = r.frames.players[id]?.side;
  const sideOf = (x: string) => r.frames.players[x]?.side;
  const kills = r.kills.filter(k => k.t <= upTo && k.attacker === id && k.victim !== id && sideOf(k.victim) && sideOf(k.victim) !== side).length;
  const damage = [...cappedDamage(r).guns, ...cappedDamage(r).util]
    .filter(h => h.t <= upTo && h.attacker === id && sideOf(h.victim) && sideOf(h.victim) !== side).reduce((a, h) => a + h.dmg, 0);
  const died = r.kills.find(k => k.t <= upTo && k.victim === id);
  const traded = !!died && r.kills.some(k => k.t <= upTo && k.victim === died.attacker && k.t > died.t && k.t - died.t <= 5);
  const over = upTo >= r.duration;
  return {
    kills, damage, died: !!died, traded, deathT: died?.t ?? null,
    won: over && r.winner ? r.winner === side : null,
    teamPlanted: side === 'T' && r.plant !== null && r.plant <= upTo,
  };
}

/** Moves with an annotation (!!, !, ?, ??); book moves are the expected play and stay plain. */
export const isMarked = (m: Move) => m.note !== 'book';

/**
 * Which moves get evaluated on screen (marks on the map and the timeline, the killfeed marks, the move cards and
 * ◀ ▶), so they always agree.
 *   'all'   every kill, grenade, flash, plant / defuse and team play of everyone; deaths and positioning decisions
 *           are left out (the killer's move already tells the story, and ten players' positions would flood it)
 *   'mine'  everything of one player (you, when you're logged in with Steam), deaths and positioning included
 */
export type EvalScope = 'all' | 'mine';
export function evaluated(scope: EvalScope, me: string | null): (m: Move) => boolean {
  return scope === 'mine' && me ? m => m.player === me : m => m.kind !== 'death' && m.kind !== 'position';
}

/** Key moments of a round, like the moves of a chess game: every kill and marked move, simultaneous ones grouped. */
export interface Moment { t: number; moves: Move[] }
export function moments(rv: Review, shown: (m: Move) => boolean = m => isMarked(m) || m.kind === 'kill'): Moment[] {
  const out: Moment[] = [];
  for (const m of rv.moves.filter(shown)) { // by default every kill is a moment, even a quiet one
    const last = out[out.length - 1];
    if (last && m.t - last.t <= 0.15) last.moves.push(m);
    else out.push({ t: m.t, moves: [m] });
  }
  return out;
}

/** How long a move stays on screen after it happens (round seconds), unless it's waiting in the reading queue. */
export const CALLOUT_SECS = 3.5;
/** A queued move still waiting to be read is shown up to this long (round seconds) after it happened. */
export const QUEUE_SECS = 8;
/** How long reading a move's window takes (real ms): a base plus time for every character, less for small moves. */
export const readMs = (m: Move) => {
  // the card shows the grade and the title (the reasons open on demand and pause the replay), so that's what's read
  const chars = m.title.length + m.tags.join(' ').length;
  // annotated moves get the full time; book moves a quicker look
  const big = m.note !== 'book';
  return big ? Math.max(1500, Math.min(2800, 700 + 22 * chars)) : Math.max(1000, Math.min(1800, 400 + 12 * chars));
};
export const moveKey = (m: Move) => `${m.t}-${m.player}-${m.kind}-${m.util ?? ''}`;

/**
 * Which move's window to show at round time `time`.
 *   playing with "slow down to read" on (`queueing`): the earliest graded move not read yet, one at a time and in
 *     order, so none are skipped however close together they happen; `backlog` = more are waiting behind it.
 *   otherwise: the latest moment (graded moves and every kill); moves at the same instant are paged (`page`).
 */
export function calloutAt(moves: Move[], time: number, queueing: boolean, read: Set<string>, page: number,
  shown: (m: Move) => boolean = m => isMarked(m) || m.kind === 'kill') {
  const waiting = queueing ? moves.filter(x => shown(x) && x.t <= time && time - x.t < QUEUE_SECS && !read.has(moveKey(x))) : [];
  const recent = moves.filter(x => shown(x) && x.t <= time && time - x.t < CALLOUT_SECS);
  const latest = recent.at(-1);
  const group = latest ? recent.filter(x => latest.t - x.t <= 0.15) : [];
  const pending = waiting[0];
  const move = pending ?? (queueing ? latest : group[Math.min(page, group.length - 1)]);
  return { move, pending, group, backlog: waiting.length > 1 };
}

export interface Review {
  curve: { t: number; ct: number }[];
  moves: Move[];
  players: Record<string, { impact: number; counts: Record<Annotation, number> }>;
  roles: Record<string, PlayerRole>;
  turningPoint: Move | null;
  /** The play model (playModel.ts): every player's moments against level-10 choices. */
  play?: RoundPlay;
  /** The search engine (search.ts): every player's moments, calculated. */
  search?: RoundSearch;
}
export interface PlayKey { t: number; player: string; did: Action; best: Action; /** level-10 share of what they did, and of the usual choice */ share: number; agree: number }
export interface RoundPlay {
  /** Per player: moments judged, and how many were a usual level-10 choice. */
  stats: Record<string, { n: number; usual: number }>;
  /** The clearest off-level-10 choices of the round. */
  key: PlayKey[];
}


/** Full review of a replayed round. */
export function reviewRound(engine: TacticalEngine, rep: Replay): Review {
  const { sim, board, round: r, names } = rep;
  const g = engine.grid;
  const scale = engine.map.radar.scale;
  const sideOf = new Map(board.players.map(p => [p.id, p.side]));
  const name = (id: string) => names[id] ?? id;
  const idx = (id: string) => sim.ids.indexOf(id);
  const posAt = (i: number, t: number): Vec2 => { const s = Math.min(sim.steps - 1, Math.max(0, Math.round(t / SIM_DT))); return { x: sim.x[i][s], y: sim.y[i][s] }; };
  const alive = (i: number, t: number) => t < sim.deathT[i];
  const hpAt = (i: number, t: number) => sim.hp[i][Math.min(sim.steps - 1, Math.max(0, Math.round(t / SIM_DT)))];

  // map control once a second (the expensive part), interpolated in between
  const control: { t: number; ct: number; tt: number }[] = [];
  for (let t = 0; t <= r.duration; t += 1) {
    const c = computeControl(engine, board, t, sim);
    control.push({ t, ct: c.share.ct, tt: c.share.t });
  }
  const mapAt = (t: number) => control[Math.min(control.length - 1, Math.max(0, Math.round(t)))];
  // for the learned win chance: areas held each second, and trades about to happen
  const whereAt = (id: string, t: number) => { const i = idx(id); return i >= 0 && alive(i, t) ? posAt(i, t) : null; };
  const areas = WIN_MODEL ? controlCounts(engine, sim.ids, id => sideOf.get(id), whereAt, Math.ceil(r.duration)) : null;

  const gear = new Map(sim.ids.map(id => [id, equipValue(r.econ?.[id])]));
  const hasEcon = [...gear.values()].some(v => v !== null);
  // a pistol round: nobody has more than a pistol and armour, so "eco" means nothing
  const pistolRound = hasEcon && [...gear.values()].every(v => v === null || v <= 1300);
  const rating = (id: string) => rep.ranks[id]?.rating ?? null;
  const stateAt = (t: number) => {
    let ct = 0, tt = 0, ctHp = 0, tHp = 0, ctGear = 0, tGear = 0;
    const ctR: number[] = [], tR: number[] = [];
    sim.ids.forEach((id, i) => {
      if (!alive(i, t)) return;
      const g = gear.get(id) ?? 0;
      const rt = rating(id);
      if (sideOf.get(id) === 'CT') { ct++; ctHp += hpAt(i, t); ctGear += g; if (rt !== null) ctR.push(rt); } else { tt++; tHp += hpAt(i, t); tGear += g; if (rt !== null) tR.push(rt); }
    });
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const m = mapAt(t);
    return evalState({
      ct, t: tt, ctHp, tHp, ctMap: m.ct, tMap: m.tt, planted: r.plant !== null && t >= r.plant ? r.plant : null, time: t,
      ctEquip: hasEcon && ct ? ctGear / ct : null, tEquip: hasEcon && tt ? tGear / tt : null,
      ctRating: ctR.length && tR.length ? avg(ctR) : null, tRating: ctR.length && tR.length ? avg(tR) : null,
      ...(areas ? (() => {
        const s = Math.min(areas.ct.length - 1, Math.max(0, Math.floor(t)));
        const tp = tradePending(sim.kills, sim.ids, id => sideOf.get(id), whereAt, t, scale);
        const act = bombTryAt(r, t);
        return { ctAreas: areas.ct[s], tAreas: areas.t[s], tradeCT: tp.ct, tradeT: tp.t, bombAct: act?.kind ?? null, kit: !!act?.kit, map: engine.map.id };
      })() : {}),
    });
  };

  const curve: Review['curve'] = [];
  for (let t = 0; t <= r.duration + 0.01; t += 0.5) curve.push({ t, ct: stateAt(t) });

  const moves: Move[] = [];
  /** Deaths excused as the player's usual job (re-checked once the duel is known: a dry peek isn't the job). */
  const onRoleDeaths = new Set<Move>();
  const forSide = (s: Side, ctDelta: number) => (s === 'CT' ? ctDelta : -ctDelta);
  const enemiesSeeing = (i: number, t: number, exclude?: number) => {
    const me = posAt(i, t), mySide = sideOf.get(sim.ids[i]);
    return sim.ids.filter((id, j) => j !== exclude && sideOf.get(id) !== mySide && alive(j, t - 0.05) && Math.hypot(posAt(j, t).x - me.x, posAt(j, t).y - me.y) < 1100 && g.lineOfSight(posAt(j, t), me)).length;
  };
  const teammatesNear = (i: number, t: number, reach = 600) => {
    const me = posAt(i, t), mySide = sideOf.get(sim.ids[i]);
    return sim.ids.filter((id, j) => j !== i && sideOf.get(id) === mySide && alive(j, t - 0.05)
      && (Math.hypot(posAt(j, t).x - me.x, posAt(j, t).y - me.y) * scale < reach || g.lineOfSight(posAt(j, t), me))).length;
  };
  const placeOf = (p: Vec2) => calloutOfSpot(engine, p);
  const where = (p: Vec2) => { const pl = placeOf(p); return pl ? ` at ${pl}` : ''; };
  /** Distance between two radar points, in metres (1 game unit ≈ 2.54 cm). */
  const metres = (a: Vec2, b: Vec2) => Math.round(Math.hypot(a.x - b.x, a.y - b.y) * scale * 0.0254);
  /** " (from Jungle, 14 m)" when the other end of a fight is somewhere else. */
  const from = (a: Vec2 | null, b: Vec2) => {
    if (!a) return '';
    const pa = placeOf(a), pb = placeOf(b), m = metres(a, b);
    return pa && pa !== pb ? ` (from ${pa}, ${m} m)` : m >= 3 ? ` (${m} m)` : '';
  };

  /** Grenades a player bought but hadn't thrown by time t. */
  const unusedNades = (id: string, t: number) => {
    const bought = (r.econ?.[id]?.weapons ?? []).filter(w => /smoke|flash|he ?grenade|hegrenade|molotov|incendiary|inferno/i.test(w)).length;
    return Math.max(0, bought - r.util.filter(u => u.thrower === id && u.t <= t + 0.5).length);
  };

  const demoKill = (k: KillEvent) => r.kills.find(x => x.victim === k.victim && Math.abs(x.t - k.t) < 0.05);
  const facingAt = (i: number, t: number) => sim.facing[i][Math.min(sim.steps - 1, Math.max(0, Math.round(t / SIM_DT)))];
  /** Who ended up last alive on their side against two or more, and against how many (the clutch, if any). */
  const clutches = new Map<string, number>();
  for (const t of [0, ...sim.kills.map(k => k.t + 0.01)]) {
    for (const side of ['CT', 'T'] as const) {
      const mine = sim.ids.filter((id, j) => sideOf.get(id) === side && alive(j, t));
      const foes = sim.ids.filter((id, j) => sideOf.get(id) !== side && alive(j, t)).length;
      if (mine.length === 1 && foes >= 2 && !clutches.has(mine[0])) clutches.set(mine[0], foes);
    }
  }
  const won = (s: Side) => r.winner === s;
  const lastAliveAt = (i: number, t: number) => i >= 0 && !sim.ids.some((id, j) => j !== i && sideOf.get(id) === sideOf.get(sim.ids[i]) && alive(j, t - 0.05));
  sim.kills.forEach((k, n) => {
    const dk = demoKill(k);
    const kGun = dk ? gunFromName(dk.weapon) : undefined;
    const withGun = kGun ? ` with ${kGun.name}${dk?.headshot ? ' (headshot)' : ''}`
      : k.cause === 'he' ? ' with an HE grenade' : k.cause === 'molotov' ? ' with fire' : k.cause === 'impact' ? ` with a ${impactName(dk?.weapon)} to the face` : dk?.headshot ? ' (headshot)' : '';
    const before = stateAt(k.t - 0.05), after = stateAt(k.t + 0.05);
    const ctDelta = after - before;
    const vi = idx(k.victim);
    const vSide = sideOf.get(k.victim)!;
    const firstKill = n === 0;
    const ki = k.killer ? idx(k.killer) : -1;
    const killerAt = ki >= 0 ? posAt(ki, k.t) : null;
    const cause = k.cause === 'he' ? 'HE grenade' : k.cause === 'molotov' ? 'fire' : k.cause === 'impact' ? `${impactName(dk?.weapon)} (direct hit)` : kGun?.name ?? '';
    // how the bullet got there (newer parses): through walls, through a smoke, from a flashed / jumping shooter
    const walls = dk?.wall ?? 0, thruSmoke = !!dk?.smoke, blindShot = !!dk?.blind;
    const wallText = walls === 1 ? 'a wall' : `${walls} walls`;
    const shotTags: Tag[] = [...(walls ? ['WALLBANG' as const] : []), ...(thruSmoke ? ['THROUGH SMOKE' as const] : []), ...(blindShot ? ['BLIND SHOT' as const] : []),
      ...(dk?.noscope ? ['NO-SCOPE' as const] : []), ...(dk?.air ? ['JUMP SHOT' as const] : [])];

    // the victim
    const traded = k.killer && sim.kills.some(o => o.victim === k.killer && o.t > k.t && o.t - k.t <= 5 && sideOf.get(o.killer) === vSide);
    const seers = vi >= 0 ? enemiesSeeing(vi, k.t - 0.1) : 0;
    // after the plant a CT retake comes from several sides: a teammate within ~40 m is support (on the way)
    const retake = vSide === 'CT' && r.plant !== null && k.t >= r.plant;
    const support = vi >= 0 ? (retake ? teammatesNear(vi, k.t - 0.1, 1600) : teammatesNear(vi, k.t - 0.1)) : 0;
    const wasBlind = vi >= 0 && sim.blind[vi][Math.max(0, Math.round((k.t - 0.1) / SIM_DT))] === 1;
    // health before this fight: just before the killer's first hit in the last 3 s (not partway through their spray)
    const firstHit = (r.hits ?? []).filter(h => h.victim === k.victim && h.attacker === k.killer && h.t <= k.t && k.t - h.t <= 3).reduce((a, h) => Math.min(a, h.t), k.t);
    const hpBefore = vi >= 0 ? hpAt(vi, Math.max(0, firstHit - 0.3)) : 100;
    let loss = forSide(vSide, ctDelta);
    const why: string[] = [`${vSide} win chance ${pct(vSide === 'CT' ? before : 1 - before)} → ${pct(vSide === 'CT' ? after : 1 - after)}.`];
    // skill: losing a duel you were expected to win costs more, and the other way round
    const rv = rating(k.victim), rk = k.killer ? rating(k.killer) : null;
    const vOdds = rv !== null && rk !== null ? duelOdds(rv, rk) : null;
    if (vOdds !== null) {
      loss *= 1 + (vOdds - 0.5) * 0.6;
      if (vOdds >= 0.65) why.push(`Lost to a lower-rated player (${num(rv!)} vs ${num(rk!)}): was a ${pct(vOdds)} favourite.`);
      else if (vOdds <= 0.35) why.push(`Up against a much higher-rated player (${num(rk!)} vs ${num(rv!)}).`);
    }
    // whiff: emptied a burst right before dying and barely hurt anyone
    const fired = (r.shots ?? []).filter(x => x.id === k.victim && x.t >= k.t - 3 && x.t <= k.t + 0.05).length;
    const dealt = (r.hits ?? []).filter(x => x.attacker === k.victim && x.t >= k.t - 3 && x.t <= k.t + 0.05).reduce((a, x) => a + x.dmg, 0);
    const whiff = fired >= 4 && dealt < 25;
    if (whiff) why.push(`Fired ${fired} shots in the last 3 s and did ${dealt ? `only ${dealt}` : 'no'} damage.`);
    if (traded) { loss *= 0.4; why.push('Traded by a teammate, so the death bought information and space.'); }
    else if (support === 0 && !lastAliveAt(vi, k.t)) why.push('No teammate close enough to trade: an isolated death.');
    if (seers >= 2) why.push(`Exposed to ${seers} enemies at once (crossfire).`);
    if (wasBlind) why.push('Was flashed when it happened.');
    if (hpBefore < 50 && hpBefore > 0) why.push(`Already hurt (${hpBefore} hp) before the duel.`);
    if (k.cause !== 'gun') why.push(k.cause === 'he' ? 'Killed by an HE grenade.' : k.cause === 'impact'
      ? `Finished off by a ${impactName(dk?.weapon)} that hit you directly: you were on almost no health and still exposed.`
      : 'Burned by a molotov: stood in fire.');
    if (walls) why.push(`Shot through ${wallText} (a wallbang): they knew or guessed where you were. Don't stop on a spot they can spray through, and don't make noise next to one.`);
    if (thruSmoke) why.push(`Shot through a smoke: they were spraying it${walls ? ' as well' : ''}. Standing behind or crossing a smoke that's being sprayed gets you killed: wait it out or go wide.`);
    if (blindShot) why.push('They were flashed when they killed you: you had the fight won and lost it (swing while they can\'t see).');
    if (dk?.noscope) why.push(`Lost to a no-scope${kGun ? ` (${kGun.name})` : ''}.`);
    if (firstKill) why.push('First death of the round (lost the opening duel).');
    const lost = gear.get(k.victim);
    const vAwp = !!r.econ?.[k.victim] && weaponClass(r.econ[k.victim].weapons) === 'awp';
    if (lost != null && lost >= 3000) why.push(`Lost ${money(lost)} of gear${vAwp ? ' (incl. the AWP)' : ''}.`);
    const unused = unusedNades(k.victim, k.t);
    if (unused >= 2) why.push(`Died with ${unused} grenades unused.`);
    const postPlant = r.plant !== null && k.t >= r.plant;
    // outgunned: their best gun a pistol / SMG / shotgun against a rifle or the AWP (not a pistol round)
    const outgunned = !pistolRound && k.cause === 'gun' && !!kGun && (kGun.cls === 'rifle' || kGun.cls === 'awp') && bestGunClass(r, k.victim, k.t) !== null
      && !['rifle', 'awp'].includes(bestGunClass(r, k.victim, k.t)!);
    if (outgunned) why.push(`Outgunned: ${bestGunClass(r, k.victim, k.t)} against ${kGun!.name}. Most players lose that fight; the choice is where to take it.`);
    // the round was already about lost for their side: one more death changed little
    const vBefore = vSide === 'CT' ? before : 1 - before;
    const myAlive = vi >= 0 ? sim.ids.filter((id, j) => sideOf.get(id) === vSide && alive(j, k.t - 0.05)).length : 2;
    const theirAlive = sim.ids.filter((id, j) => sideOf.get(id) !== vSide && alive(j, k.t - 0.05)).length;
    const lostCause = vBefore < LOST_CAUSE || (myAlive <= 1 && theirAlive >= 3);
    // a lost round doesn't excuse dying on almost no health: one hit kills, so the job is to hide and save
    const careless = lostCause && !(!!k.killer && sideOf.get(k.killer) === vSide) && !traded && hpBefore > 0 && hpBefore <= 20;
    if (careless) why.push(`On ${hpBefore} hp with the round lost, any hit kills: stay out of sight and save, don't take another fight.`);
    else if (lostCause) why.push(`The round was already about lost (${pct(vBefore)} for ${vSide}): little to blame here.`);
    const vTags: Tag[] = [];
    if (outgunned) vTags.push('OUTGUNNED');
    if (firstKill) vTags.push('OPENING');
    if (traded) vTags.push('TRADED'); else if (support === 0 && !lastAliveAt(vi, k.t)) vTags.push('ISOLATED');
    if (seers >= 2) vTags.push('CROSSFIRE');
    if (wasBlind) vTags.push('BLIND');
    if (hpBefore < 50 && hpBefore > 0) vTags.push('LOW HP');
    if (vAwp) vTags.push('AWP LOST');
    if (unused >= 2) vTags.push('UNUSED UTIL');
    if (whiff) vTags.push('WHIFF');
    if (postPlant) vTags.push('POST-PLANT');
    vTags.push(...shotTags);
    // ?? dying to an eco while fully bought, without having thrown anything; ? the usual costly deaths
    const byMate = !!k.killer && sideOf.get(k.killer) === vSide;
    const vG = gear.get(k.victim), kG = k.killer ? gear.get(k.killer) : null;
    const threw = r.util.some(u => u.thrower === k.victim && u.t <= k.t);
    const ecoDeath = !pistolRound && !byMate && !traded && vG != null && kG != null && vG >= 3500 && kG <= 1500 && !threw && unused >= 1;
    if (ecoDeath) { vTags.push('ECO DEATH'); why.push(`Died to a ${money(kG!)} eco with ${money(vG!)} of gear and no grenade thrown.`); }
    // a huge loss alone isn't a blunder (late in a close round one death often swings 20%+): it needs a fault too
    // the last one alive on their side is alone by definition: that isn't a fault
    const lastAlive = vi >= 0 && !sim.ids.some((id, j) => j !== vi && sideOf.get(id) === vSide && alive(j, k.t - 0.05));
    const alone = support === 0 && !lastAlive;
    const fault = alone || whiff || unused >= 2 || blindShot;
    // ? only for a death with a clear fault, not every untraded one: alone or the opening duel and it cost 8%+,
    // a missed spray, two grenades in the pocket, the AWP thrown away
    // their usual job this half (an entry taking the same spot first every round): an opening or untraded death there,
    // early, is the role's risk more than a mistake
    const role = rep.usual?.[k.victim];
    const onRole = !!role && k.t < 30 && placeOf(k.at) === role.place && !whiff && unused < 2 && !blindShot && !ecoDeath;
    if (onRole) why.push(`Taking ${role!.place} first is ${name(k.victim)}'s usual job on ${vSide} this match (${role!.rounds} of ${role!.of} rounds): dying there early is part of that role.`);
    const vNote: Annotation = careless ? '?' : byMate || lostCause || (outgunned && !whiff) ? 'book'
      : ecoDeath || (!traded && loss <= -0.3 && fault) ? '??'
      : !traded && (whiff || unused >= 2 || vAwp || blindShot || ((alone || firstKill) && loss <= -0.08)) ? (onRole ? '?!' : '?') : 'book';
    const deathMove: Move = {
      t: k.t, player: k.victim, side: vSide, kind: 'death', gain: loss, note: vNote,
      title: `${name(k.victim)} died${where(k.at)}${k.killer && k.killer !== k.victim
        ? `: ${name(k.killer)}${killerAt && placeOf(killerAt) !== placeOf(k.at) ? ` from ${placeOf(killerAt)}` : ''}${cause ? `, ${cause}${dk?.headshot ? ' (headshot)' : ''}` : ''}`
        : cause ? ` (${cause})` : ''}`, why, tags: vTags,
    };
    moves.push(deathMove);
    if (onRole) onRoleDeaths.add(deathMove);

    // the killer
    if (k.killer) {
      const ai = idx(k.killer);
      const aSide = sideOf.get(k.killer)!;
      let gain = forSide(aSide, ctDelta);
      const aOdds = vOdds !== null ? 1 - vOdds : null;
      if (aOdds !== null) gain *= 1 + (0.5 - aOdds) * 0.6;
      const upset = aOdds !== null && aOdds <= 0.35;
      const others = ai >= 0 ? enemiesSeeing(ai, k.t - 0.05, vi) : 0;
      const multi = sim.kills.filter(o => o.killer === k.killer && Math.abs(o.t - k.t) <= 6).length;
      const special = others >= 1 || multi >= 3 || (firstKill && aSide === 'T');
      const awhy = [`${aSide} win chance ${pct(aSide === 'CT' ? before : 1 - before)} → ${pct(aSide === 'CT' ? after : 1 - after)}.`];
      if (firstKill) awhy.push('Opening kill.');
      // the credit isn't the whole swing when the ratings made the duel lopsided: say why the numbers differ
      if (aOdds !== null && Math.abs(gain - forSide(aSide, ctDelta)) >= 0.02)
        awhy.push(`Counted as ${signedPct(gain)} of the ${signedPct(forSide(aSide, ctDelta))}: ${aOdds > 0.5 ? `by rating they were expected to win this duel (${pct(aOdds)})` : `by rating it was an upset (${pct(aOdds)} on paper), so it counts more`}.`);
      if (others >= 1) awhy.push(`Won it while ${others} more ${others > 1 ? 'enemies' : 'enemy'} had sight on them.`);
      if (multi >= 2) awhy.push(`Part of a ${multi}-kill burst.`);
      if (vi >= 0 && wasBlind) awhy.push('The victim was flashed: teamwork kill.');
      const vGear = gear.get(k.victim), aGear = gear.get(k.killer);
      if (vGear != null && r.econ?.[k.victim] && weaponClass(r.econ[k.victim].weapons) === 'awp') awhy.push('Took down the AWP.');
      else if (!pistolRound && vGear != null && vGear < 1000 && (aGear ?? 0) >= 2500) awhy.push('The victim was on an eco, so the kill is worth less.');
      if (aGear != null && vGear != null && aGear + 1500 < vGear) awhy.push(`Won it with ${money(aGear)} of gear against ${money(vGear)}.`);
      const vGun = r.econ?.[k.victim] ? primaryGun(r.econ[k.victim].weapons) : undefined;
      if (kGun && vGun && kGun.cls === 'pistol' && vGun.cls !== 'pistol') awhy.push(`Pistol (${kGun.name}) beat a ${vGun.name}.`);
      if (kGun?.id === 'awp' && dk?.headshot === false) awhy.push('AWP one-shot to the body.');
      if (k.cause === 'he') awhy.push('An HE grenade kill: utility that finished the job.');
      if (k.cause === 'molotov') awhy.push('Burned them: a molotov kill.');
      if (k.cause === 'impact') awhy.push(`Killed them with a ${impactName(dk?.weapon)} to the face: a direct hit on a player with almost no health left.`);
      if (walls) awhy.push(`Through ${wallText}: a wallbang, shot where they had to be.`);
      if (thruSmoke) awhy.push('Through a smoke: read where they were and shot without seeing them.');
      if (blindShot) awhy.push('Got it while flashed.');
      if (dk?.noscope) awhy.push(`No-scope${kGun ? ` with the ${kGun.name}` : ''}.`);
      if (dk?.air) awhy.push('In the air: a jumping shot (inaccurate with most guns, so partly luck).');
      // last one standing on their side, against two or more
      const mates = sim.ids.filter((id, j) => j !== ai && sideOf.get(id) === aSide && alive(j, k.t - 0.05)).length;
      const foes = sim.ids.filter((id, j) => sideOf.get(id) !== aSide && alive(j, k.t - 0.05)).length;
      const clutch = ai >= 0 && mates === 0 && foes >= 2;
      if (clutch) awhy.push(`1v${foes} clutch situation.`);
      const trade = sim.kills.some(o => o.killer === k.victim && o.t < k.t && k.t - o.t <= 5 && sideOf.get(o.victim) === aSide);
      if (trade) awhy.push('Traded a teammate\'s death.');
      if (upset) awhy.push(`Beat a higher-rated player (${num(rv!)} vs ${num(rk!)}): only a ${pct(aOdds!)} chance on paper.`);
      const teamKill = aSide === vSide;
      // caught from behind: the victim was looking more than ~115° away from the killer
      const vPos = vi >= 0 ? posAt(vi, k.t - 0.1) : null;
      let flank = false;
      if (vPos && killerAt && vi >= 0) {
        const toKiller = Math.atan2(killerAt.y - vPos.y, killerAt.x - vPos.x);
        const off = Math.abs(((facingAt(vi, k.t - 0.15) - toKiller + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        flank = off > 2.0 && metres(killerAt, vPos) > 2;
      }
      if (flank) awhy.push('Caught them from behind: they were looking the other way.');
      // a solo anchor: a CT with 3+ kills in 15 s against a push of three or more Ts
      const burst = sim.kills.filter(o => o.killer === k.killer && o.t <= k.t && k.t - o.t <= 15 && sideOf.get(o.victim) !== aSide);
      const pushed = burst.length >= 3 && killerAt
        ? sim.ids.filter((id, j) => sideOf.get(id) !== aSide && alive(j, burst[0].t - 0.5) && Math.hypot(posAt(j, burst[0].t - 0.5).x - killerAt.x, posAt(j, burst[0].t - 0.5).y - killerAt.y) * scale < 1500).length : 0;
      const anchor = aSide === 'CT' && burst.length >= 3 && pushed >= 3;
      if (anchor) awhy.push(`Held against a ${pushed}-man push alone: ${burst.length} kills in ${Math.round(k.t - burst[0].t)} s.`);
      const clutchOf = clutches.get(k.killer);
      const inClutch = clutchOf !== undefined && clutch;
      const clutchWon = inClutch && won(aSide);
      if (clutchWon) awhy.push(`Won the 1v${clutchOf} clutch.`);
      const kitted = vGear != null && vGear >= 3700, broke = aGear != null && aGear <= 1000;
      const ecoHero = kitted && broke && kGun?.cls === 'pistol';
      const aTags: Tag[] = [];
      if (teamKill) aTags.push('TEAM KILL');
      if (firstKill) aTags.push('OPENING');
      if (clutch) aTags.push('CLUTCH');
      if (multi >= 2) aTags.push('MULTI-KILL');
      if (trade) aTags.push('TRADE');
      if (flank) aTags.push('FLANK');
      if (anchor) aTags.push('ANCHOR');
      if (!pistolRound && aGear != null && vGear != null && aGear < 2000 && aGear + 1500 < vGear) aTags.push('ECO FRAG');
      if (vAwp) aTags.push('AWP DOWN');
      if (vi >= 0 && wasBlind) aTags.push('FLASH ASSIST');
      if (upset) aTags.push('UPSET');
      if (postPlant) aTags.push('POST-PLANT');
      aTags.push(...shotTags);
      if (k.cause !== 'gun') aTags.push('NADE KILL');
      // !! clutch 1v3+, solo anchor, pistol vs full gear, a huge swing; ! quick trade, multi-kill, neutral opening
      // kill, flank, 1v2 clutch, beating a better player, a big swing (but not once the round is decided: a kill
      // that moves the win chance by under 3% is plain); everything else is a plain kill
      const quickTrade = sim.kills.some(o => o.killer === k.victim && o.t < k.t && k.t - o.t <= 3 && sideOf.get(o.victim) === aSide);
      const neutral = vGear == null || aGear == null || (vGear >= 2000 && aGear >= 2000) || aGear + 1000 < vGear;
      const aNote: Annotation = teamKill ? '??'
        : (clutchWon && clutchOf! >= 3) || anchor || ecoHero || gain >= 0.3 ? '!!'
        : clutchWon || gain >= 0.1 || (gain >= 0.03 && (quickTrade || multi >= 2 || (firstKill && neutral) || flank || upset || walls > 0 || thruSmoke || blindShot)) ? '!'
        : 'book';
      if (teamKill) awhy.unshift('Killed a teammate.');
      moves.push({
        t: k.t, player: k.killer, side: aSide, kind: 'kill', gain, note: aNote,
        title: teamKill ? `${name(k.killer)} killed teammate ${name(k.victim)}${where(k.at)}` : `${name(k.killer)} killed ${name(k.victim)}${where(k.at)}${from(killerAt, k.at)}${withGun}`, why: awhy, tags: aTags,
      });
    }
  });

  /**
   * Smokes, molotovs and HEs, graded by what they did:
   *   smoke   — enemy sightlines it cut (pairs of enemy ↔ teammate that would have seen each other, per second)
   *   molotov — damage, and enemies it kept off the ground it burned (were near it while it burned)
   *   HE      — damage, enemies it softened up who then died, team damage
   */
  const gradeNade = (ui: number): { gain: number; note: Annotation; why: string[]; tags: Tag[] } => {
    const u = r.util[ui];
    const s = sideOf.get(u.thrower)!;
    const nade = board.utility.find(x => x.id === `u${ui}`)!;
    const at = nade.pos;
    const from = u.t, to = u.t + lifeOf(nade);
    const enemiesOf = (side: Side) => sim.ids.map((id, j) => j).filter(j => sideOf.get(sim.ids[j]) !== side);
    // a CT grenade in the first 25 s, before anyone has died: thrown to slow a push down (stall), not to hit
    const stall = s === 'CT' && (u.throwT ?? u.t - 1.5) < 25 && !r.kills.some(k => k.t <= u.t);
    const teamOf = (side: Side) => sim.ids.map((id, j) => j).filter(j => sideOf.get(sim.ids[j]) === side);
    const dmg = (r.nadeDamage ?? []).filter(d => d.attacker === u.thrower && d.weapon === (u.type === 'he' ? 'he' : 'molotov') && d.dmg > 0
      && d.t >= from - 0.1 && d.t <= (u.type === 'he' ? from + 0.3 : to + 0.5));
    const enemyDmg = dmg.filter(d => sideOf.has(d.victim) && sideOf.get(d.victim) !== s).reduce((a, d) => a + d.dmg, 0);
    const teamDmg = dmg.filter(d => d.victim !== u.thrower && sideOf.get(d.victim) === s).reduce((a, d) => a + d.dmg, 0);
    const hitEnemies = [...new Set(dmg.filter(d => sideOf.has(d.victim) && sideOf.get(d.victim) !== s).map(d => d.victim))];
    const why: string[] = [];
    let gain = 0;
    if (r.plant !== null && from > r.plant + 0.5 && s === 'T' && u.type === 'smoke') why.push('Thrown after the plant (post-plant smoke).');

    if (u.type === 'smoke') {
      const R = SMOKE_RADIUS_UNITS / scale;
      let pairSec = 0, watchSec = 0;
      const cut = new Set<string>(), blinded = new Set<string>();
      // points on the near rim of the smoke: if an enemy sees them, the smoke is in their view
      const rim = (pe: Vec2) => { const d = Math.hypot(pe.x - at.x, pe.y - at.y) || 1; return { x: at.x + ((pe.x - at.x) / d) * R * 1.05, y: at.y + ((pe.y - at.y) / d) * R * 1.05 }; };
      for (let t = from + 1; t <= Math.min(to, r.duration); t += 1) {
        if (smokeOpenAt(nade, board.utility, t, scale).open >= 0.5) continue; // blown open by an HE: blocking nothing
        for (const e of enemiesOf(s)) {
          if (!alive(e, t)) continue;
          const pe = posAt(e, t);
          const dAt = Math.hypot(pe.x - at.x, pe.y - at.y);
          if (dAt > R * 1.2 && dAt < 1100 && g.lineOfSight(pe, rim(pe))) { watchSec++; blinded.add(sim.ids[e]); }
          for (const f of teamOf(s)) {
            if (!alive(f, t)) continue;
            const pf = posAt(f, t);
            if (Math.hypot(pe.x - pf.x, pe.y - pf.y) > 1100) continue;
            if (segmentHitsCircle(pf, pe, at, R) && g.lineOfSight(pf, pe)) { pairSec++; cut.add(sim.ids[e]); }
          }
        }
      }
      // someone dying right through/next to the smoke while it was up: the smoke didn't cover them
      const caught = sim.kills.filter(k => k.t >= from && k.t <= to && sideOf.get(k.victim) === s && k.killer
        && Math.hypot(k.at.x - at.x, k.at.y - at.y) < R * 1.6).length;
      // kills shot through this smoke while it was up: the enemy spraying it, or your team using it
      const radar = (x: number, y: number) => worldToRadar({ x, y }, engine.map.radar);
      const through = r.kills.filter(k => k.smoke && k.t >= from && k.t <= to && sideOf.has(k.attacker) && sideOf.has(k.victim)
        && segmentHitsCircle(radar(k.ax, k.ay), radar(k.x, k.y), at, R * 1.1));
      const sprayedUs = through.filter(k => sideOf.get(k.attacker) !== s && sideOf.get(k.victim) === s).length;
      const usedIt = through.filter(k => sideOf.get(k.attacker) === s && sideOf.get(k.victim) !== s).length;
      gain = Math.min(0.09, 0.0035 * pairSec + 0.0018 * watchSec) - 0.03 * caught - 0.02 * sprayedUs + 0.02 * usedIt;
      if (pairSec) why.push(`Cut ${cut.size === 1 ? 'an enemy' : `${cut.size} enemies`} off from seeing your team (${pairSec} player-second${pairSec > 1 ? 's' : ''} of sightlines).`);
      if (blinded.size) why.push(`Blocked the view of ${blinded.size === 1 ? 'an enemy' : `${blinded.size} enemies`} looking that way (${watchSec} s).`);
      const std = standardSpot(engine.map.id, 'smoke', s, u.x, u.y);
      // meant for a usual spot but landed into the wall: part of the smoke sits inside it, leaving a gap on the open
      // side anyone can peek through (how much of the smoke is inside walls, against the usual smoke there)
      const wallShare = (c: Vec2) => {
        let n = 0, w = 0;
        for (let a = 0; a < 24; a++) for (const f of [0.35, 0.7, 0.95]) {
          n++;
          if (!g.isWalkable({ x: c.x + Math.cos((a / 24) * 2 * Math.PI) * R * f, y: c.y + Math.sin((a / 24) * 2 * Math.PI) * R * f })) w++;
        }
        return w / n;
      };
      const intoWall = std ? { mine: wallShare(at), usual: wallShare(radar(std.x, std.y)) } : null;
      // limits measured on level-10 players' own standard smokes: this fires on about 2% of them
      const hugsWall = !!intoWall && intoWall.mine - intoWall.usual >= 0.2 && Math.hypot(u.x - std!.x, u.y - std!.y) >= 80;
      if (hugsWall) {
        why.unshift(`Meant for the usual spot (level-10 players land one there ${std!.throws} times in ${std!.demos} matches) but too close to the wall: `
          + `${Math.round(intoWall!.mine * 100)}% of it was inside the wall (the usual one: ${Math.round(intoWall!.usual * 100)}%), leaving a gap on the open side anyone could peek through.`);
        gain = Math.min(gain, 0);
      } else if (std) why.unshift(`A standard smoke: level-10 players land one here (${std.throws} in ${std.demos} matches).`);
      // off every standard spot and it cut no sightline between the teams: a missed smoke (enemies merely seeing it
      // isn't enough); on maps with few known spots, only when nobody even looked at it
      const missed = !std && !pairSec && (knowsSpots(engine.map.id, 'smoke', s) || !blinded.size);
      if (missed) {
        // seeing a smoke from afar isn't blocking anything: say what happened instead
        const i = why.findIndex(w => w.startsWith('Blocked the view'));
        if (i >= 0) why.splice(i, 1);
        why.push('Missed: it landed away from the usual smoke spots and blocked no sightline.');
        gain = Math.min(gain, 0);
      }
      if (caught) why.push(`${caught} teammate${caught > 1 ? 's' : ''} died at the smoke anyway.`);
      const blownBy = smokeBlasts(nade, board.utility, scale).map(b => board.utility.findIndex(h => h.type === 'he' && popAt(h) === b.t))
        .filter(i => i >= 0 && sideOf.get(r.util[i]?.thrower) !== s);
      if (blownBy.length) why.push(`Blown open by an enemy HE${blownBy.length > 1 ? ` ${blownBy.length} times` : ''}: see-through for about ${Math.round(SMOKE_CLEAR.open + SMOKE_CLEAR.refill / 2)} s each time.`);
      if (sprayedUs) why.push(`${sprayedUs === 1 ? 'A teammate was' : `${sprayedUs} teammates were`} shot through it: the enemy sprayed the smoke.`);
      if (usedIt) why.push(`Your team got ${usedIt === 1 ? 'a kill' : `${usedIt} kills`} shooting through it.`);
      const hits = u.bounces?.length ?? 0;
      if (missed && hits >= 2) why.push(`It hit something ${hits} times on the way (marked on its trail): the throw went off its line.`);
      if (nade.duration !== undefined && nade.duration < 12) why.push(`Cleared early (lasted ${nade.duration.toFixed(0)} s).`);
      const tags: Tag[] = missed ? ['WASTED'] : gain >= 0.03 ? ['DENIED'] : [];
      // book: a standard smoke, or one that did its job; ! cut a lot of sightlines or your team shot through it for
      // kills; ? missed, or got teammates killed (at it, or sprayed through it)
      const note: Annotation = caught >= 2 || missed || sprayedUs >= 2 ? '?' : hugsWall ? '?!' : (pairSec >= 20 || usedIt >= 2) && !caught && !sprayedUs ? '!' : 'book';
      return { gain, note, why, tags };
    }

    // an HE that went off inside a smoke blows it open for a moment (CS2's smoke volume): the enemy's is a reveal
    const blown = u.type !== 'he' ? [] : board.utility.map((sm, i) => ({ sm, i }))
      .filter(({ sm }) => sm.type === 'smoke' && smokeBlasts(sm, board.utility, scale).some(b => b.t === popAt(nade)));
    const revealed = blown.filter(({ i }) => r.util[i] && sideOf.get(r.util[i].thrower) !== s);
    const ownBlown = blown.filter(({ i }) => r.util[i] && sideOf.get(r.util[i].thrower) === s);
    const openFor = SMOKE_CLEAR.open + SMOKE_CLEAR.refill / 2;
    const throughGap = revealed.length ? sim.kills.filter(k => k.killer && sideOf.get(k.killer) === s && sideOf.get(k.victim) !== s && k.t >= from && k.t <= from + openFor + 1
      && revealed.some(({ sm }) => Math.hypot(k.at.x - sm.pos.x, k.at.y - sm.pos.y) * scale < SMOKE_RADIUS_UNITS * 3)).length : 0;

    // HE / molotov: damage and who it reached
    const softened = hitEnemies.filter(v => sim.kills.some(k => k.victim === v && k.t >= from && k.t - from <= (u.type === 'he' ? 5 : 8)));
    if (enemyDmg) why.push(`${enemyDmg} damage to ${hitEnemies.length === 1 ? 'an enemy' : `${hitEnemies.length} enemies`}.`);
    if (softened.length) why.push(`${hitEnemies.length === 1 ? 'They' : `${softened.length} of them`} died soon after: the damage set up the kill${softened.length > 1 ? 's' : ''}.`);
    if (teamDmg) why.push(`${teamDmg} damage to your own team.`);
    gain = 0.0006 * enemyDmg + 0.03 * softened.length - 0.0008 * teamDmg;
    const hurtTeam = teamDmg >= 40;
    const tags: Tag[] = [];
    if (softened.length) tags.push('NADE ASSIST');
    if (teamDmg >= 20) tags.push('TEAM DAMAGE');
    if (revealed.length) {
      why.push(`Blew open the enemy smoke${where(revealed[0].sm.pos)}: see-through for about ${Math.round(openFor)} s.`);
      if (throughGap) why.push(`${throughGap === 1 ? 'A kill' : `${throughGap} kills`} for your team right after, through the gap.`);
      gain += 0.012 + 0.025 * throughGap;
      tags.push('SMOKE CLEAR');
    }
    if (ownBlown.length) { why.push('Blew open your own team\'s smoke.'); gain -= 0.01; }

    if (u.type === 'molotov') {
      // area denial: enemies that were close to the fire while it burned (it held them off or pushed them out)
      const near = new Set<string>();
      for (let t = from; t <= Math.min(to, r.duration); t += 0.5)
        for (const e of enemiesOf(s)) {
          if (!alive(e, t)) continue;
          const pe = posAt(e, t);
          if (Math.hypot(pe.x - at.x, pe.y - at.y) * scale < 900 && g.lineOfSight(pe, at)) near.add(sim.ids[e]);
        }
      gain += 0.02 * Math.min(3, near.size);
      if (near.size) why.push(`Kept ${near.size === 1 ? 'an enemy' : `${near.size} enemies`} off that ground for ${(to - from).toFixed(0)} s.`);
      if (near.size) tags.push('DENIED');
      const std = standardSpot(engine.map.id, 'molotov', s, u.x, u.y);
      if (std) why.unshift(`A standard molotov: level-10 players burn this spot (${std.throws} in ${std.demos} matches).`);
      // a T molly clears a spot so the team can take it: one that finds nobody there cleared nothing (save it for the
      // post-plant, or burn the spot only when a teammate saw someone there)
      // …unless it was on the site the team was taking and they walked onto the burned ground as it went out: then
      // burning it was how they took the space (checked dispute: a T molly at Goose as the team went onto A)
      const CLEARED = 300;
      const onSite = Object.values(engine.map.sites).some(st => Math.hypot(st.center.x - at.x, st.center.y - at.y) < st.radius * 1.3);
      const tookIt = !near.size && !enemyDmg && std && s === 'T' && onSite && teamOf(s).some(j => {
        // on the burned ground as the fire goes out (not just passing by while it burns)
        for (let t = to - 1; t <= Math.min(to + 6, r.duration); t += 0.5) {
          if (!alive(j, t)) continue;
          const p = posAt(j, t);
          if (Math.hypot(p.x - at.x, p.y - at.y) * scale < CLEARED) return true;
        }
        return false;
      });
      if (tookIt) return { gain: Math.min(gain, 0), note: hurtTeam ? '?' : 'book', why: [...why, 'Burned the spot as your team took the space: they walked through it right after.'], tags };
      if (!near.size && !enemyDmg && std && s === 'T') {
        why.push('Nobody was there: it cleared an empty spot. Burn it when someone was seen there, or keep it for the post-plant.');
        return { gain: Math.min(gain, -0.01), note: '?!', why, tags: [...tags, 'WASTED'] };
      }
      // an empty burn on a standard spot still did its job (nobody came through); anywhere else it was wasted
      if (!near.size && !enemyDmg && std) return { gain: Math.min(gain, 0), note: hurtTeam ? '?' : 'book', why: [...why, 'Nobody came through while it burned.'], tags };
      if (!near.size && !enemyDmg && stall) return { gain: Math.min(gain, 0), note: hurtTeam ? '?' : 'book', why: [...why, 'Thrown early to slow a push down: nobody came through while it burned.'], tags: [...tags, 'STALL'] };
      if (!near.size && !enemyDmg) { why.push(`Burned empty ground: no enemy came near it.${bounceNote(u)}`); return { gain: Math.min(gain, -0.01), note: '?', why, tags: [...tags, 'WASTED'] }; }
      const note: Annotation = enemyDmg >= 150 ? '!!' : enemyDmg >= 60 || softened.length || near.size >= 3 ? '!' : hurtTeam ? '?' : 'book';
      return { gain, note, why, tags };
    } else if (!enemyDmg && revealed.length) {
      return { gain, note: throughGap ? '!' : 'book', why, tags };
    } else if (!enemyDmg && stall && u.type === 'he') {
      return { gain: Math.min(gain, 0), note: hurtTeam ? '?' : 'book', why: [...why, 'Thrown early to slow a push down: nobody was there to hit, which is the point.'], tags: [...tags, 'STALL'] };
    } else if (!enemyDmg) {
      why.push(`Hit nobody: wasted utility.${bounceNote(u)}`);
      return { gain: Math.min(gain, -0.01), note: '?', why, tags: [...tags, 'WASTED'] };
    }
    const note: Annotation = enemyDmg >= 150 || hitEnemies.length >= 3 ? '!!' : enemyDmg >= 70 || softened.length ? '!' : hurtTeam ? '?' : 'book';
    return { gain, note, why, tags };
  };

  /** " It bounced 3 times first (off 2 walls)." for a grenade that hit things on the way (newer parses). */
  const bounceNote = (u: DemoRound['util'][number]) => {
    const n = u.bounces?.length ?? 0, walls = u.bounces?.filter(b => b[3] === 1).length ?? 0;
    return n ? ` It bounced ${n === 1 ? 'once' : `${n} times`} first${walls ? ` (off ${walls === 1 ? 'a wall' : `${walls} walls`})` : ''}: see its trail.` : '';
  };

  /** " (thrown from Top Mid)" when the grenade was thrown from another area. */
  const thrownFrom = (u: DemoRound['util'][number]) => {
    const w = u.path?.[0] ?? u.from;
    if (!w) return '';
    const a = worldToRadar({ x: w[0], y: w[1] }, engine.map.radar), b = worldToRadar({ x: u.x, y: u.y }, engine.map.radar);
    const pa = placeOf(a);
    return pa && pa !== placeOf(b) ? ` (thrown from ${pa})` : '';
  };

  // flashes: enemies blinded, teammates blinded, and whether it led to a kill
  r.util.forEach((u, ui) => {
    if (!u.thrower || !sideOf.has(u.thrower)) return;
    const s = sideOf.get(u.thrower)!;
    if (u.type !== 'flash') {
      const ev = gradeNade(ui);
      moves.push({
        t: u.t, player: u.thrower, side: s, kind: 'utility', util: `u${ui}`, gain: ev.gain, note: ev.note, tags: ev.tags,
        title: `${name(u.thrower)}: ${u.type === 'molotov' ? 'molotov' : u.type === 'he' ? 'HE grenade' : 'smoke'}${where(worldToRadar({ x: u.x, y: u.y }, engine.map.radar))}${thrownFrom(u)}`,
        why: ev.why,
      });
      return;
    }
    const hits = sim.utilEvents.filter(e => e.src === `u${ui}` && e.amount >= 0.7);
    const enemy = hits.filter(e => sideOf.get(e.id) !== s), team = hits.filter(e => sideOf.get(e.id) === s);
    const assisted = enemy.filter(e => sim.kills.some(k => k.victim === e.id && k.t >= e.t && k.t - e.t <= 3));
    const gain = 0.035 * Math.min(3, enemy.length) + 0.06 * assisted.length - 0.05 * team.length;
    const why = [];
    if (enemy.length) why.push(`Blinded ${enemy.length === 1 ? 'an enemy' : `${enemy.length} enemies`} (${enemy.map(e => e.amount.toFixed(1) + 's').join(', ')}).`);
    if (assisted.length) why.push(`${assisted.length} of them died within 3 s: the flash won the duel.`);
    if (team.length) why.push(`Team-flashed ${team.length} teammate${team.length > 1 ? 's' : ''}.`);
    if (!hits.length) why.push(`Blinded nobody.${bounceNote(u)}`);
    else if (enemy.length && u.bounces?.some(b => b[3] === 1)) why.push('Banked off a wall before it popped.');
    const tags: Tag[] = [];
    if (assisted.length) tags.push('FLASH ASSIST');
    if (team.length) tags.push('TEAM FLASH');
    if (!hits.length) tags.push('WASTED');
    // !! two kills off one flash; ! a kill off it or three enemies blinded; ?? a blinded teammate died; ? only teammates
    // a teammate blinded properly (1.5 s+) who was killed by an enemy within 2 s
    const mateDied = team.filter(e => e.amount >= 1.5 && sim.kills.some(k => k.victim === e.id && k.killer && sideOf.get(k.killer) !== s && k.t >= e.t && k.t - e.t <= 2)).length;
    if (mateDied) why.push(`${mateDied === 1 ? 'A teammate you blinded' : `${mateDied} teammates you blinded`} died within 2 s.`);
    const note: Annotation = mateDied ? '??' : assisted.length >= 2 ? '!!' : assisted.length || enemy.length >= 3 ? '!' : team.length && !enemy.length ? '?' : 'book';
    moves.push({
      t: u.t, player: u.thrower, side: s, kind: 'flash', util: `u${ui}`, gain, note,
      title: `${name(u.thrower)}: flash${where(worldToRadar({ x: u.x, y: u.y }, engine.map.radar))}${thrownFrom(u)}`, why, tags,
    });
  });

  // the bomb: a plant is book (the plan working), a defuse is ! — !! with enemies still alive or almost no time left
  for (const b of r.bomb ?? []) {
    if ((b.kind !== 'plant' && b.kind !== 'defuse') || !sideOf.has(b.id)) continue;
    const s = sideOf.get(b.id)!;
    const at = worldToRadar({ x: b.x, y: b.y }, engine.map.radar);
    const before = stateAt(b.t - 0.05), after = b.kind === 'defuse' ? 1 : stateAt(b.t + 0.05);
    const gain = forSide(s, after - before);
    const why = [`${s} win chance ${pct(s === 'CT' ? before : 1 - before)} → ${pct(s === 'CT' ? after : 1 - after)}.`];
    const tags: Tag[] = [b.kind === 'plant' ? 'PLANT' : 'DEFUSE'];
    let note: Annotation = 'book', title = `${name(b.id)} planted the bomb${where(at)}`;
    if (b.kind === 'defuse') {
      const left = r.plant !== null ? BOMB_TIME - (b.t - r.plant) : null;
      const enemies = sim.ids.filter((id, j) => sideOf.get(id) !== s && alive(j, b.t)).length;
      const ninja = enemies > 0 || (left !== null && left < 1);
      if (enemies) why.push(`${enemies} enem${enemies > 1 ? 'ies were' : 'y was'} still alive.`);
      if (left !== null) why.push(`${left.toFixed(1)} s left on the bomb.`);
      if (ninja) tags.push('NINJA');
      note = ninja ? '!!' : '!';
      title = `${name(b.id)} defused the bomb${where(at)}${left !== null && left < 3 ? ` with ${left.toFixed(1)} s left` : ''}`;
    } else {
      const mates = sim.ids.filter((id, j) => sideOf.get(id) === s && alive(j, b.t)).length;
      const foes = sim.ids.filter((id, j) => sideOf.get(id) !== s && alive(j, b.t)).length;
      why.push(`Planted ${mates}v${foes}.`);
    }
    moves.push({ t: b.t, player: b.id, side: s, kind: 'objective', gain, note, title, why, tags });
  }

  // the analyst's view (analyst.ts): missed trades and bad rotations become the responsible player's move
  try {
    const an = analyzeRound(engine, r);
    const bench = analystBench(engine.map.id), proBench = proAnalystAvailable ? analystBench(engine.map.id, 'pro') : null;
    const pc = (v: number) => `${Math.round(v * 100)}%`;
    for (const tr of an.trades) {
      if (tr.traded) continue;
      // where level-10 teams (and pros) trade a death at this spot (for the victim's card and the missed trades below)
      const sp = tradeSpotOf(bench, tr.place), pp = proBench ? tradeSpotOf(proBench, tr.place) : null;
      const spotLine = sp && sp.traders.length
        ? `Deaths at ${tr.place} traded: level 10 ${pc(sp.tradedRate)}${pp ? ` · pros ${pc(pp.tradedRate)}` : ''}, mostly from ${sp.traders.slice(0, 2).map(t => `${t.place} (${t.dist} m)`).join(' or ')}, within ${sp.avgTime.toFixed(1)} s.`
        : null;
      const death = moves.find(m => m.kind === 'death' && m.player === tr.victim && Math.abs(m.t - tr.t) < 0.06);
      if (death && spotLine) death.why.push(spotLine);
      for (const c of tr.chances) {
        if (!c.sees || c.traded || c.diedAfter || c.dist >= 1500 || !sideOf.has(c.mate)) continue;
        // not a missed trade when their gun couldn't win it (pistol / SMG against a rifle or AWP), or they were nearly dead
        const kg = gunFromName(r.kills.find(q => q.victim === tr.victim && Math.abs(q.t - tr.t) < 0.06)?.weapon ?? '');
        const mg = bestGunClass(r, c.mate, tr.t);
        if (kg && (kg.cls === 'rifle' || kg.cls === 'awp') && mg && !['rifle', 'awp'].includes(mg)) continue;
        const mf = r.frames.players[c.mate];
        if (mf) { let k2 = 0; while (k2 < r.frames.t.length - 1 && r.frames.t[k2 + 1] <= tr.t) k2++; if ((mf.hp[k2] ?? 100) <= 25) continue; }
        moves.push({
          t: Math.min(r.duration, tr.t + 2), player: c.mate, side: sideOf.get(c.mate)!, kind: 'teamplay', gain: 0, note: '?', tags: ['NO TRADE'],
          title: `${name(c.mate)} didn't trade ${name(tr.victim)}${tr.place ? ` at ${tr.place}` : ''}`,
          why: [`${name(tr.victim)} died ${Math.round(c.dist * 0.0254)} m from you and you could see ${name(tr.killer)} within 3 s, but didn't take the trade.`,
            (() => {
              const at = sp?.traders.find(t => t.place === c.place), pro = pp?.traders.find(t => t.place === c.place);
              return at ? `From ${c.place} this trade is taken: level 10 ${pc(at.conv)}${pro ? ` · pros ${pc(pro.conv)}` : ''}.`
                : `Chances like this taken: level 10 ${pc(proTradeConversion())}${proBench ? ` · pros ${pc(proBench.trades.chanceConversion)}` : ''}.`;
            })(),
            ...(spotLine ? [spotLine] : []),
            'Swing right away: the killer is reloading or turning, and the trade window closes in about 2 s.'],
        });
      }
    }
    for (const ro of an.rotations) {
      if (!sideOf.has(ro.player) || !(ro.late || ro.overRotated)) continue;
      moves.push({
        // an inaccuracy, not a mistake: the call that moved them (or should have) isn't in the demo
        t: ro.arrive ?? ro.start, player: ro.player, side: sideOf.get(ro.player)!, kind: 'teamplay', gain: 0, note: '?!',
        tags: [ro.late ? 'LATE ROTATION' : 'OVER-ROTATION'],
        title: ro.late ? `${name(ro.player)} rotated ${ro.from} → ${ro.to} too late` : `${name(ro.player)} over-rotated ${ro.from} → ${ro.to}`,
        why: [ro.late ? `Got to ${ro.to} after the bomb was already down there.` : `Left ${ro.from}, which then got hit, for ${ro.to}, which didn't.`,
          ro.trigger ? `Moved after "${ro.trigger}".` : 'Moved without anything visible to react to: rotate on information.',
          'Calls aren\'t in the demo: if a teammate called the enemy there, the move itself was reasonable; the timing is what to look at.'],
      });
    }
    // micro: what the victim had in hand, ammo, footsteps, and whether their first shot was a moving one
    for (const d of an.duels) {
      const death = moves.find(m => m.kind === 'death' && m.player === d.victim && Math.abs(m.t - d.t) < 0.06);
      const f = r.frames.players[d.victim];
      if (!death || !f?.w || !f.am || !f.fl) continue;
      const ft = r.frames.t;
      let k = 0; while (k < ft.length - 1 && ft[k + 1] <= d.t - 0.2) k++;
      const w = f.w[k] ?? '';
      if (/knife|bayonet|karambit|dagger|flashbang|hegrenade|smokegrenade|molotov|incgrenade|decoy|c4/.test(w)) {
        death.tags.push('KNIFE OUT');
        const what = /c4/.test(w) ? 'the bomb' : /knife|bayonet|karambit|dagger/.test(w) ? 'the knife' : 'a grenade';
        // outgunned (an SMG or shotgun against rifles): reaching for utility instead of taking the fight is a sound plan
        if (death.tags.includes('OUTGUNNED')) death.why.push(`Had ${what} out: with a weaker gun, playing utility instead of the duel is reasonable; the risk is being caught while switching.`);
        else { if (death.note === 'book' || death.note === '?!') death.note = '?'; death.why.push(`Had ${what} out instead of a gun.`); }
      }
      else if (f.am[k] >= 0 && f.am[k] <= 3 && w !== 'awp' && gunFromName(w)) { death.tags.push('NO AMMO'); death.why.push(`Only ${f.am[k]} bullet${f.am[k] === 1 ? '' : 's'} left in the magazine.`); }
      if (d.detail?.vMovingShot) { death.tags.push('MOVING SHOT'); death.why.push('Their first shot was fired while still moving (no counter-strafe).'); }
      const k0 = Math.max(1, k - 6);
      let loud = 0;
      for (let j = k0; j <= k; j++) { const sp = Math.hypot(f.x[j] - f.x[j - 1], f.y[j] - f.y[j - 1]) / ((ft[j] - ft[j - 1]) || 0.25); if (sp > 150 && !(f.fl[j] & (FL.walking | FL.crouching))) loud++; }
      const killer = r.frames.players[d.killer];
      if (loud >= 4 && killer && Math.hypot(killer.x[k] - f.x[k], killer.y[k] - f.y[k]) < 1100) { death.tags.push('LOUD'); death.why.push('Was running (footsteps) toward an enemy close enough to hear it.'); }
    }
    // the duel model: each fight's odds at first contact, for the winner and the loser
    const RANK: Annotation[] = ['!!', '!', 'book', '?!', '?', '??'];
    const atLeast = (m: Move, n: Annotation) => { if (RANK.indexOf(m.note) < RANK.indexOf(n)) m.note = n; };
    for (const d of an.duels) {
      const death = moves.find(m => m.kind === 'death' && m.player === d.victim && Math.abs(m.t - d.t) < 0.06);
      const kill = moves.find(m => m.kind === 'kill' && m.player === d.killer && Math.abs(m.t - d.t) < 0.06);
      const lost = duelModelOdds(d, 'victim', undefined, engine.map.id), won = duelModelOdds(d, 'killer', undefined, engine.map.id);
      if (death && lost) {
        death.why.push(`Duel odds ${pctOdds(lost.p)}${lost.peek !== null && lost.held !== null ? `; for level 10 from here: peeking wins ${pctOdds(lost.peek)}, holding ${pctOdds(lost.held)}` : ''}.`);
        if (lost.peek !== null && lost.peek < 0.35 && lost.p < 0.4 && !d.withFlash) {
          death.tags.push('BAD PEEK');
          // a bad peek alone and already hurt is a mistake, not just an inaccuracy
          atLeast(death, death.tags.includes('ISOLATED') && death.tags.includes('LOW HP') ? '?' : '?!');
        }
        // a fight they were the clear favourite in, lost without a missed spray or the wrong thing in hand: more bad
        // luck (or a great shot) than a bad decision, so at most an inaccuracy
        if (lost.p >= 0.7 && (death.note === '?' || death.note === '??') && !death.tags.some(t => (['WHIFF', 'KNIFE OUT', 'NO AMMO', 'ECO DEATH'] as Tag[]).includes(t))) {
          death.note = '?!';
          death.why.push(`You were the favourite in this fight (${pctOdds(lost.p)}): a duel you usually win, so more bad luck than a bad call.`);
        }
      }
      if (kill && won) {
        kill.why.push(`Duel odds: ${pctOdds(won.p)} going into it${won.peek !== null && won.held !== null ? ` (a level-10 peek here: ${pctOdds(won.peek)}, holding still: ${pctOdds(won.held)})` : ''}.`);
        if (won.p < 0.3) { kill.tags.push('LONG ODDS'); if (kill.note === 'book') kill.note = '!'; }
      }
    }
    // a death from swinging into a held angle without a flash
    for (const d of an.duels) {
      if (d.style !== 'held' || d.flashed) continue;
      const death = moves.find(m => m.kind === 'death' && m.player === d.victim && Math.abs(m.t - d.t) < 0.06);
      const flashedFor = r.blind.some(b => b.victim === d.killer && b.t <= d.t && d.t - b.t <= 2.5);
      if (death && !flashedFor) {
        death.tags.push('DRY PEEK'); death.why.push('Swung into a player holding the angle, with no flash on them.');
        // the job is to take the spot, not to swing a held angle dry: the role doesn't excuse that
        if (onRoleDeaths.has(death)) {
          death.why = death.why.filter(w => !w.includes('usual job'));
          atLeast(death, '?');
        }
      }
    }
  } catch { /* the analyst is extra */ }

  // the search engine (search.ts): every 2 s of every player, what they could have done, calculated ahead; its
  // clearest mistakes become moves (shown with "Mine")
  let search: RoundSearch | undefined;
  try {
    search = searchRound(engine, r);
    const signed = (c: number) => (Math.abs(c) < 0.0005 ? '±0%' : `${c > 0 ? '−' : '+'}${Math.abs(Math.round(c * 1000) / 10)}%`);
    for (const m of keySearchMoments(search, 1, true)) {
      if (!sideOf.has(m.player)) continue;
      const best = m.options[0];
      // a retake: a CT closing in on the planted bomb is doing the job; the engine only prefers another way in
      const bomb = m.side === 'CT' ? bombAt(r, m.t) : null;
      const from = m.did.path?.[0] ?? m.options.find(o => o.kind === 'hold')?.to;
      const onMap = bomb && (bomb.kind === 'plant' || bomb.kind === 'defuse') ? { x: bomb.x, y: bomb.y } : null;
      const world = (p: Vec2) => radarToWorld(p, engine.map.radar);
      const retaking = !!onMap && !!from && walkDistance(engine, world(m.did.to), onMap) < walkDistance(engine, world(from), onMap) * 0.9;
      moves.push({
        t: m.t, player: m.player, side: m.side, kind: 'position', gain: -m.cost, note: retaking ? '?!' : m.cls === 'Blunder' ? '??' : '?', tags: [],
        title: `${name(m.player)}: ${m.did.label}; best was ${best.label.charAt(0).toLowerCase()}${best.label.slice(1)}`,
        why: [
          `Engine: ${m.cls}, accuracy ${Math.round(m.accuracy)}. It cost about ${(m.cost * 100).toFixed(1)}% of the round.`,
          `Options: ${m.options.slice(0, 4).map((o, i) => (i === 0 ? `${o.label} (best)` : `${o.label} ${signed((best.win - o.win) * COST_SCALE)}`)).join(', ')}.`,
          ...(m.did.death >= 0.25 ? [`What you did: about ${Math.round(m.did.death * 100)}% to die in the next seconds${m.did.kills ? `, ${m.did.kills.toFixed(1)} kills expected` : ''}.`] : []),
          ...(best.death < m.did.death - 0.1 ? [`${best.label}: ${Math.round(best.death * 100)}% to die${best.kills ? `, ${best.kills.toFixed(1)} kills expected` : ''}.`] : []),
          // thinking two moves ahead: the best line, the best from where they went, and what they really did next
          ...(m.deep && best.next ? [`Best line: ${best.label} → then ${best.next.label.charAt(0).toLowerCase()}${best.next.label.slice(1)}.`] : []),
          ...(m.deep && m.did.next ? [`From where you went, the best next move was ${m.did.next.label.charAt(0).toLowerCase()}${m.did.next.label.slice(1)}.`] : []),
          ...(m.then ? [`What you did next: ${m.then.label.charAt(0).toLowerCase()}${m.then.label.slice(1)} (${m.then.cls}).`] : []),
          ...(retaking ? ['A retake: you were moving in on the bomb, so this is only about which way in.'] : []),
        ],
      });
    }
  } catch { /* the engine is extra */ }

  // step 4, "what would a level-10 player do now": every 2 s of every player against the level-10 choices
  let play: RoundPlay | undefined;
  try {
    if (PLAY_MODEL) {
      const vs = roundMoments(engine, r, 2).map(m => judgeMoment(m, PLAY_MODEL!)).filter((v): v is MomentVerdict => !!v && sideOf.has(v.player));
      const stats: RoundPlay['stats'] = {};
      for (const v of vs) { const x = (stats[v.player] ??= { n: 0, usual: 0 }); x.n++; if (v.usual) x.usual++; }
      // pushing toward where a teammate just died is taking that space back (or going for the trade), and pushing with
      // a teammate alongside is the team moving up: neither is a needless lone push
      const together = (v: MomentVerdict) => {
        const i = idx(v.player);
        if (i < 0) return false;
        const t2 = Math.min(r.duration, v.t + 4), me = posAt(i, t2);
        return sim.ids.some((id, j) => j !== i && sideOf.get(id) === v.side && alive(j, t2) && Math.hypot(posAt(j, t2).x - me.x, posAt(j, t2).y - me.y) * scale < 700);
      };
      const retaking = (v: MomentVerdict) => v.did === 'push' && (together(v) || sim.kills.some(k => {
        if (sideOf.get(k.victim) !== v.side || k.t > v.t || v.t - k.t > 10) return false;
        const i = idx(v.player);
        if (i < 0) return false;
        const a = posAt(i, v.t), b = posAt(i, Math.min(r.duration, v.t + 4));
        return Math.hypot(b.x - k.at.x, b.y - k.at.y) < Math.hypot(a.x - k.at.x, a.y - k.at.y) - 250 / scale;
      }));
      const key = keyMoments(vs).filter(v => !retaking(v) && !moves.some(m => m.kind === 'position' && m.player === v.player && Math.abs(m.t - v.t) < 6));
      for (const v of key)
        moves.push({ t: v.t, player: v.player, side: v.side, kind: 'position', gain: 0, note: v.pro[0].share >= 0.75 && v.share < 0.03 ? '?' : '?!', tags: [],
          title: `${name(v.player)} chose to ${ACTION_TEXT[v.did]}; a level-10 player would ${ACTION_TEXT[v.pro[0].a]}`,
          why: [momentLine(v), `They ${ACTION_TEXT[v.did]} here only ${pctPlay(v.share)} of the time.`] });
      play = { stats, key: key.map(v => ({ t: v.t, player: v.player, did: v.did, best: v.pro[0].a, share: +v.share.toFixed(3), agree: +v.pro[0].share.toFixed(3) })) };
    }
  } catch { /* the play model is extra */ }

  moves.sort((a, b) => a.t - b.t || (a.kind === 'kill' ? -1 : 1));
  const players: Review['players'] = {};
  for (const id of sim.ids) players[id] = { impact: 0, counts: { '!!': 0, '!': 0, book: 0, '?!': 0, '?': 0, '??': 0 } };
  for (const m of moves) {
    if (!players[m.player]) continue;
    if (m.kind !== 'position') players[m.player].impact += m.gain;
    players[m.player].counts[m.note]++;
  }
  const turningPoint = moves.filter(m => m.kind !== 'death' && m.kind !== 'position').reduce<Move | null>((best, m) => (!best || Math.abs(m.gain) > Math.abs(best.gain) ? m : best), null);
  return { curve, moves, players, roles: playerRoles(engine, rep, moves), turningPoint, ...(play ? { play } : {}), ...(search ? { search } : {}) };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;

/**
 * What each player did this round, guessed from how they played it:
 *   AWPer — carried the AWP · Entry — first T into a fight · Lurk — T far from the pack
 *   Support — threw 2+ smokes/flashes · Anchor — CT who stayed on one site · Rotator — CT who covered both
 */
export function playerRoles(engine: TacticalEngine, rep: Replay, moves: Move[]): Record<string, PlayerRole> {
  const { sim, board, round: r } = rep;
  const scale = engine.map.radar.scale;
  const sideOf = new Map(board.players.map(p => [p.id, p.side]));
  const out: Record<string, PlayerRole> = {};
  const fights = moves.filter(m => m.kind === 'kill' || m.kind === 'death');
  const firstT = fights.find(m => m.side === 'T');
  const kills = (id: string) => fights.filter(m => m.kind === 'kill' && m.player === id).length;
  sim.ids.forEach((id, i) => {
    const side = sideOf.get(id)!;
    const alive = (s: number) => s * SIM_DT < sim.deathT[i];
    const samples: number[] = [];
    for (let s = 0; s < sim.steps; s += 10) if (alive(s)) samples.push(s);
    const nades = r.util.filter(u => u.thrower === id && (u.type === 'smoke' || u.type === 'flash'));
    const goodNades = moves.filter(m => m.util && m.player === id && m.gain >= 0.03).length;
    if (r.econ?.[id] && weaponClass(r.econ[id].weapons) === 'awp') { out[id] = { role: 'AWPer', note: `${kills(id)} kill${kills(id) === 1 ? '' : 's'} with the AWP` }; return; }
    if (side === 'T') {
      if (firstT?.player === id) { out[id] = { role: 'Entry', note: `First into a fight at ${clock(firstT.t)}, ${firstT.kind === 'kill' ? 'won it' : 'lost it'}` }; return; }
      // distance from the other living Ts, on average
      let far = 0, sum = 0;
      for (const s of samples) {
        const mates = sim.ids.map((_, j) => j).filter(j => j !== i && sideOf.get(sim.ids[j]) === 'T' && alive(s));
        if (!mates.length) continue;
        const cx = mates.reduce((a, j) => a + sim.x[j][s], 0) / mates.length, cy = mates.reduce((a, j) => a + sim.y[j][s], 0) / mates.length;
        const d = Math.hypot(sim.x[i][s] - cx, sim.y[i][s] - cy) * scale;
        sum += d; if (d > 1500) far++;
      }
      if (samples.length && far / samples.length > 0.5) { out[id] = { role: 'Lurk', note: `Played ~${Math.round(sum / samples.length / 100) * 100} u away from the team` }; return; }
    } else {
      const near = (site: 'A' | 'B', s: number) => {
        const c = engine.map.sites[site];
        return Math.hypot(sim.x[i][s] - c.center.x, sim.y[i][s] - c.center.y) < c.radius * 1.6;
      };
      const onA = samples.filter(s => near('A', s)).length, onB = samples.filter(s => near('B', s)).length;
      const n = Math.max(1, samples.length);
      if (onA / n > 0.15 && onB / n > 0.15) { out[id] = { role: 'Rotator', note: 'Played both sites' }; return; }
      const site = onA >= onB ? 'A' : 'B';
      const held = Math.max(onA, onB);
      if (held / n > 0.5) { out[id] = { role: 'Anchor', note: `Held ${site} for ${Math.round(held)} s` }; return; }
    }
    if (nades.length >= 2) { out[id] = { role: 'Support', note: `${nades.length} smokes/flashes, ${goodNades} useful` }; return; }
    out[id] = { role: 'Rifler', note: `${kills(id)} kill${kills(id) === 1 ? '' : 's'}` };
  });
  return out;
}
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** CT win chance at round time t, interpolated from the eval curve. */
export function evalAt(curve: Review['curve'], t: number): number {
  if (!curve.length) return 0.5;
  if (t <= curve[0].t) return curve[0].ct;
  for (let i = 1; i < curve.length; i++)
    if (curve[i].t >= t) {
      const a = curve[i - 1], b = curve[i];
      return a.ct + ((b.ct - a.ct) * (t - a.t)) / (b.t - a.t || 1);
    }
  return curve[curve.length - 1].ct;
}

/** Moves that have happened by round time t (or all of them when spoilers are on). */
export const movesUntil = (rv: Review, t: number, all: boolean) => (all ? rv.moves : rv.moves.filter(m => m.t <= t + 0.01));

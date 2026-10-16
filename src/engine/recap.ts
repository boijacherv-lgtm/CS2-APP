import { FLASH_POP, HE_POP, SIM_DT, type KillEvent, type Simulation } from './combat';
import { computeControl } from './control';
import { worldToRadar } from './coords';
import { gunFromName, primaryGun } from './guns';
import { lifeOf, segmentHitsCircle, SMOKE_RADIUS_UNITS, UTIL_FLIGHT } from './grid';
import type { TacticalEngine } from './predict';
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
  frames: { t: number[]; players: Record<string, { side: Side; x: number[]; y: number[]; z: number[]; yaw: number[]; hp: number[]; alive: number[] }> };
  kills: { t: number; attacker: string; victim: string; weapon: string; headshot: boolean; x: number; y: number; ax: number; ay: number }[];
  util: {
    t: number; type: UtilType; thrower: string; x: number; y: number;
    /** Release time, flight path (world x/y) and when the smoke/fire ended; older parses don't have them. */
    throwT?: number; path?: [number, number][]; end?: number;
    /** Where it was thrown from (world x/y) when there's no flight path (browser build). */
    from?: [number, number];
  }[];
  /** Damage done by HE grenades and fire. */
  nadeDamage?: { t: number; attacker: string; victim: string; dmg: number; weapon: 'he' | 'molotov' }[];
  /** Every gun shot fired, and every gun hit (damage to health). */
  shots?: { t: number; id: string }[];
  hits?: { t: number; attacker: string; victim: string; dmg: number; head: boolean }[];
  blind: { t: number; victim: string; attacker: string; dur: number }[];
  /** Each player's economy a few seconds into the round (after buying). */
  econ?: Record<string, PlayerEcon>;
  /** What happens to the bomb (world x/y = the player's position); older parses don't have it. */
  bomb?: BombEvent[];
}

export interface BombEvent { t: number; kind: 'carry' | 'drop' | 'plant' | 'defuse' | 'explode'; id: string; x: number; y: number }
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
}

// ---- replay -----------------------------------------------------------------------------------

export interface Replay {
  board: BoardState;
  sim: Simulation;
  names: Record<string, string>;
  round: DemoRound;
  ranks: Record<string, PlayerRank>;
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
    const cause: KillEvent['cause'] = w.includes('hegrenade') ? 'he' : w.includes('inferno') || w.includes('molotov') ? 'molotov' : 'gun';
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
  return { board: { players, utility, context }, sim, names: demo.names, round: r, ranks: demo.ranks ?? {} };
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
}): number {
  const { ct, t } = state;
  if (t === 0 && state.planted === null) return 1;
  if (ct === 0) return 0;
  if (t === 0 && state.planted !== null) return 0.25; // retake vs bomb timer with nobody to stop the defuse attempt
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
 * One letter scale for everything: a move, a player's round and their whole match all go S+ … F. For a move the
 * letter is how much it changed their team's chance to win the round (see grade()); C is neutral and not shown.
 */
export type Letter = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type Grade = Letter;
export const LETTER_COLOR: Record<Letter, string> = {
  'S+': '#f5c542', S: '#22c55e', A: '#7fbf4d', B: '#5c8bd6', C: '#a39b8f', D: '#e5a52a', E: '#ec6b34', F: '#e5483a',
};
export const GRADE_INFO: Record<Grade, { mark: string; label: string; color: string }> = {
  'S+': { mark: 'S+', label: 'Round-swinging', color: LETTER_COLOR['S+'] },
  S: { mark: 'S', label: 'Excellent', color: LETTER_COLOR.S },
  A: { mark: 'A', label: 'Great', color: LETTER_COLOR.A },
  B: { mark: 'B', label: 'Good', color: LETTER_COLOR.B },
  C: { mark: 'C', label: 'Neutral', color: LETTER_COLOR.C },
  D: { mark: 'D', label: 'Weak', color: LETTER_COLOR.D },
  E: { mark: 'E', label: 'Bad', color: LETTER_COLOR.E },
  F: { mark: 'F', label: 'Terrible', color: LETTER_COLOR.F },
};
export const LETTERS: Letter[] = ['S+', 'S', 'A', 'B', 'C', 'D', 'E', 'F'];

/** Context tags: the one-word "why" next to a grade (like a match feed). */
export type Tag =
  | 'OPENING' | 'TRADE' | 'TRADED' | 'ISOLATED' | 'CROSSFIRE' | 'CLUTCH' | 'MULTI-KILL' | 'ECO FRAG' | 'AWP DOWN' | 'AWP LOST'
  | 'FLASH ASSIST' | 'NADE ASSIST' | 'BLIND' | 'LOW HP' | 'TEAM FLASH' | 'TEAM DAMAGE' | 'WASTED' | 'DENIED' | 'POST-PLANT' | 'UNUSED UTIL' | 'WHIFF' | 'UPSET';
const GOOD = '#22c55e', BAD = '#ef4444', UTIL = '#3b82f6', INFO = '#a39b8f';
export const TAG_INFO: Record<Tag, { color: string; tip: string }> = {
  OPENING: { color: INFO, tip: 'First kill of the round.' },
  TRADE: { color: GOOD, tip: 'Killed the enemy who had just killed a teammate.' },
  TRADED: { color: INFO, tip: 'A teammate killed their killer within 5 s, so the death bought space.' },
  ISOLATED: { color: BAD, tip: 'Died with no teammate close enough to trade.' },
  CROSSFIRE: { color: BAD, tip: 'Was in view of two or more enemies at once.' },
  CLUTCH: { color: GOOD, tip: 'Last player alive on the team, against two or more.' },
  'MULTI-KILL': { color: GOOD, tip: 'Three or more kills within a few seconds.' },
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
};

export interface Move {
  t: number;
  player: string;
  side: Side;
  kind: 'kill' | 'death' | 'flash' | 'utility';
  /** The grenade this move is about (Utility id in the replay board). */
  util?: string;
  /** Change in this player's team win chance (e.g. +0.12 = +12%). */
  gain: number;
  grade: Grade;
  title: string;
  why: string[];
  tags: Tag[];
}

export type Role = 'Entry' | 'Lurk' | 'Support' | 'AWPer' | 'Anchor' | 'Rotator' | 'Rifler';
export interface PlayerRole { role: Role; note: string }

const TAG_POINTS: Partial<Record<Tag, number>> = { CLUTCH: 5, 'MULTI-KILL': 3, 'TEAM FLASH': -2, 'TEAM DAMAGE': -3, 'UNUSED UTIL': -2 };
/** Letter from a player's moves: their win-chance impact (in points) plus a few things % misses. */
export function letterGrade(moves: Move[]): { letter: Letter; points: number } {
  let pts = 0;
  for (const m of moves) { pts += m.gain * 100; for (const t of m.tags) pts += TAG_POINTS[t] ?? 0; }
  const letter: Letter = pts >= 35 ? 'S+' : pts >= 22 ? 'S' : pts >= 12 ? 'A' : pts >= 4 ? 'B' : pts > -4 ? 'C' : pts > -12 ? 'D' : pts > -22 ? 'E' : 'F';
  return { letter, points: pts };
}

/**
 * Moves that get a visible letter. Neutral moves (C) don't. Deaths only do when they cost the team: not traded and
 * at least 8% of win chance (E or F); ordinary deaths stay unmarked so the map stays readable, but every death's
 * win-chance loss still counts toward the player's impact and round letter.
 */
export const isMarked = (m: Move) => m.grade !== 'C' && (m.kind !== 'death' || (!m.tags.includes('TRADED') && (m.grade === 'E' || m.grade === 'F')));

/**
 * Which moves get evaluated on screen (letters on the map and the timeline, the killfeed letters, the move cards and
 * ◀ ▶), so they always agree. 'all' is every move: every kill, every death, every grenade and flash, neutral C too.
 * 'mine' is every move of one player (you, when you're logged in with Steam).
 */
export type EvalScope = 'all' | 'mine';
export function evaluated(scope: EvalScope, me: string | null): (m: Move) => boolean {
  return scope === 'mine' && me ? m => m.player === me : () => true;
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
  const chars = m.title.length + m.why.join(' ').length;
  // the moves that swing a round get the full time; small ones (B / D) a quicker look
  const big = m.grade === 'S+' || m.grade === 'S' || m.grade === 'A' || m.grade === 'E' || m.grade === 'F';
  return big ? Math.max(1800, Math.min(4000, 800 + 20 * chars)) : Math.max(1200, Math.min(2500, 500 + 12 * chars));
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
  players: Record<string, { impact: number; counts: Record<Grade, number> }>;
  roles: Record<string, PlayerRole>;
  turningPoint: Move | null;
}

/** A move's letter from the change in its team's win chance (in whole %, as shown, so +10% is always an A). */
function grade(gain: number): Grade {
  const p = Math.round(gain * 100);
  if (p >= 25) return 'S+';
  if (p >= 15) return 'S';
  if (p >= 10) return 'A';
  if (p >= 3) return 'B';
  if (p > -3) return 'C';
  if (p > -8) return 'D';
  if (p > -15) return 'E';
  return 'F';
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

  const gear = new Map(sim.ids.map(id => [id, equipValue(r.econ?.[id])]));
  const hasEcon = [...gear.values()].some(v => v !== null);
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
    });
  };

  const curve: Review['curve'] = [];
  for (let t = 0; t <= r.duration + 0.01; t += 0.5) curve.push({ t, ct: stateAt(t) });

  const moves: Move[] = [];
  const forSide = (s: Side, ctDelta: number) => (s === 'CT' ? ctDelta : -ctDelta);
  const enemiesSeeing = (i: number, t: number, exclude?: number) => {
    const me = posAt(i, t), mySide = sideOf.get(sim.ids[i]);
    return sim.ids.filter((id, j) => j !== exclude && sideOf.get(id) !== mySide && alive(j, t - 0.05) && Math.hypot(posAt(j, t).x - me.x, posAt(j, t).y - me.y) < 1100 && g.lineOfSight(posAt(j, t), me)).length;
  };
  const teammatesNear = (i: number, t: number) => {
    const me = posAt(i, t), mySide = sideOf.get(sim.ids[i]);
    return sim.ids.filter((id, j) => j !== i && sideOf.get(id) === mySide && alive(j, t - 0.05)
      && (Math.hypot(posAt(j, t).x - me.x, posAt(j, t).y - me.y) * scale < 600 || g.lineOfSight(posAt(j, t), me))).length;
  };
  /**
   * The callout a spot belongs to: the nearest one you can see from there (not one behind a wall), a detailed spot
   * (Boost, Default…) only when it's right there, and the plain nearest one as a fallback.
   */
  const placeOf = (p: Vec2): string => {
    const g = engine.grid;
    let best = '', bd = Infinity;
    for (const c of engine.map.callouts) {
      const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y);
      const limit = c.minor ? 45 : 170;
      if (d < limit && d < bd && g.lineOfSight(p, c.pos)) { bd = d; best = c.name; }
    }
    if (best) return best;
    for (const c of engine.map.callouts) { const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y); if (!c.minor && d < 120 && d < bd) { bd = d; best = c.name; } }
    return best;
  };
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
  sim.kills.forEach((k, n) => {
    const dk = demoKill(k);
    const kGun = dk ? gunFromName(dk.weapon) : undefined;
    const withGun = kGun ? ` with ${kGun.name}${dk?.headshot ? ' (headshot)' : ''}`
      : k.cause === 'he' ? ' with an HE grenade' : k.cause === 'molotov' ? ' with fire' : dk?.headshot ? ' (headshot)' : '';
    const before = stateAt(k.t - 0.05), after = stateAt(k.t + 0.05);
    const ctDelta = after - before;
    const vi = idx(k.victim);
    const vSide = sideOf.get(k.victim)!;
    const firstKill = n === 0;
    const ki = k.killer ? idx(k.killer) : -1;
    const killerAt = ki >= 0 ? posAt(ki, k.t) : null;
    const cause = k.cause === 'he' ? 'HE grenade' : k.cause === 'molotov' ? 'fire' : kGun?.name ?? '';

    // the victim
    const traded = k.killer && sim.kills.some(o => o.victim === k.killer && o.t > k.t && o.t - k.t <= 5 && sideOf.get(o.killer) === vSide);
    const seers = vi >= 0 ? enemiesSeeing(vi, k.t - 0.1) : 0;
    const support = vi >= 0 ? teammatesNear(vi, k.t - 0.1) : 0;
    const wasBlind = vi >= 0 && sim.blind[vi][Math.max(0, Math.round((k.t - 0.1) / SIM_DT))] === 1;
    const hpBefore = vi >= 0 ? hpAt(vi, k.t - 0.4) : 100;
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
    else if (support === 0) why.push('No teammate close enough to trade: an isolated death.');
    if (seers >= 2) why.push(`Exposed to ${seers} enemies at once (crossfire).`);
    if (wasBlind) why.push('Was flashed when it happened.');
    if (hpBefore < 50 && hpBefore > 0) why.push(`Already hurt (${hpBefore} hp) before the duel.`);
    if (k.cause !== 'gun') why.push(k.cause === 'he' ? 'Killed by an HE grenade.' : 'Burned by a molotov: stood in fire.');
    if (firstKill) why.push('First death of the round (lost the opening duel).');
    const lost = gear.get(k.victim);
    const vAwp = !!r.econ?.[k.victim] && weaponClass(r.econ[k.victim].weapons) === 'awp';
    if (lost != null && lost >= 3000) why.push(`Lost ${money(lost)} of gear${vAwp ? ' (incl. the AWP)' : ''}.`);
    const unused = unusedNades(k.victim, k.t);
    if (unused >= 2) why.push(`Died with ${unused} grenades unused.`);
    const postPlant = r.plant !== null && k.t >= r.plant;
    const vTags: Tag[] = [];
    if (firstKill) vTags.push('OPENING');
    if (traded) vTags.push('TRADED'); else if (support === 0) vTags.push('ISOLATED');
    if (seers >= 2) vTags.push('CROSSFIRE');
    if (wasBlind) vTags.push('BLIND');
    if (hpBefore < 50 && hpBefore > 0) vTags.push('LOW HP');
    if (vAwp) vTags.push('AWP LOST');
    if (unused >= 2) vTags.push('UNUSED UTIL');
    if (whiff) vTags.push('WHIFF');
    if (postPlant) vTags.push('POST-PLANT');
    moves.push({
      t: k.t, player: k.victim, side: vSide, kind: 'death', gain: loss, grade: grade(loss),
      title: `${name(k.victim)} died${where(k.at)}${k.killer && k.killer !== k.victim
        ? `: ${name(k.killer)}${killerAt && placeOf(killerAt) !== placeOf(k.at) ? ` from ${placeOf(killerAt)}` : ''}${cause ? `, ${cause}${dk?.headshot ? ' (headshot)' : ''}` : ''}`
        : cause ? ` (${cause})` : ''}`, why, tags: vTags,
    });

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
      if (others >= 1) awhy.push(`Won it while ${others} more enemy${others > 1 ? 'ies' : ''} had sight on them.`);
      if (multi >= 2) awhy.push(`Part of a ${multi}-kill burst.`);
      if (vi >= 0 && wasBlind) awhy.push('The victim was flashed: teamwork kill.');
      const vGear = gear.get(k.victim), aGear = gear.get(k.killer);
      if (vGear != null && r.econ?.[k.victim] && weaponClass(r.econ[k.victim].weapons) === 'awp') awhy.push('Took down the AWP.');
      else if (vGear != null && vGear < 1000) awhy.push('The victim was on an eco, so the kill is worth less.');
      if (aGear != null && vGear != null && aGear + 1500 < vGear) awhy.push(`Won it with ${money(aGear)} of gear against ${money(vGear)}.`);
      const vGun = r.econ?.[k.victim] ? primaryGun(r.econ[k.victim].weapons) : undefined;
      if (kGun && vGun && kGun.cls === 'pistol' && vGun.cls !== 'pistol') awhy.push(`Pistol (${kGun.name}) beat a ${vGun.name}.`);
      if (kGun?.id === 'awp' && dk?.headshot === false) awhy.push('AWP one-shot to the body.');
      // last one standing on their side, against two or more
      const mates = sim.ids.filter((id, j) => j !== ai && sideOf.get(id) === aSide && alive(j, k.t - 0.05)).length;
      const foes = sim.ids.filter((id, j) => sideOf.get(id) !== aSide && alive(j, k.t - 0.05)).length;
      const clutch = ai >= 0 && mates === 0 && foes >= 2;
      if (clutch) awhy.push(`1v${foes} clutch situation.`);
      const trade = sim.kills.some(o => o.killer === k.victim && o.t < k.t && k.t - o.t <= 5 && sideOf.get(o.victim) === aSide);
      if (trade) awhy.push('Traded a teammate\'s death.');
      if (upset) awhy.push(`Beat a higher-rated player (${num(rv!)} vs ${num(rk!)}): only a ${pct(aOdds!)} chance on paper.`);
      const aTags: Tag[] = [];
      if (firstKill) aTags.push('OPENING');
      if (clutch) aTags.push('CLUTCH');
      if (multi >= 3) aTags.push('MULTI-KILL');
      if (trade) aTags.push('TRADE');
      if (aGear != null && vGear != null && aGear < 2000 && aGear + 1500 < vGear) aTags.push('ECO FRAG');
      if (vAwp) aTags.push('AWP DOWN');
      if (vi >= 0 && wasBlind) aTags.push('FLASH ASSIST');
      if (upset) aTags.push('UPSET');
      if (postPlant) aTags.push('POST-PLANT');
      moves.push({
        t: k.t, player: k.killer, side: aSide, kind: 'kill', gain, grade: grade(gain),
        title: `${name(k.killer)} killed ${name(k.victim)}${where(k.at)}${from(killerAt, k.at)}${withGun}`, why: awhy, tags: aTags,
      });
    }
  });

  /**
   * Smokes, molotovs and HEs, graded by what they did:
   *   smoke   — enemy sightlines it cut (pairs of enemy ↔ teammate that would have seen each other, per second)
   *   molotov — damage, and enemies it kept off the ground it burned (were near it while it burned)
   *   HE      — damage, enemies it softened up who then died, team damage
   */
  const gradeNade = (ui: number): { gain: number; grade: Grade; why: string[]; tags: Tag[] } => {
    const u = r.util[ui];
    const s = sideOf.get(u.thrower)!;
    const nade = board.utility.find(x => x.id === `u${ui}`)!;
    const at = nade.pos;
    const from = u.t, to = u.t + lifeOf(nade);
    const enemiesOf = (side: Side) => sim.ids.map((id, j) => j).filter(j => sideOf.get(sim.ids[j]) !== side);
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
      gain = Math.min(0.09, 0.0035 * pairSec + 0.0018 * watchSec) - 0.03 * caught;
      if (pairSec) why.push(`Cut ${cut.size === 1 ? 'an enemy' : `${cut.size} enemies`} off from seeing your team (${pairSec} player-second${pairSec > 1 ? 's' : ''} of sightlines).`);
      if (blinded.size) why.push(`Blocked the view of ${blinded.size === 1 ? 'an enemy' : `${blinded.size} enemies`} looking that way (${watchSec} s).`);
      if (!pairSec && !blinded.size) why.push('Blocked nothing: no enemy was ever looking through it.');
      if (caught) why.push(`${caught} teammate${caught > 1 ? 's' : ''} died at the smoke anyway.`);
      if (nade.duration !== undefined && nade.duration < 12) why.push(`Cleared early (lasted ${nade.duration.toFixed(0)} s).`);
      const tags: Tag[] = !pairSec && !blinded.size ? ['WASTED'] : gain >= 0.03 ? ['DENIED'] : [];
      return { gain, grade: pairSec || blinded.size ? grade(gain) : 'D', why, tags };
    }

    // HE / molotov: damage and who it reached
    const softened = hitEnemies.filter(v => sim.kills.some(k => k.victim === v && k.t >= from && k.t - from <= (u.type === 'he' ? 5 : 8)));
    if (enemyDmg) why.push(`${enemyDmg} damage to ${hitEnemies.length === 1 ? 'an enemy' : `${hitEnemies.length} enemies`}.`);
    if (softened.length) why.push(`${hitEnemies.length === 1 ? 'They' : `${softened.length} of them`} died soon after: the damage set up the kill${softened.length > 1 ? 's' : ''}.`);
    if (teamDmg) why.push(`${teamDmg} damage to your own team.`);
    gain = 0.0006 * enemyDmg + 0.03 * softened.length - 0.0008 * teamDmg;
    const tags: Tag[] = [];
    if (softened.length) tags.push('NADE ASSIST');
    if (teamDmg >= 20) tags.push('TEAM DAMAGE');

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
      if (!near.size && !enemyDmg) { why.push('Burned empty ground: no enemy came near it.'); return { gain: Math.min(gain, -0.01), grade: 'D', why, tags: [...tags, 'WASTED'] }; }
    } else if (!enemyDmg) {
      why.push('Hit nobody.');
      return { gain: Math.min(gain, -0.01), grade: teamDmg >= 40 ? 'E' : 'D', why, tags: [...tags, 'WASTED'] };
    }
    return { gain, grade: grade(gain), why, tags };
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
        t: u.t, player: u.thrower, side: s, kind: 'utility', util: `u${ui}`, gain: ev.gain, grade: ev.grade, tags: ev.tags,
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
    if (!hits.length) why.push('Blinded nobody.');
    const tags: Tag[] = [];
    if (assisted.length) tags.push('FLASH ASSIST');
    if (team.length) tags.push('TEAM FLASH');
    if (!hits.length) tags.push('WASTED');
    moves.push({
      t: u.t, player: u.thrower, side: s, kind: 'flash', util: `u${ui}`, gain, grade: hits.length ? grade(gain) : 'D',
      title: `${name(u.thrower)}: flash${where(worldToRadar({ x: u.x, y: u.y }, engine.map.radar))}${thrownFrom(u)}`, why, tags,
    });
  });

  moves.sort((a, b) => a.t - b.t || (a.kind === 'kill' ? -1 : 1));
  const players: Review['players'] = {};
  for (const id of sim.ids) players[id] = { impact: 0, counts: { 'S+': 0, S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 } };
  for (const m of moves) {
    if (!players[m.player]) continue;
    players[m.player].impact += m.gain;
    if (m.kind !== 'death' || isMarked(m)) players[m.player].counts[m.grade]++;
  }
  const turningPoint = moves.filter(m => m.kind !== 'death').reduce<Move | null>((best, m) => (!best || Math.abs(m.gain) > Math.abs(best.gain) ? m : best), null);
  return { curve, moves, players, roles: playerRoles(engine, rep, moves), turningPoint };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

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

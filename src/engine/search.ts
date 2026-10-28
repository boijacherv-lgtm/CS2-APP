import { worldToRadar } from './coords';
import type { TacticalEngine } from './predict';
import { bombAt, equipValue, FL, gearAt, type DemoRound } from './recap';
import { controlCounts, learnedLogit, tradePending } from './winprob';
import { duelChance, type DuelSituation } from './duelModel';
import type { DuelFighter } from './analyst';
import { gunFromName } from './guns';
import { placeOf, phaseOf } from './situations';
import { advantageOf, proRisk, proSituationSpots, proSpots } from '../map/positions';
import { CELL, SMOKE_RADIUS_UNITS, type SmokeDisc } from './grid';
import type { Side, Vec2 } from './types';
import UTIL_SPOTS from '../map/generated/util-spots.json';
import CALIBRATION from './models/search-calibration.json';

/**
 * The search engine ("Stockfish for CS2"): at a moment of a round, for one player, it lists what they could have
 * done in the next few seconds and calculates each option a couple of steps ahead with the learned models, then
 * grades what they actually did by how much round win chance it gave up against the best option.
 *
 *   options      hold the spot · move to a spot level-10 players use then, reachable in ~8 s · peek each enemy their team knows
 *                about · throw a grenade they really carry (flash and peek, smoke and hold, molotov an enemy's spot,
 *                HE an enemy) · plant when they can
 *   step 1       where the option leaves them: which known enemies can see that spot (smokes included). Each fight
 *                is scored by the duel model (health, armour, guns at that range, who peeks, flashes, teammates)
 *   step 2       the enemy's reply: an enemy can also refuse a fight that's bad for them (fall back): the engine
 *                assumes the reply that's worst for the player, like a chess engine
 *   value        every outcome (kills, death, a trade by a teammate close by, the plant, time spent) is applied to
 *                the round and scored by the learned win-chance model; plus how that spot has gone for level-10
 *                players in the same situation (learn:positions), and their death rate there under pressure for
 *                the enemies nobody has seen
 *
 * It only uses what the player's team could know (enemies spotted in the last few seconds), not the whole server.
 * Values are model estimates, not exact like chess: CS2 has hidden information and aim is random. The classes
 * (Best … Blunder) are calibrated on level-10 players' own moments (tools/learn-analyst.ts).
 */
export type OptionKind = 'hold' | 'move' | 'peek' | 'flash' | 'smoke' | 'molotov' | 'he' | 'plant' | 'defuse' | 'actual';
export interface SearchOption {
  kind: OptionKind;
  /** e.g. "Hold Long Corner", "Peek Ramp (enemy seen)", "Flash and peek Palace". */
  label: string;
  /** Where it takes them (radar coordinates, for the arrow on the map). */
  to: Vec2;
  /** Grenade target (radar). */
  nade?: Vec2;
  /** The way there (a few radar points), for drawing it along the real route. */
  path?: Vec2[];
  /** Round win chance for their side after it (0..1). */
  win: number;
  /** Chance of dying in it, and expected kills. */
  death: number; kills: number;
}
export type SearchClass = 'Best' | 'Excellent' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder';
export interface SearchMoment {
  t: number; player: string; side: Side;
  /** The options, best first (up to 6), and what they did, valued the same way. */
  options: SearchOption[];
  did: SearchOption;
  /** The engine's loss against its best option (raw), and what that really costs in round win chance (calibrated on level-10 rounds). */
  loss: number;
  cost: number;
  cls: SearchClass;
  /** 0–100, like chess.com. */
  accuracy: number;
  /** Their side's win chance at the moment, before choosing. */
  before: number;
}

const H = 5; // seconds each option is looked at
const NO_SPOT_STATS = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.STRATBOARD_NO_SPOT_STATS === '1';
const REACH = 8; // seconds of travel for the "move" options
const PEEK_REACH = 4; // seconds: how far a peek can be
/** Seconds into the round before the engine's cards start (the opening is the team's plan). */
export const OPENING = 20;
const PLANT_REACH = 6; // seconds: a site this close counts as "go plant"
const SEEN = 4; // an enemy spotted this recently counts as known (at the last spot seen)
const PLANT_HEARD = 1200; // units: an enemy this near a plant comes for it
const PLANT_SEEN = 12; // …and for a plant (seconds on the spot), one spotted this recently
const HEARD = 600; // units (~15 m): an enemy this close is heard
const SHOTS_HEARD = 2000; // units (~50 m): gunfire this close tells where they are
const TRADE_DIST = 900; // units: a teammate this close can trade
const NADE_RANGE = 2200; // units: how far a standard grenade spot can be from the thrower
const NADE = /grenade|flashbang|molotov|incendiary|decoy/i;

// ---- calibration (percentiles of level-10 players' own loss) ------------------------------------------------
// costScale: the engine's raw losses exaggerate; level-10 rounds show what a point of it really costs (the cost shown)
const CAL = CALIBRATION as { thresholds?: number[] | null; scale?: number; costScale?: number };
const TH = CAL.thresholds ?? [0.01, 0.03, 0.06, 0.12];
export const COST_SCALE = CAL.costScale ?? 0.2;
/** chess.com-style accuracy from the real cost (win-chance points). */
export const searchAccuracy = (costPct: number) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * costPct * (CAL.scale || 1)) - 3.1669));
export const searchClass = (loss: number): SearchClass =>
  loss <= 0.003 ? 'Best' : loss <= TH[0] ? 'Excellent' : loss <= TH[1] ? 'Good' : loss <= TH[2] ? 'Inaccuracy' : loss <= TH[3] ? 'Mistake' : 'Blunder';
export const SEARCH_COLOR: Record<SearchClass, string> = {
  Best: '#1baca6', Excellent: '#5c9ced', Good: '#7fbf4d', Inaccuracy: '#f7c045', Mistake: '#e58f2a', Blunder: '#ca3431',
};

// ---- travel times: one distance field per callout, per map (cached) ----------------------------------------
const FIELDS = new WeakMap<TacticalEngine, Map<string, Float64Array>>();
/**
 * Walking distance (world units) from a spot to another, both in world coordinates: along the map to the callout
 * nearest the target (its distance field is cached per map), plus the last straight bit. Through walls never.
 */
export function walkDistance(engine: TacticalEngine, from: Vec2, to: Vec2): number {
  const R = engine.map.radar, toR = worldToRadar(to, R), fromR = worldToRadar(from, R);
  let best = engine.map.callouts[0], bd = Infinity;
  for (const c of engine.map.callouts) { if (c.minor) continue; const d = Math.hypot(c.pos.x - toR.x, c.pos.y - toR.y); if (d < bd) { bd = d; best = c; } }
  const f = best && calloutField(engine, best.name);
  const cell = engine.grid.snap(fromR);
  const along = f && cell >= 0 ? f[cell] : Infinity;
  return Number.isFinite(along) ? (along + bd) * R.scale : Math.hypot(to.x - from.x, to.y - from.y);
}
export function calloutField(engine: TacticalEngine, name: string, at?: Vec2): Float64Array | null {
  let m = FIELDS.get(engine);
  if (!m) { m = new Map(); FIELDS.set(engine, m); }
  if (m.has(name)) return m.get(name)!;
  const pos = at ?? engine.map.callouts.find(x => x.name === name)?.pos;
  if (!pos) return null;
  const f = engine.grid.distanceField([pos]);
  m.set(name, f);
  return f;
}

/** The way from `start` to a callout, following its distance field downhill: a point every few cells (radar). */
function pathDown(engine: TacticalEngine, field: Float64Array, start: Vec2): Vec2[] {
  const g = engine.grid, w = g.w;
  let i = g.snap(start);
  const out: Vec2[] = [];
  for (let step = 0; i >= 0 && step < 900 && field[i] > CELL * 1.5; step++) {
    const x = i % w, y = (i / w) | 0;
    let next = -1, best = field[i];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= g.h) continue;
        const j = ny * w + nx;
        if (field[j] < best) { best = field[j]; next = j; }
      }
    if (next < 0) break;
    i = next;
    if (step % 5 === 4) out.push({ x: ((i % w) + 0.5) * CELL, y: (((i / w) | 0) + 0.5) * CELL });
  }
  return out;
}
/** Points along a polyline about every `step` radar px. */
function along(pts: Vec2[], step = 20): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

type UtilSpot = { type: 'smoke' | 'molotov'; side: Side; x: number; y: number };
const SPOTS = UTIL_SPOTS as unknown as Record<string, UtilSpot[]>;

/** Everything a round needs for searching, computed once. */
export function roundSearcher(engine: TacticalEngine, r: DemoRound) {
  const ids = Object.keys(r.frames.players);
  const side = (id: string) => r.frames.players[id]?.side;
  const ft = r.frames.t;
  const idx = (t: number) => { let lo = 0, hi = ft.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ft[m] <= t) lo = m; else hi = m - 1; } return lo; };
  const deathT = new Map(r.kills.map(k => [k.victim, k.t]));
  const alive = (id: string, t: number) => { const f = r.frames.players[id]; return !!f && !!f.alive[idx(t)] && !((deathT.get(id) ?? Infinity) <= t); };
  const world = (id: string, t: number): Vec2 => { const f = r.frames.players[id], k = idx(t); return { x: f.x[k], y: f.y[k] }; };
  const radar = (w: Vec2) => worldToRadar(w, engine.map.radar);
  const pos = (id: string, t: number) => radar(world(id, t));
  const scale = engine.map.radar.scale; // world units per radar px
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) * scale; // radar points → units
  const where = (id: string, t: number) => (alive(id, t) ? pos(id, t) : null);
  const areas = controlCounts(engine, ids, side, where, Math.ceil(r.duration));
  const kills = r.kills.map(q => ({ t: q.t, killer: q.attacker, victim: q.victim }));
  const smokesAt = (t: number): SmokeDisc[] => r.util.filter(u => u.type === 'smoke' && u.t <= t && t <= (u.end ?? u.t + 18))
    .map(u => ({ pos: radar({ x: u.x, y: u.y }), r: SMOKE_RADIUS_UNITS / scale }));
  const spotted = (id: string, t: number) => { const f = r.frames.players[id], k = idx(t); return f.fl ? !!(f.fl[k] & FL.spotted) : false; };
  const sites = Object.entries(engine.map.sites) as ['A' | 'B', { center: Vec2; radius: number }][];
  const siteAt = (p: Vec2) => sites.find(([, s]) => Math.hypot(s.center.x - p.x, s.center.y - p.y) < s.radius * 1.2)?.[0] ?? null;
  const secPerPx = (s: Side) => engine.secPerPx(s, 'rifle');

  /** A fighter at time t as the duel model reads them; `moving` = peeking into the fight. */
  const fighter = (id: string, t: number, at: Vec2, moving: boolean, flashed = false): DuelFighter => {
    const g = gearAt(r, id, t);
    const inv = g?.inv ?? [];
    // the gun they'd fight with: their best one
    const guns = inv.map(w => ({ w, g: gunFromName(w) })).filter(x => x.g).sort((a, b) => b.g!.killRate - a.g!.killRate);
    const f = r.frames.players[id], k = idx(t);
    return {
      hp: f.hp[k] ?? 100, armor: (g?.armor ?? 0) > 0, helmet: !!g?.helmet, w: guns[0]?.w ?? f.w?.[k] ?? '',
      moving, scoped: false, crouch: false, air: false, flashed,
      mates: ids.filter(o => o !== id && side(o) === side(id) && alive(o, t) && dist(pos(o, t), at) < 1000).length,
    };
  };

  /** The win chance for `s` with some changes applied to the round at time t. */
  const winFor = (s: Side, t: number, d: { mine?: number; theirs?: number; myHp?: number; theirHp?: number; plant?: boolean; dt?: number; myAreas?: number; trade?: number } = {}) => {
    const tt = Math.min(r.duration, t + (d.dt ?? 0));
    const live = ids.filter(id => alive(id, t));
    const mine = live.filter(id => side(id) === s), theirs = live.filter(id => side(id) && side(id) !== s);
    const hp = (xs: string[]) => xs.reduce((a, id) => a + (r.frames.players[id].hp[idx(t)] ?? 100), 0);
    const eq = (xs: string[]) => { const v = xs.map(id => equipValue(r.econ?.[id])).filter((e): e is number => e !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const nMine = mine.length + (d.mine ?? 0), nTheirs = theirs.length + (d.theirs ?? 0);
    const planted = r.plant !== null && t >= r.plant ? r.plant : d.plant ? tt : null;
    if (nMine <= 0) return planted !== null && s === 'T' ? 0.05 : 0;
    if (nTheirs <= 0) return s === 'CT' && planted !== null ? 0.9 : 1;
    const sec = Math.min(areas.ct.length - 1, Math.max(0, Math.floor(t)));
    const tp = tradePending(kills, ids, side, where, t, scale);
    const my = { n: nMine, hp: hp(mine) + (d.myHp ?? 0), eq: eq(mine), areas: (s === 'CT' ? areas.ct[sec] : areas.t[sec]) + (d.myAreas ?? 0) };
    const th = { n: nTheirs, hp: hp(theirs) + (d.theirHp ?? 0), eq: eq(theirs), areas: s === 'CT' ? areas.t[sec] : areas.ct[sec] };
    const ct = s === 'CT' ? my : th, T = s === 'CT' ? th : my;
    const z = learnedLogit({
      ct: ct.n, t: T.n, ctHp: ct.hp, tHp: T.hp, ctEquip: ct.eq, tEquip: T.eq, planted, time: tt, ctAreas: ct.areas, tAreas: T.areas,
      tradeCT: tp.ct + (s === 'CT' ? d.trade ?? 0 : 0), tradeT: tp.t + (s === 'T' ? d.trade ?? 0 : 0), map: engine.map.id,
    });
    const pCT = z === null ? 0.5 : 1 / (1 + Math.exp(-z));
    return s === 'CT' ? pCT : 1 - pCT;
  };

  /** Enemies the player's team knows about at t: their last spot seen in the last few seconds. */
  /**
   * Enemies the player knows about at t: spotted by their team in the last few seconds (at the last spot seen), or
   * heard: close by (footsteps, ~15 m), or shooting in the last 3 s within ~50 m (where the shots came from).
   */
  const shotsBy = new Map<string, number[]>();
  for (const sh of r.shots ?? []) shotsBy.set(sh.id, [...(shotsBy.get(sh.id) ?? []), sh.t]);
  const known = (id: string, t: number, seen = SEEN) => {
    const me = pos(id, t);
    return ids.filter(e => side(e) && side(e) !== side(id) && alive(e, t)).flatMap(e => {
      for (let u = t; u >= t - seen; u -= 0.5) if (alive(e, u) && spotted(e, u)) return [{ id: e, at: pos(e, u), seenAgo: t - u }];
      const now = pos(e, t);
      if (dist(me, now) < HEARD) return [{ id: e, at: now, seenAgo: 0 }];
      const shot = (shotsBy.get(e) ?? []).filter(x => x <= t && t - x <= 3).at(-1);
      if (shot !== undefined && dist(me, pos(e, shot)) < SHOTS_HEARD) return [{ id: e, at: pos(e, shot), seenAgo: t - shot }];
      return [];
    });
  };

  return { ids, side, alive, pos, world, dist, known, fighter, winFor, smokesAt, siteAt, secPerPx, idx, spotted, radar, scale };
}
export type RoundSearcher = ReturnType<typeof roundSearcher>;

interface Plan { kind: OptionKind; label: string; to: Vec2; travel: number; /** the way there (radar), to see who can shoot them on it */ path?: Vec2[]; nade?: Vec2; flash?: string; smoke?: SmokeDisc; deny?: string; he?: string; plant?: boolean; defuse?: boolean }

/** The search at one moment, for one player (null when there's nothing to decide: dead, or no enemy left). */
export function searchMoment(engine: TacticalEngine, r: DemoRound, S: RoundSearcher, id: string, t: number): SearchMoment | null {
  const s = S.side(id);
  if (!s || !S.alive(id, t)) return null;
  const foes = S.ids.filter(e => S.side(e) && S.side(e) !== s && S.alive(e, t));
  if (!foes.length) return null;
  const me = S.pos(id, t);
  const enemies = S.known(id, t);
  const plantWatch = S.known(id, t, PLANT_SEEN);
  const smokes = S.smokesAt(t);
  const map = engine.map.id;
  const phase = phaseOf(t, r.plant);
  const mates = S.ids.filter(o => S.side(o) === s && S.alive(o, t));
  const adv = advantageOf([mates.length, foes.length]);
  const spx = S.secPerPx(s);
  const before = S.winFor(s, t);

  // ---- the options ------------------------------------------------------------------------------------------
  const plans: Plan[] = [];
  const here = placeOf(engine, me) || 'here';
  plans.push({ kind: 'hold', label: `Hold ${here}`, to: me, travel: 0 });
  // callouts reachable in REACH seconds (the closest few, plus every one level-10 players use here)
  const cell = engine.grid.snap(me);
  const reach = engine.map.callouts.filter(c => !c.minor).map(c => {
    const f = calloutField(engine, c.name);
    return { c, sec: f && cell >= 0 ? f[cell] * spx : Infinity };
  }).filter(x => x.sec > 0.8 && x.sec <= REACH).sort((a, b) => a.sec - b.sec);
  const used = new Set((proSituationSpots(map, s, phase, adv) ?? proSpots(map, s, phase)).filter(p => p.share >= 0.03).map(p => p.place));
  // only spots level-10 players actually go to at this point of the round (a safe spot nobody plays, like running
  // back to spawn mid-round, isn't a real option); the nearest two only when there's no data for this situation
  const usedHere = reach.filter(x => used.has(x.c.name)).slice(0, 7);
  const picked = usedHere.length >= 2 ? usedHere : [...usedHere, ...reach.slice(0, 2)];
  for (const x of picked) if (!plans.some(p => p.label === `Move to ${x.c.name}`)) plans.push({ kind: 'move', label: `Move to ${x.c.name}`, to: x.c.pos, travel: x.sec, path: pathDown(engine, calloutField(engine, x.c.name)!, me) });
  // peek each known enemy: the first point on the way to them that sees them
  for (const e of enemies.slice(0, 3)) {
    const path = engine.grid.shortestPath(me, e.at);
    if (!path) continue;
    let travelPx = 0, at: Vec2 | null = null;
    for (let i = 1; i < path.length; i++) {
      travelPx += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (engine.grid.lineOfSight(path[i], e.at, smokes)) { at = path[i]; break; }
    }
    // a peek is a swing at an enemy close by, not a walk across the map
    if (!at || travelPx * spx > PEEK_REACH) continue;
    const where = placeOf(engine, e.at) || 'the enemy';
    const way = along(path.slice(0, path.indexOf(at) + 1));
    plans.push({ kind: 'peek', label: `Peek ${where}`, to: at, travel: travelPx * spx, path: way });
    // with a grenade they really have
    const inv = gearAt(r, id, t)?.inv ?? [];
    if (inv.some(w => /flash/i.test(w))) plans.push({ kind: 'flash', label: `Flash and peek ${where}`, to: at, travel: travelPx * spx + 0.6, nade: e.at, flash: e.id, path: way });
    if (inv.some(w => /high explosive|hegrenade/i.test(w)) && S.dist(me, e.at) < NADE_RANGE) plans.push({ kind: 'he', label: `HE ${where}`, to: me, travel: 1.2, nade: e.at, he: e.id });
    if (inv.some(w => /molotov|incendiary/i.test(w)) && S.dist(me, e.at) < NADE_RANGE) plans.push({ kind: 'molotov', label: `Molotov ${where}`, to: me, travel: 1.4, nade: e.at, deny: e.id });
  }
  // a smoke they have, on the standard spot nearest the enemies they know about (or the nearest one), then hold
  const inv = gearAt(r, id, t)?.inv ?? [];
  if (inv.some(w => /smoke/i.test(w))) {
    const spots = (SPOTS[map] ?? []).filter(x => x.type === 'smoke' && x.side === s).map(x => S.radar({ x: x.x, y: x.y })).filter(p => S.dist(me, p) < NADE_RANGE);
    const target = enemies[0]?.at;
    const best = spots.sort((a, b) => (target ? S.dist(a, target) - S.dist(b, target) : S.dist(a, me) - S.dist(b, me)))[0];
    if (best) plans.push({ kind: 'smoke', label: `Smoke ${placeOf(engine, best) || 'a standard spot'} and hold`, to: me, travel: 1.4, nade: best, smoke: { pos: best, r: SMOKE_RADIUS_UNITS / S.scale } });
  }
  // the bomb
  const bomb = bombAt(r, t);
  // the bomb carrier can plant: right here when on a site, or at a site they can reach in a few seconds (walk there,
  // then 3.2 s planting, with whoever sees them on the way), so the option doesn't come and go as they cross a line
  if (s === 'T' && r.plant === null && bomb?.kind === 'carry' && bomb.id === id) {
    const onSite = S.siteAt(me);
    if (onSite) plans.push({ kind: 'plant', label: `Plant on ${onSite}`, to: me, travel: 3.2, plant: true });
    for (const [name, site] of Object.entries(engine.map.sites)) {
      if (name === onSite) continue;
      const f = calloutField(engine, `site:${name}`, site.center);
      const sec = f && cell >= 0 ? f[cell] * spx : Infinity;
      if (sec <= PLANT_REACH) plans.push({ kind: 'plant', label: `Go plant on ${name}`, to: site.center, travel: sec + 3.2, plant: true, path: pathDown(engine, f!, me) });
    }
  }
  // (no "go defuse" option: whether a T is guarding the bomb is exactly what the engine can't know)

  // ---- what they did: where they were H seconds later (or when they died), and any grenade or the plant ----------
  const until = Math.min(r.duration, t + H);
  const diedAt = r.kills.find(k => k.victim === id)?.t;
  const endT = diedAt !== undefined && diedAt < until ? Math.max(t, diedAt - 0.3) : until;
  const end = S.pos(id, endT);
  const threw = r.util.find(u => u.thrower === id && (u.throwT ?? u.t - 1.5) >= t && (u.throwT ?? u.t - 1.5) < until);
  // they planted within ~10 s (walking to the spot and planting is one decision)
  const plantEv = r.bomb?.find(b => b.kind === 'plant' && b.id === id);
  const planted = r.plant !== null && plantEv && r.plant >= t && r.plant <= t + 3.2 + PLANT_REACH;
  let did: Plan;
  if (planted) {
    const way: Vec2[] = [];
    for (let u = t + 0.5; u <= r.plant!; u += 0.5) way.push(S.pos(id, u));
    did = { kind: 'plant', label: r.plant! - t <= 4 ? 'Planted the bomb' : 'Went and planted', to: S.radar({ x: plantEv!.x, y: plantEv!.y }), travel: Math.max(3.2, r.plant! - t), plant: true, path: way };
  }
  else if (threw) {
    const nadeAt = S.radar({ x: threw.x, y: threw.y });
    const nearest = enemies.slice().sort((a, b) => S.dist(a.at, nadeAt) - S.dist(b.at, nadeAt))[0];
    did = threw.type === 'smoke' ? { kind: 'smoke', label: `Smoked ${placeOf(engine, nadeAt) || ''}`.trim(), to: end, travel: endT - t, nade: nadeAt, smoke: { pos: nadeAt, r: SMOKE_RADIUS_UNITS / S.scale } }
      : threw.type === 'flash' ? { kind: 'flash', label: `Flashed ${placeOf(engine, nadeAt) || ''}`.trim(), to: end, travel: endT - t, nade: nadeAt, flash: nearest && S.dist(nearest.at, nadeAt) < 900 ? nearest.id : undefined }
        : threw.type === 'he' ? { kind: 'he', label: `HE at ${placeOf(engine, nadeAt) || ''}`.trim(), to: end, travel: endT - t, nade: nadeAt, he: nearest && S.dist(nearest.at, nadeAt) < 350 ? nearest.id : undefined }
          : { kind: 'molotov', label: `Molotov at ${placeOf(engine, nadeAt) || ''}`.trim(), to: end, travel: endT - t, nade: nadeAt, deny: nearest && S.dist(nearest.at, nadeAt) < 300 ? nearest.id : undefined };
  } else if (S.dist(me, end) < 150) did = { kind: 'hold', label: `Held ${here}`, to: me, travel: 0 };
  else {
    const way: Vec2[] = [];
    for (let u = t + 0.5; u <= endT; u += 0.5) way.push(S.pos(id, u));
    did = { kind: 'actual', label: `Moved to ${placeOf(engine, end) || 'a new spot'}`, to: end, travel: endT - t, path: way };
  }

  // ---- step 1 and 2: value every option the same way --------------------------------------------------------------
  const value = (p: Plan): SearchOption => {
    // every option looked at over the same stretch of round (the clock runs for a hold too: post-plant that matters)
    const dt = Math.max(H, p.travel);
    const sm = p.smoke ? [...smokes, p.smoke] : smokes;
    const myF = (moving: boolean) => S.fighter(id, t, p.to, moving);
    // fights: known enemies that can see where the option leaves them (a denied / smoked-off enemy can't)
    // fights: known enemies that can see where the option leaves them, or see them on the way there (a denied /
    // smoked-off enemy can't); the ones on the way first
    const sees = (e: { at: Vec2 }, q: Vec2) => S.dist(q, e.at) < 3000 && engine.grid.lineOfSight(q, e.at, sm);
    // a plant takes seconds on the spot: an enemy seen near the site a while ago is still there to stop it
    const live = (p.plant ? [...enemies, ...plantWatch.filter(w => !enemies.some(e => e.id === w.id))] : enemies).filter(e => e.id !== p.deny);
    const onWay = live.filter(e => !sees(e, p.to) && (p.path ?? []).some((q, i) => i % 2 === 0 && sees(e, q)));
    // the plant is loud: an enemy this close swings on the sound even without a view of the spot
    const atEnd = live.filter(e => sees(e, p.to) || (p.plant && S.dist(p.to, e.at) < PLANT_HEARD)).sort((a, b) => S.dist(p.to, a.at) - S.dist(p.to, b.at));
    const contacts = [...onWay, ...atEnd].slice(0, 3);
    const peeking = p.travel > 0 && contacts.some(e => !engine.grid.lineOfSight(me, e.at, smokes));
    const mateNear = S.ids.some(o => o !== id && S.side(o) === s && S.alive(o, t) && S.dist(S.pos(o, t), p.to) < TRADE_DIST);
    const posGain = (() => {
      // (left out when checking the engine on the same demos the spot stats were learned from: tools/calibrate-search.ts)
      if (NO_SPOT_STATS) return 0;
      const place = placeOf(engine, p.to);
      const sp = (proSituationSpots(map, s, phase, adv) ?? proSpots(map, s, phase)).find(x => x.place === place);
      // a nudge, not the decider: a third of it, at most ±3 points (the models already count part of it, and a spot's
      // record says less about this moment than who can see you)
      return sp?.gain !== undefined && (sp.n ?? 0) >= 8 ? Math.max(-0.03, Math.min(0.03, sp.gain / 3)) : 0;
    })();
    const hpDmg = p.he ? -Math.min(40, 25) : 0;
    const base = { plant: p.plant, dt, theirHp: hpDmg, myAreas: p.kind === 'move' || p.kind === 'peek' || p.kind === 'actual' ? 1 : 0 };
    let win: number, death = 0, killsE = 0;
    if (!contacts.length) {
      // no known enemy sees it: the risk of the ones nobody has seen, from how holding that spot goes for level-10 players
      const place = placeOf(engine, p.to);
      const pressure = enemies.filter(e => S.dist(p.to, e.at) < 1500).length;
      const risk = place ? proRisk(map, s, place, pressure, !mateNear) : null;
      death = risk && risk.n >= 8 ? (risk.died / risk.n) * 0.35 : 0;
      win = (1 - death) * S.winFor(s, t, base) + death * S.winFor(s, t, { ...base, plant: false, mine: -1, trade: mateNear ? 1 : 0 });
    } else {
      // fight them one after another; each fight from the duel model
      const qs = contacts.map(e => {
        const sit: DuelSituation = {
          a: { f: myF(peeking), aim: null },
          b: { f: S.fighter(e.id, t, e.at, false, p.flash === e.id), aim: null },
          range: S.dist(p.to, e.at) * 0.0254, sawFirst: 0, map,
        };
        return duelChance(sit) ?? 0.5;
      });
      let alivePr = 1, fight = 0;
      for (let k = 0; k < qs.length; k++) {
        const dieHere = alivePr * (1 - qs[k]);
        // dying on the way or mid-plant: no bomb down
        fight += dieHere * S.winFor(s, t, { ...base, plant: false, theirs: -k, mine: -1, trade: mateNear ? 1 : 0 });
        death += dieHere;
        killsE += alivePr * qs[k];
        alivePr *= qs[k];
      }
      fight += alivePr * S.winFor(s, t, { ...base, theirs: -qs.length });
      // step 2, the enemy's reply: they can also back off instead of taking a fight that's bad for them (not from a
      // plant or a defuse: letting it happen loses them the round)
      const theyBackOff = S.winFor(s, t, { ...base, myAreas: (base.myAreas ?? 0) + 1 });
      if (!p.plant && !p.defuse && fight > theyBackOff) { win = theyBackOff; death = 0; killsE = 0; } else win = fight;
    }
    const way = p.path?.length ? [...p.path.filter((_, i, xs) => i % Math.max(1, Math.ceil(xs.length / 10)) === 0), p.to].map(q => ({ x: Math.round(q.x), y: Math.round(q.y) })) : undefined;
    return { kind: p.kind, label: p.label, to: p.to, nade: p.nade, ...(way ? { path: way } : {}), win: Math.min(1, Math.max(0, win + posGain)), death: +death.toFixed(3), kills: +killsE.toFixed(3) };
  };

  let options = plans.map(value).sort((a, b) => b.win - a.win);
  const mine = value(did);
  // what they did can beat every option on the list (a plan the list doesn't have): then it is the best one
  if (mine.win >= options[0].win) options = [mine, ...options];
  const best = options[0];
  const loss = Math.max(0, best.win - mine.win);
  return {
    t, player: id, side: s, options: options.slice(0, 6), did: mine, loss: +loss.toFixed(4), cost: +(loss * COST_SCALE).toFixed(4), cls: searchClass(loss),
    accuracy: +searchAccuracy(loss * COST_SCALE * 100).toFixed(1), before: +before.toFixed(4),
  };
}

export interface RoundSearch {
  /** Every 2 s of every living player (from 10 s in). */
  moments: SearchMoment[];
  /** Per player: moments, average accuracy, and counts per class. */
  players: Record<string, { n: number; accuracy: number; counts: Record<SearchClass, number> }>;
}
const EMPTY_COUNTS = (): Record<SearchClass, number> => ({ Best: 0, Excellent: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 });

/** The whole round, every 2 s for every player. */
export function searchRound(engine: TacticalEngine, r: DemoRound, every = 2): RoundSearch {
  const S = roundSearcher(engine, r);
  const moments: SearchMoment[] = [];
  for (let t = 10; t < r.duration - 2; t += every)
    for (const id of S.ids) { const m = searchMoment(engine, r, S, id, t); if (m) moments.push(m); }
  const players: RoundSearch['players'] = {};
  for (const m of moments) {
    const p = (players[m.player] ??= { n: 0, accuracy: 0, counts: EMPTY_COUNTS() });
    p.n++; p.accuracy += m.accuracy; p.counts[m.cls]++;
  }
  for (const p of Object.values(players)) p.accuracy = +(p.accuracy / p.n).toFixed(1);
  return { moments, players };
}

/** The moments worth a card: the costliest Mistakes and Blunders (or Blunders only), a few seconds apart, per player. */
export function keySearchMoments(rs: RoundSearch, perPlayer = 2, blundersOnly = false): SearchMoment[] {
  const out: SearchMoment[] = [];
  const by = new Map<string, SearchMoment[]>();
  // not the opening seconds: where a player goes first is the team's plan and their role, not a call the engine can judge
  // …nor a round already lost (under 15% to win, as for deaths): nothing much left to decide
  for (const m of rs.moments) if (m.t >= OPENING && m.before >= 0.15 && (m.cls === 'Blunder' || (!blundersOnly && m.cls === 'Mistake'))) by.set(m.player, [...(by.get(m.player) ?? []), m]);
  for (const list of by.values()) {
    const picked: SearchMoment[] = [];
    for (const m of list.sort((a, b) => b.loss - a.loss)) if (picked.length < perPlayer && !picked.some(x => Math.abs(x.t - m.t) < 8)) picked.push(m);
    out.push(...picked);
  }
  return out;
}

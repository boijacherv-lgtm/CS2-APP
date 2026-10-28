import type { TacticalEngine } from './predict';
import { placeOf } from './situations';
import type { Side, Vec2 } from './types';
import MODEL from './models/winprob.json';
import GBM_JSON from './models/winprob-gbm.json';
import { gbmLogit, type GbmModel } from './gbm';

/**
 * The learned win chance: a logistic model fitted on good players' rounds (tools/learn-analyst.ts →
 * models/winprob.json) instead of hand-set weights. What it looks at, from the CTs' side:
 *   men alive (and that gap relative to the smaller side), health, equipment, the bomb (planted, time since),
 *   time running out for the Ts, map control (areas each side held in the last 10 s, outside spawns and sites)
 *   and trades about to happen (a player just died and their teammate is right on the killer).
 * evalState (recap.ts) uses it when it's trained and the state carries control and trades.
 */
export interface WinState {
  ct: number; t: number; ctHp: number; tHp: number;
  ctEquip: number | null; tEquip: number | null;
  planted: number | null; time: number;
  ctAreas: number; tAreas: number;
  tradeCT: number; tradeT: number;
  /** Planting or defusing right now (and the defuser's kit), when known: the boosted model reads it. */
  bombAct?: 'plant' | 'defuse' | null; kit?: boolean;
  /** The map, for its own trees on top of the shared ones (when it has some). */
  map?: string;
}

/**
 * The boosted model's numbers: the logistic ones, plus each side's count, the round clock, the bomb's time left,
 * and a plant or defuse under way. Trees take combinations of these, so raw values are fine here.
 */
export const WIN2_FEATURES = [...WIN_FEATURES_BASE(), 'CT alive', 'T alive', 'round time', 'bomb time left', 'planting now', 'defusing now', 'defusing with a kit'];
function WIN_FEATURES_BASE() { return ['men', 'men (relative)', 'health', 'equipment', 'planted', 'time since plant', 'T time running out', 'map control', 'trades pending']; }
export function winFeatures2(s: WinState): number[] {
  return [
    ...winFeatures(s),
    s.ct, s.t, s.time,
    s.planted !== null ? Math.max(0, 40 - (s.time - s.planted)) : -1,
    s.bombAct === 'plant' ? 1 : 0,
    s.bombAct === 'defuse' ? 1 : 0,
    s.bombAct === 'defuse' && s.kit ? 1 : 0,
  ];
}
export const WIN_FEATURES = ['men', 'men (relative)', 'health', 'equipment', 'planted', 'time since plant', 'T time running out', 'map control', 'trades pending'];

export function winFeatures(s: WinState): number[] {
  const diff = s.ct - s.t;
  return [
    diff,
    diff / Math.max(1, Math.min(s.ct, s.t)),
    (s.ctHp - s.tHp) / 100,
    s.ctEquip != null && s.tEquip != null ? (s.ctEquip - s.tEquip) / 1000 : 0,
    s.planted !== null ? 1 : 0,
    s.planted !== null ? Math.max(0, s.time - s.planted) / 10 : 0,
    s.planted === null ? Math.max(0, s.time - 90) / 10 : 0,
    (s.ctAreas - s.tAreas) / 10,
    s.tradeCT - s.tradeT,
  ];
}

export interface WinModel { bias: number; coef: number[]; features: string[]; samples: number; logLoss: number; baselineLogLoss?: number }
const M = MODEL as unknown as WinModel | { coef?: undefined };
export const WIN_MODEL: WinModel | null = M.coef && M.coef.length === WIN_FEATURES.length ? (M as WinModel) : null;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
/** The boosted trees (tools/learn-win.ts → models/winprob-gbm.json), when they were trained and beat the logistic model on unseen matches. */
const GBM: (GbmModel & { maps?: Record<string, GbmModel> }) | null = (GBM_JSON as { trees?: unknown[] }).trees?.length ? (GBM_JSON as unknown as GbmModel) : null;
export const WIN_GBM = GBM;

/** The learned log-odds for CT (null until a model is trained): the boosted trees when there are some, else the logistic model. */
export function learnedLogit(s: WinState): number | null {
  if (GBM) { const f = winFeatures2(s), own = s.map ? GBM.maps?.[s.map] : undefined; return gbmLogit(GBM, f) + (own ? gbmLogit(own, f) : 0); }
  if (!WIN_MODEL) return null;
  const f = winFeatures(s);
  return WIN_MODEL.bias + f.reduce((a, v, i) => a + v * WIN_MODEL!.coef[i], 0);
}

/** Logistic regression by gradient descent (features are small, so plain batch steps converge fine). */
export function fitWin(x: number[][], y: number[], iters = 600, lr = 0.3, l2 = 1e-3): WinModel {
  return fitLogistic(x, y, WIN_FEATURES, iters, lr, l2);
}
/** The same fit for any feature list (the duel model uses it too). */
export function fitLogistic(x: number[][], y: number[], features: string[], iters = 600, lr = 0.3, l2 = 1e-3): WinModel {
  const k = features.length, n = x.length;
  let bias = 0;
  const coef = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    let gb = 0;
    const g = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const p = sigmoid(bias + x[i].reduce((a, v, j) => a + v * coef[j], 0));
      const e = p - y[i];
      gb += e;
      for (let j = 0; j < k; j++) g[j] += e * x[i][j];
    }
    bias -= (lr * gb) / n;
    for (let j = 0; j < k; j++) coef[j] -= lr * (g[j] / n + l2 * coef[j]);
  }
  const logLoss = x.reduce((a, xi, i) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, sigmoid(bias + xi.reduce((s, v, j) => s + v * coef[j], 0)))); return a - (y[i] ? Math.log(p) : Math.log(1 - p)); }, 0) / (n || 1);
  return { bias: +bias.toFixed(4), coef: coef.map(c => +c.toFixed(4)), features, samples: n, logLoss: +logLoss.toFixed(4) };
}

/**
 * Map control over a round: for every second, how many areas each side held (last side seen there in the 10 s
 * before), leaving out spawns and the bomb sites. `where(id, t)` = the player's radar position, or null when dead.
 */
export function controlCounts(engine: TacticalEngine, ids: string[], sideOf: (id: string) => Side | undefined, where: (id: string, t: number) => Vec2 | null, seconds: number) {
  const sites = Object.values(engine.map.sites);
  const onSite = (p: Vec2) => sites.length > 1 && sites.some(s => Math.hypot(s.center.x - p.x, s.center.y - p.y) < s.radius * 2);
  const seen = new Map<string, { side: Side; t: number }>();
  const ct: number[] = [], t: number[] = [];
  for (let s = 0; s <= seconds; s++) {
    for (const id of ids) {
      const p = where(id, s), side = sideOf(id);
      if (!p || !side || onSite(p)) continue;
      const pl = placeOf(engine, p);
      if (pl && !/spawn/i.test(pl)) seen.set(pl, { side, t: s });
    }
    let c = 0, tt = 0;
    for (const v of seen.values()) if (s - v.t <= 10) { if (v.side === 'CT') c++; else tt++; }
    ct.push(c); t.push(tt);
  }
  return { ct, t };
}

/**
 * Trades about to happen at time t: players who died in the last 3 s whose killer is still alive with one of the
 * victim's teammates within ~12 m of them. `ct` = such pending trades in CT's favour (a T killed a CT and is about
 * to be traded), `t` the other way.
 */
export function tradePending(kills: { t: number; killer: string; victim: string }[], ids: string[], sideOf: (id: string) => Side | undefined,
  where: (id: string, t: number) => Vec2 | null, t: number, unitsPerPx: number) {
  let ct = 0, tt = 0;
  for (const k of kills) {
    if (k.t > t || t - k.t > 3 || !k.killer) continue;
    const vs = sideOf(k.victim), ks = sideOf(k.killer);
    if (!vs || !ks || vs === ks) continue;
    const kp = where(k.killer, t);
    if (!kp) continue;
    const near = ids.some(id => {
      if (id === k.victim || sideOf(id) !== vs) return false;
      const p = where(id, t);
      return !!p && Math.hypot(p.x - kp.x, p.y - kp.y) * unitsPerPx < 480;
    });
    if (near) { if (vs === 'CT') ct++; else tt++; }
  }
  return { ct, t: tt };
}

/**
 * The learned CT win chance at any moment of a demo round (from its frames), for valuing decisions: how much a
 * choice changed the win chance compared with what was expected when it was made. Needs the trained model.
 */
export function roundWinChance(engine: TacticalEngine, r: {
  frames: { t: number[]; players: Record<string, { side: Side; x: number[]; y: number[]; hp: number[]; alive: number[] }> };
  kills: { t: number; attacker: string; victim: string }[]; duration: number; plant: number | null;
  econ?: Record<string, { equip?: number | null } | undefined>;
}, equipOf: (id: string) => number | null, toRadar: (w: Vec2) => Vec2): (t: number) => number | null {
  if (!WIN_MODEL) return () => null;
  const ids = Object.keys(r.frames.players);
  const sideOf = (id: string) => r.frames.players[id]?.side;
  const ft = r.frames.t;
  const k = (t: number) => { let i = 0; while (i < ft.length - 1 && ft[i + 1] <= t) i++; return i; };
  const alive = (id: string, t: number) => { const f = r.frames.players[id]; return !!f && !!f.alive[k(t)] && !r.kills.some(q => q.victim === id && q.t <= t); };
  const where = (id: string, t: number) => { if (!alive(id, t)) return null; const f = r.frames.players[id], i = k(t); return toRadar({ x: f.x[i], y: f.y[i] }); };
  const areas = controlCounts(engine, ids, sideOf, where, Math.ceil(r.duration));
  const kills = r.kills.map(q => ({ t: q.t, killer: q.attacker, victim: q.victim }));
  return (t: number) => {
    const live = ids.filter(id => alive(id, t));
    const ct = live.filter(id => sideOf(id) === 'CT'), tt = live.filter(id => sideOf(id) === 'T');
    if (!ct.length) return 0;
    if (!tt.length) return r.plant !== null && t >= r.plant ? null : 1;
    const hp = (xs: string[]) => xs.reduce((a, id) => a + (r.frames.players[id].hp[k(t)] ?? 100), 0);
    const eq = (xs: string[]) => { const v = xs.map(equipOf).filter((e): e is number => e !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const s = Math.min(areas.ct.length - 1, Math.max(0, Math.floor(t)));
    const tp = tradePending(kills, ids, sideOf, where, t, engine.map.radar.scale);
    const z = learnedLogit({ ct: ct.length, t: tt.length, ctHp: hp(ct), tHp: hp(tt), ctEquip: eq(ct), tEquip: eq(tt), planted: r.plant !== null && t >= r.plant ? r.plant : null, time: t,
      ctAreas: areas.ct[s], tAreas: areas.t[s], tradeCT: tp.ct, tradeT: tp.t, map: engine.map.id });
    return z === null ? null : 1 / (1 + Math.exp(-z));
  };
}

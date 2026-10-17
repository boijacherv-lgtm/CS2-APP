import type { TacticalEngine } from './predict';
import { placeOf } from './situations';
import type { Side, Vec2 } from './types';
import MODEL from './models/winprob.json';

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
/** The learned log-odds for CT (null until the model is trained). */
export function learnedLogit(s: WinState): number | null {
  if (!WIN_MODEL) return null;
  const f = winFeatures(s);
  return WIN_MODEL.bias + f.reduce((a, v, i) => a + v * WIN_MODEL!.coef[i], 0);
}

/** Logistic regression by gradient descent (features are small, so plain batch steps converge fine). */
export function fitWin(x: number[][], y: number[], iters = 600, lr = 0.3, l2 = 1e-3): WinModel {
  const k = WIN_FEATURES.length, n = x.length;
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
  return { bias: +bias.toFixed(4), coef: coef.map(c => +c.toFixed(4)), features: WIN_FEATURES, samples: n, logLoss: +logLoss.toFixed(4) };
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

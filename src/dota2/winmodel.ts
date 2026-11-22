/**
 * Dota 2's win chance, the coach's "evaluation" like a chess engine's: who goes on to win from a moment of the match.
 * Its inputs, shared by the trainer (tools/dota-win.ts) and the site: the game state at minute t from Radiant's side,
 * every one a difference (Radiant minus Dire), so Dire's chance is 1 minus Radiant's up to a small side bias.
 */
import type { Mlp } from '../engine/mlp';
import { mlpPredict } from '../engine/mlp';
import type { D2Team } from './data';
import WM from './generated/winmodel.json';

/** What the model reads of a match: OpenDota's gold and experience leads by minute, the buildings that fell, Roshan. */
export interface WinInput { goldAdv: number[]; xpAdv: number[]; downs: { uid: string; t: number }[]; roshan: { t: number; team: D2Team }[] }

export const FEATURES = ['goldK', 'goldShare', 'goldLate', 'xpK', 'xpShare', 'outer', 'tier3', 'rax', 'tier4', 'roshan', 'aegis'] as const;
/** How long a Roshan kill's Aegis counts as held (s). */
const AEGIS = 300;

/** A lead at minute t, between OpenDota's minute marks. */
function leadAt(series: number[], t: number): number {
  if (!series.length) return 0;
  const m = Math.max(0, t / 60), i = Math.min(series.length - 1, Math.floor(m)), j = Math.min(series.length - 1, i + 1);
  return series[i] + (series[j] - series[i]) * (m - i);
}

export function features(m: WinInput, t: number): number[] {
  const minute = Math.max(0, t / 60), gold = leadAt(m.goldAdv, t), xp = leadAt(m.xpAdv, t);
  // a team's own buildings lost by time t, by kind; Radiant's uids start 0_, Dire's 1_
  const lost = (team: 0 | 1, test: (uid: string) => boolean) => m.downs.filter(d => d.t <= t && d.uid.startsWith(`${team}_`) && test(d.uid.slice(2))).length;
  const taken = (test: (uid: string) => boolean) => lost(1, test) - lost(0, test);
  const rosh = (team: D2Team) => m.roshan.filter(r => r.t <= t && r.team === team).length;
  const aegis = m.roshan.filter(r => r.t <= t && t - r.t < AEGIS).reduce((a, r) => a + (r.team === 0 ? 1 : -1), 0);
  return [
    gold / 1000,
    // the same lead is worth more early, when both teams have less (roughly a team's net worth by then)
    gold / (8000 + 2600 * minute),
    // and late, when there's less game left to turn it round
    (gold / 1000) * Math.min(1, minute / 40),
    xp / 1000,
    xp / (10000 + 3000 * minute),
    taken(u => /^tower[12]_/.test(u)),
    taken(u => /^tower3_/.test(u)),
    taken(u => u.includes('rax')),
    taken(u => /^tower4/.test(u)),
    rosh(0) - rosh(1),
    aegis,
  ];
}

export interface WinModel {
  since: string; matches: number; moments: number; kind: 'simple' | 'network'; weights: number[]; net?: Mlp;
  test: { matches: number; accuracy: number; logLoss: number; byMinute: Record<string, number> };
}
export const WIN_MODEL = WM as unknown as WinModel;
/** Whether a model has been trained yet (the placeholder has no weights). */
export const HAS_WIN_MODEL = WIN_MODEL.weights.length === FEATURES.length + 1;

/** Radiant's chance from features, with the simple model's weights (intercept first). */
export function simpleChance(weights: number[], x: number[]): number {
  const z = weights[0] + x.reduce((a, v, i) => a + v * weights[i + 1], 0);
  return 1 / (1 + Math.exp(-z));
}
/** Radiant's chance to win at time t, with the model that shipped; 0.5 until one has been trained. */
export function radiantChance(m: WinInput, t: number, model: WinModel = WIN_MODEL): number {
  if (model.weights.length !== FEATURES.length + 1) return 0.5;
  const x = features(m, t);
  return model.kind === 'network' && model.net ? mlpPredict(model.net, x)[1] : simpleChance(model.weights, x);
}
/** A team's chance to win at time t. */
export const winChance = (m: WinInput, team: D2Team, t: number) => (team === 0 ? radiantChance(m, t) : 1 - radiantChance(m, t));

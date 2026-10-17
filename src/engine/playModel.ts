import { worldToRadar } from './coords';
import type { TacticalEngine } from './predict';
import { bombAt, equipValue, FL, type DemoRound } from './recap';
import { roundWinChance } from './winprob';
import type { Side, Vec2 } from './types';
import MODEL from './models/play.json';

/**
 * Step 4 of the coach: "what would a level-10 player do now". Every 2 s of a round, for every living player, the
 * situation as they could know it (numbers, health, gear, time, the bomb, enemies their team has spotted and how close,
 * whether they're spotted, teammates near, a teammate just down next to them, grenades left) and what they did in
 * the next 3 s (hold, push, fall back, reposition, fight, a grenade, the bomb). A softmax model fitted on FACEIT
 * level-10 rounds (tools/learn-analyst.ts → models/play.json) says how often level-10 players choose each action in
 * that situation. Judging a moment = your choice against theirs: a choice they almost never make where most of them
 * agree on another one gets flagged.
 * (A value model, "which choice wins more rounds", was tried: on unseen demos it added nothing to the win chance,
 * so the effect of one choice on the round is too small to measure from ~50 demos, and it isn't claimed.)
 */
export const ACTIONS = ['hold', 'push', 'fall back', 'reposition', 'fight', 'utility', 'objective'] as const;
export type Action = (typeof ACTIONS)[number];
export const ACTION_TEXT: Record<Action, string> = {
  hold: 'hold the spot', push: 'push toward the enemy', 'fall back': 'fall back', reposition: 'reposition',
  fight: 'take the fight', utility: 'use a grenade', objective: 'play the bomb',
};
export const PLAY_FEATURES = [
  'bias', 'men up', 'team alive', 'health', 'equipment', 'T side', 'early', 'mid', 'late', 'post-plant', 'T after plant', 'time left',
  'enemies spotted near', 'enemies spotted', 'nearest known enemy', 'spotted', 'teammates near', 'trade window', 'distance to a site',
  'grenades left', 'has the bomb', 'AWP', 'low health', 'speed now', 'closing in',
];
export interface Moment { t: number; player: string; side: Side; f: number[]; a: number; /** log-odds the player's side wins, from the win model */ wl: number }

const NEAR = 1500, MATE = 1000, STEP = 150; // game units
const NADE = /flash|smoke|hegrenade|molotov|incgrenade|decoy|incendiary|grenade/i;

/** Every player's moments in a round (every `every` s). `winFor` = the learned CT win chance at t. */
export function roundMoments(engine: TacticalEngine, r: DemoRound, every = 2, winFor?: (t: number) => number | null): Moment[] {
  const ids = Object.keys(r.frames.players);
  const side = (id: string) => r.frames.players[id]?.side;
  const ft = r.frames.t;
  // the last frame at or before t (binary search: this runs a lot)
  const idx = (t: number) => { let lo = 0, hi = ft.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ft[m] <= t) lo = m; else hi = m - 1; } return lo; };
  const deathT = new Map(r.kills.map(q => [q.victim, q.t]));
  const alive = (id: string, t: number) => { const f = r.frames.players[id]; return !!f && !!f.alive[idx(t)] && !((deathT.get(id) ?? Infinity) <= t); };
  const pos = (id: string, t: number): Vec2 => { const f = r.frames.players[id], k = idx(t); return { x: f.x[k], y: f.y[k] }; };
  const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
  const scale = engine.map.radar.scale;
  const sites = Object.values(engine.map.sites);
  const win = winFor ?? roundWinChance(engine, r, id => equipValue(r.econ?.[id]), w => worldToRadar(w, engine.map.radar));
  const spottedAt = (id: string, t: number) => {
    const f = r.frames.players[id], k = idx(t);
    if (f.fl) return !!(f.fl[k] & FL.spotted);
    const me = worldToRadar(pos(id, t), engine.map.radar);
    return ids.some(o => side(o) !== side(id) && alive(o, t) && engine.grid.lineOfSight(worldToRadar(pos(o, t), engine.map.radar), me));
  };
  const nades = (id: string, t: number) => {
    const bought = (r.econ?.[id]?.weapons ?? []).filter(w => NADE.test(w)).length;
    return Math.max(0, bought - r.util.filter(u => u.thrower === id && (u.throwT ?? u.t - 1.5) <= t).length);
  };
  const out: Moment[] = [];
  for (let t = 2; t < r.duration - 3; t += every) {
    const plantNow = r.plant !== null && t >= r.plant;
    const bomb = bombAt(r, t);
    const winCT = win(t);
    for (const id of ids) {
      const s = side(id);
      if (!s || !alive(id, t)) continue;
      const me = pos(id, t);
      const mates = ids.filter(o => side(o) === s && alive(o, t));
      const foes = ids.filter(o => side(o) !== s && side(o) && alive(o, t));
      if (!foes.length) continue;
      // enemies my team has spotted now, and the last place one was seen (5 s)
      const spotted = foes.filter(o => spottedAt(o, t));
      let nearestKnown = Infinity;
      for (const o of foes) for (let u = t; u >= t - 5; u -= 0.5) if (alive(o, u) && spottedAt(o, u)) { nearestKnown = Math.min(nearestKnown, d(me, pos(o, u))); break; }
      const trade = r.kills.some(q => q.t <= t && t - q.t <= 3 && side(q.victim) === s && q.victim !== id && q.attacker && alive(q.attacker, t) && d(me, { x: q.x, y: q.y }) < 1200);
      const rp = worldToRadar(me, engine.map.radar);
      const toSite = sites.length ? Math.min(...sites.map(x => Math.hypot(x.center.x - rp.x, x.center.y - rp.y))) * scale : 3000;
      const f = r.frames.players[id], k = idx(t);
      const hp = f.hp[k] ?? 100;
      const eq = equipValue(r.econ?.[id]);
      const timeLeft = plantNow ? (40 - (t - r.plant!)) / 10 : (115 - t) / 30;
      const phase = plantNow ? 3 : t < 25 ? 0 : t < 60 ? 1 : 2;
      const feats = [
        1, (mates.length - foes.length) / 2, mates.length / 5, hp / 100, eq === null ? 0.6 : eq / 5000, s === 'T' ? 1 : 0,
        phase === 0 ? 1 : 0, phase === 1 ? 1 : 0, phase === 2 ? 1 : 0, phase === 3 ? 1 : 0, phase === 3 && s === 'T' ? 1 : 0, Math.max(-1, timeLeft),
        Math.min(3, spotted.filter(o => d(me, pos(o, t)) < NEAR).length), Math.min(5, spotted.length) / 2,
        Math.min(4, nearestKnown / 1000), spottedAt(id, t) ? 1 : 0,
        Math.min(3, mates.filter(o => o !== id && d(me, pos(o, t)) < MATE).length), trade ? 1 : 0,
        Math.min(4, toSite / 1000), Math.min(4, nades(id, t)) / 2,
        bomb?.kind === 'carry' && bomb.id === id ? 1 : 0, (f.w?.[k] ?? '') === 'awp' ? 1 : 0, hp < 40 ? 1 : 0,
        // what they were already doing: speed over the last second, and closing on (+) or backing off (−) the enemies over the last 2 s
        Math.min(1.2, d(me, pos(id, Math.max(0, t - 1))) / 250),
        (() => { const back = pos(id, Math.max(0, t - 2)); const near = (p: Vec2) => Math.min(...foes.map(o => d(p, pos(o, t)))); return Math.max(-1, Math.min(1, (near(back) - near(me)) / 500)); })(),
      ];
      const pCT = winCT === null ? 0.5 : Math.min(0.99, Math.max(0.01, winCT));
      const pMe = s === 'CT' ? pCT : 1 - pCT;
      out.push({ t, player: id, side: s, f: feats, a: actionOf(r, id, t, foes, pos, alive), wl: Math.log(pMe / (1 - pMe)) });
    }
  }
  return out;
}

/** What the player did in the 3 s after t. */
function actionOf(r: DemoRound, id: string, t: number, foes: string[], pos: (id: string, t: number) => Vec2, alive: (id: string, t: number) => boolean): number {
  const t1 = t + 3;
  const plant = (r.bomb ?? []).find(b => b.kind === 'plant' && b.id === id);
  const defuse = (r.bomb ?? []).find(b => b.kind === 'defuse' && b.id === id);
  if ((plant && plant.t >= t && plant.t - t <= 4.5) || (defuse && defuse.t >= t && defuse.t - t <= 11)) return 6;
  if ((r.shots ?? []).some(s => s.id === id && s.t >= t && s.t < t1) || (r.hits ?? []).some(h => h.attacker === id && h.t >= t && h.t < t1)) return 4;
  if (r.util.some(u => u.thrower === id && (u.throwT ?? u.t - 1.5) >= t && (u.throwT ?? u.t - 1.5) < t1)) return 5;
  const end = alive(id, t1) ? t1 : Math.max(t, (r.kills.find(q => q.victim === id)?.t ?? t1) - 0.3);
  const a = pos(id, t), b = pos(id, end);
  if (Math.hypot(b.x - a.x, b.y - a.y) < STEP) return 0;
  const near = (p: Vec2, at: number) => Math.min(...foes.filter(o => alive(o, at)).map(o => { const q = pos(o, at); return Math.hypot(q.x - p.x, q.y - p.y); }), Infinity);
  const before = near(a, t), after = near(b, t); // to where the enemies were: did they close in on them or back off
  if (!Number.isFinite(before)) return 3;
  return after < before - STEP ? 1 : after > before + STEP ? 2 : 3;
}

// ---- the models ----------------------------------------------------------------------------------------------
export interface PlayModel {
  policy: { w: number[][]; samples: number; accuracy: number; logLoss: number; baseLogLoss: number };
  /** Level-10 players judged by the same model: share of their moments with a usual choice. */
  bench: { usual: number };
}
const PM = MODEL as unknown as Partial<PlayModel>;
export const PLAY_MODEL: PlayModel | null = PM.policy?.w?.length === ACTIONS.length && PM.policy.w[0].length === PLAY_FEATURES.length ? (PM as PlayModel) : null;

const dot = (w: number[], f: number[]) => w.reduce((a, v, i) => a + v * f[i], 0);
export function policy(f: number[], m: PlayModel): number[] {
  const z = m.policy.w.map(w => dot(w, f)), mx = Math.max(...z);
  const e = z.map(v => Math.exp(v - mx)), s = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / s);
}
/** Softmax regression, full-batch Adam (stable whatever the feature scales). */
export function fitPolicy(x: number[][], y: number[], iters = 300, lr = 0.05, l2 = 1e-4): number[][] {
  const K = ACTIONS.length, F = x[0].length, n = x.length;
  const w = Array.from({ length: K }, () => new Array(F).fill(0));
  const m1 = Array.from({ length: K }, () => new Array(F).fill(0)), m2 = Array.from({ length: K }, () => new Array(F).fill(0));
  const p = new Array(K);
  for (let it = 1; it <= iters; it++) {
    const g = Array.from({ length: K }, () => new Array(F).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = x[i];
      let mx = -Infinity;
      for (let c = 0; c < K; c++) { p[c] = dot(w[c], xi); if (p[c] > mx) mx = p[c]; }
      let s = 0;
      for (let c = 0; c < K; c++) { p[c] = Math.exp(p[c] - mx); s += p[c]; }
      for (let c = 0; c < K; c++) { const e = p[c] / s - (y[i] === c ? 1 : 0); const gc = g[c]; for (let j = 0; j < F; j++) gc[j] += e * xi[j]; }
    }
    for (let c = 0; c < K; c++) for (let j = 0; j < F; j++) {
      const gr = g[c][j] / n + l2 * w[c][j];
      m1[c][j] = 0.9 * m1[c][j] + 0.1 * gr; m2[c][j] = 0.999 * m2[c][j] + 0.001 * gr * gr;
      w[c][j] -= (lr * (m1[c][j] / (1 - 0.9 ** it))) / (Math.sqrt(m2[c][j] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  return w.map(r => r.map(c => +c.toFixed(4)));
}

// ---- judging -------------------------------------------------------------------------------------------------
/** Choices a level-10 player makes at least this often in a situation count as "usual" there. */
export const USUAL = 0.15;
/** Choices that aren't really decisions (you're in a fight, or on the bomb) aren't judged. */
const JUDGED = new Set([0, 1, 2, 3, 5]);
const CHOICES = [0, 1, 2, 3, 5, 6];

export interface MomentVerdict {
  t: number; player: string; side: Side; did: Action;
  /** How often level-10 players make each choice here (among the real choices), most common first. */
  pro: { a: Action; share: number }[];
  /** How often they make the choice this player made. */
  share: number;
  usual: boolean;
  /** The situation in a few words (numbers, the enemy, help, time). */
  context: string;
}
/** A moment's situation as a short phrase, from its features. */
export function situationText(m: Moment): string {
  const f = m.f, team = Math.round(f[2] * 5), foes = team - Math.round(f[1] * 2);
  const parts = [`${team}v${foes}`];
  const near = f[12], dist = f[14] * 1000 * 0.0254;
  if (near > 0) parts.push(`${near} enem${near === 1 ? 'y' : 'ies'} spotted within ${Math.round(1500 * 0.0254)} m`);
  else if (f[14] < 4) parts.push(`an enemy seen ${Math.round(dist)} m away`);
  else parts.push('no enemy seen');
  if (f[15]) parts.push('you were spotted');
  if (f[17]) parts.push('a teammate just died next to you');
  parts.push(f[16] ? `${f[16]} teammate${f[16] === 1 ? '' : 's'} near` : 'alone');
  if (f[22]) parts.push('low on health');
  if (f[20]) parts.push('with the bomb');
  parts.push(f[9] ? 'after the plant' : f[6] ? 'early round' : f[7] ? 'mid round' : 'late round');
  return parts.join(', ');
}
export function judgeMoment(m: Moment, model: PlayModel): MomentVerdict | null {
  // the first seconds are buying and leaving spawn, not decisions
  if (!JUDGED.has(m.a) || m.t < 10) return null;
  const raw = policy(m.f, model);
  // shares among the real choices (taking a fight isn't one); the bomb only when they could play it
  const can = (c: number) => c !== 6 || m.f[20] > 0 || (m.f[9] > 0 && m.side === 'CT');
  const cs = CHOICES.filter(can);
  const tot = cs.reduce((a, c) => a + raw[c], 0);
  const share = raw[m.a] / tot;
  return {
    t: m.t, player: m.player, side: m.side, did: ACTIONS[m.a], share, usual: share >= USUAL, context: situationText(m),
    pro: cs.map(c => ({ a: ACTIONS[c], share: raw[c] / tot })).sort((a, b) => b.share - a.share),
  };
}

/** Flag only a choice level-10 players almost never make where most of them agree on another one. */
export const RARE = 0.05, AGREE = 0.6;
/** A round's moments worth showing: per player, the clearest off-level-10 choices (6 s apart). */
export function keyMoments(vs: MomentVerdict[], perPlayer = 1): MomentVerdict[] {
  const by = new Map<string, MomentVerdict[]>();
  for (const v of vs) if (v.did !== 'utility' && v.share < RARE && v.pro[0].share >= AGREE) by.set(v.player, [...(by.get(v.player) ?? []), v]);
  const out: MomentVerdict[] = [];
  for (const list of by.values()) {
    const picked: MomentVerdict[] = [];
    for (const v of list.sort((a, b) => (b.pro[0].share - b.share) - (a.pro[0].share - a.share))) if (picked.length < perPlayer && !picked.some(o => Math.abs(o.t - v.t) < 6)) picked.push(v);
    out.push(...picked);
  }
  return out;
}

export const pctPlay = (p: number) => `${Math.round(p * 100)}%`;
/** One line: what level-10 players do here. */
export function momentLine(v: MomentVerdict): string {
  return `Level-10 players in this situation (${v.context}): ${v.pro.filter(p => p.share >= 0.1).slice(0, 3).map(p => `${p.a} ${pctPlay(p.share)}`).join(', ')}.`;
}

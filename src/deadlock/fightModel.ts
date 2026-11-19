/**
 * The Deadlock fight model: who wins a fight, from the moment just before it (step 3 of the engine; the 2-step search
 * will play its candidate moves forward with it, like the CS2 engine's duel model). A fight is found in the match data
 * (fightsIn): hero deaths a few seconds and a short way apart; who was in it is everyone close to it just before the
 * first death (only that: adding whoever died would pad the losing side with its own dead, and the model would learn
 * the result from who's in it); the side that lost fewer heroes won (even trades are left out).
 *
 * It reads each side as it was a few seconds before: heroes in it, their health, souls, levels, help close by, whose
 * half of the map it's on and whether one of their objectives stands there; and, when the demo is read, which of them had
 * their ultimate ready, counted by what those ultimates do (ultKinds.ts: area, single target, control, damage, protect…):
 * a small correction on top (FightModel.ults), shipped only when it beats the model without it. On 4 Nov it didn't
 * (230 matches with demos): ultimates ready 12 s before barely changed who won once the rest was known.
 * The sides are read both ways round and averaged, so the two chances add up to 1.
 */
import { objectiveSpot, type DlTeam } from './data';
import { worthAt } from './grade';
import { playerAt, statAt, type DlMatch } from './match';
import { ultAt, type DlDemo } from './demo';
import { ULT_KINDS, ultKindCounts } from './ultKinds';
import { mlpPredict, type Mlp } from '../engine/mlp';

/** Deaths this close in time (s) and space (map share) are one fight; the moment read is this long before the first. */
const GAP = 12, SPREAD = 0.1, LEAD = 12;
/** In the fight: this close to it; help: close enough to join in a few seconds. */
const IN = 0.08, HELP = 0.16;

export interface FightSide {
  /** heroes in the fight, their health (sum of shares, 0–n), souls (sum) and the richest one's, average level */
  n: number; hp: number; souls: number; richest: number; level: number;
  /** teammates near enough to join soon */ help: number;
  /** how deep in their own half it is (0: the enemy base, 1: their own) */ home: number;
  /** 1 if one of their objectives stands right there (it shoots for them) */ tower: number;
  /** heroes in it with their ultimate ready (only known with the demo), and those ultimates counted by kind (ULT_KINDS
   * order: area, single, control, …; from the book, ultBook.ts) */ ults?: number; ultKinds?: number[];
}
export interface Fight { t: number; at: { x: number; y: number }; sides: [FightSide, FightSide]; slots: [number[], number[]]; deaths: [number, number] }

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const home = (team: DlTeam, p: { x: number; y: number }) => (team === 0 ? p.y : 1 - p.y);

/** One side of a fight at time t around a spot: these players (alive at t), and their help nearby; their ultimates when
 * the demo's are given. */
export function sideAt(m: DlMatch, team: DlTeam, slots: number[], t: number, at: { x: number; y: number }, ults?: DlDemo['ults'] | null): FightSide {
  const alive = slots.map(s => ({ s, p: playerAt(m, s, t) })).filter(x => x.p);
  const worth = alive.map(x => worthAt(m, null, x.s, t));
  const help = m.players.filter(p => p.team === team && !slots.includes(p.slot)).filter(p => { const q = playerAt(m, p.slot, t); return !!q && dist(q, at) < HELP; }).length;
  const tower = m.objectives.some(o => o.team === team && (o.destroyed === null || o.destroyed > t) && (() => { const s = objectiveSpot(team, o.id); return !!s && dist(s, at) < 0.07; })()) ? 1 : 0;
  return {
    n: alive.length, hp: alive.reduce((a, x) => a + x.p!.hp / 100, 0), souls: worth.reduce((a, v) => a + v, 0), richest: Math.max(0, ...worth),
    level: alive.length ? alive.reduce((a, x) => a + (statAt(m, x.s, t)?.level ?? 1), 0) / alive.length : 0,
    help, home: home(team, at), tower,
    ...(ults ? (() => {
      const ready = alive.filter(x => ultAt({ ults } as DlDemo, x.s, t)?.state === 'ready').map(x => m.players.find(p => p.slot === x.s)!.hero);
      const k = ultKindCounts(ready);
      return { ults: ready.length, ultKinds: ULT_KINDS.map(x => k[x]) };
    })() : {}),
  };
}

/** Every fight in a match (from its deaths), with each side just before it and how many each lost. */
export function fightsIn(m: DlMatch, ults?: DlDemo['ults'] | null): Fight[] {
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  const deaths = [...m.deaths].filter(d => teamOf.has(d.slot)).sort((a, b) => a.t - b.t);
  const groups: (typeof deaths)[] = [];
  for (const d of deaths) {
    const g = groups[groups.length - 1];
    const c = g && { x: g.reduce((a, x) => a + x.at.x, 0) / g.length, y: g.reduce((a, x) => a + x.at.y, 0) / g.length };
    if (g && d.t - g[g.length - 1].t <= GAP && dist(c!, d.at) <= SPREAD) g.push(d); else groups.push([d]);
  }
  const out: Fight[] = [];
  for (const g of groups) {
    const t = Math.max(0, g[0].t - LEAD), at = { x: g.reduce((a, x) => a + x.at.x, 0) / g.length, y: g.reduce((a, x) => a + x.at.y, 0) / g.length };
    const inIt = new Set<number>();
    for (const p of m.players) { const q = playerAt(m, p.slot, t); if (q && dist(q, at) < IN) inIt.add(p.slot); }
    const slots: [number[], number[]] = [[...inIt].filter(s => teamOf.get(s) === 0), [...inIt].filter(s => teamOf.get(s) === 1)];
    if (!slots[0].length || !slots[1].length) continue; // a hero killed by creeps or a guardian alone isn't a fight
    const sides: [FightSide, FightSide] = [sideAt(m, 0, slots[0], t, at, ults), sideAt(m, 1, slots[1], t, at, ults)];
    if (!sides[0].n || !sides[1].n) continue;
    out.push({ t, at, sides, slots, deaths: [g.filter(d => teamOf.get(d.slot) === 0).length, g.filter(d => teamOf.get(d.slot) === 1).length] });
  }
  return out;
}

const side = (s: FightSide) => [s.n, s.hp, s.souls / 1000, s.richest / 1000, s.level, s.help, s.home, s.tower];
const SIDE_FEATURES = ['n', 'hp', 'souls', 'richest', 'level', 'help', 'home', 'tower'];
export const FIGHT_FEATURES = ['minute', ...SIDE_FEATURES.map(f => `${f}A`), ...SIDE_FEATURES.map(f => `${f}B`)];
/** Side A against side B at a minute of the match (ultimates are a correction on top: ultStackFeatures). */
export const fightFeatures = (t: number, a: FightSide, b: FightSide) => [t / 60, ...side(a), ...side(b)];

interface Fitted { kind: 'logistic' | 'network'; weights: number[]; net?: Mlp | null }
/** The ultimates correction on top of the model without them: weights on [its log-odds, ultimates ready A − B, then
 * A − B for each kind in ULT_STACK_KINDS] (no intercept: swapping the sides flips the sign). */
export interface UltStack { kind: 'stack'; weights: number[] }
export const ULT_STACK_KINDS = ['area', 'control', 'protect'] as const;
/** The model without ultimates, and the correction for them (null until enough demos were read). */
export interface FightModel extends Fitted { ults?: UltStack | null }
/** The chance side A wins (loses fewer heroes), both ways round and averaged; corrected for ultimates when both sides'
 * are known. */
export function fightChance(model: FightModel, t: number, a: FightSide, b: FightSide) {
  const one = (x: FightSide, y: FightSide) => {
    const f = fightFeatures(t, x, y);
    if (model.kind === 'network' && model.net) return mlpPredict(model.net, f)[1];
    const z = model.weights[0] + f.reduce((s, v, i) => s + v * model.weights[i + 1], 0);
    return 1 / (1 + Math.exp(-z));
  };
  const p = (one(a, b) + 1 - one(b, a)) / 2;
  if (!model.ults || a.ults === undefined || b.ults === undefined) return p;
  const x = ultStackFeatures(p, a, b);
  return 1 / (1 + Math.exp(-x.reduce((s, v, i) => s + v * model.ults!.weights[i], 0)));
}
/** The ultimates correction's inputs: the chance without ultimates as log-odds, then the sides' differences. */
export function ultStackFeatures(p: number, a: FightSide, b: FightSide): number[] {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p)), kind = (s: FightSide, k: (typeof ULT_STACK_KINDS)[number]) => s.ultKinds?.[ULT_KINDS.indexOf(k)] ?? 0;
  return [Math.log(q / (1 - q)), (a.ults ?? 0) - (b.ults ?? 0), ...ULT_STACK_KINDS.map(k => kind(a, k) - kind(b, k))];
}

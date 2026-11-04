/**
 * The Deadlock fight model: who wins a fight, from the moment just before it (step 3 of the engine; the 2-step search
 * will play its candidate moves forward with it, like the CS2 engine's duel model). A fight is found in the match data
 * (fightsIn): hero deaths a few seconds and a short way apart; who was in it is everyone close to it just before the
 * first death (only that: adding whoever died would pad the losing side with its own dead, and the model would learn
 * the result from who's in it); the side that lost fewer heroes won (even trades are left out).
 *
 * It reads each side as it was a few seconds before: heroes in it, their health, souls, levels, help close by, whose
 * half of the map it's on and whether one of their objectives stands there. Ultimates ready would matter a lot but need
 * the demo (deadlock-api reads one in about a minute): a later version adds them once enough demos are read.
 * The sides are read both ways round and averaged, so the two chances add up to 1.
 */
import { objectiveSpot, type DlTeam } from './data';
import { worthAt } from './grade';
import { playerAt, statAt, type DlMatch } from './match';
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
}
export interface Fight { t: number; at: { x: number; y: number }; sides: [FightSide, FightSide]; slots: [number[], number[]]; deaths: [number, number] }

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const home = (team: DlTeam, p: { x: number; y: number }) => (team === 0 ? p.y : 1 - p.y);

/** One side of a fight at time t around a spot: these players (alive at t), and their help nearby. */
export function sideAt(m: DlMatch, team: DlTeam, slots: number[], t: number, at: { x: number; y: number }): FightSide {
  const alive = slots.map(s => ({ s, p: playerAt(m, s, t) })).filter(x => x.p);
  const worth = alive.map(x => worthAt(m, null, x.s, t));
  const help = m.players.filter(p => p.team === team && !slots.includes(p.slot)).filter(p => { const q = playerAt(m, p.slot, t); return !!q && dist(q, at) < HELP; }).length;
  const tower = m.objectives.some(o => o.team === team && (o.destroyed === null || o.destroyed > t) && (() => { const s = objectiveSpot(team, o.id); return !!s && dist(s, at) < 0.07; })()) ? 1 : 0;
  return {
    n: alive.length, hp: alive.reduce((a, x) => a + x.p!.hp / 100, 0), souls: worth.reduce((a, v) => a + v, 0), richest: Math.max(0, ...worth),
    level: alive.length ? alive.reduce((a, x) => a + (statAt(m, x.s, t)?.level ?? 1), 0) / alive.length : 0,
    help, home: home(team, at), tower,
  };
}

/** Every fight in a match (from its deaths), with each side just before it and how many each lost. */
export function fightsIn(m: DlMatch): Fight[] {
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
    const sides: [FightSide, FightSide] = [sideAt(m, 0, slots[0], t, at), sideAt(m, 1, slots[1], t, at)];
    if (!sides[0].n || !sides[1].n) continue;
    out.push({ t, at, sides, slots, deaths: [g.filter(d => teamOf.get(d.slot) === 0).length, g.filter(d => teamOf.get(d.slot) === 1).length] });
  }
  return out;
}

const side = (s: FightSide) => [s.n, s.hp, s.souls / 1000, s.richest / 1000, s.level, s.help, s.home, s.tower];
const SIDE_FEATURES = ['n', 'hp', 'souls', 'richest', 'level', 'help', 'home', 'tower'];
export const FIGHT_FEATURES = ['minute', ...SIDE_FEATURES.map(f => `${f}A`), ...SIDE_FEATURES.map(f => `${f}B`)];
/** Side A against side B at a minute of the match. */
export const fightFeatures = (t: number, a: FightSide, b: FightSide) => [t / 60, ...side(a), ...side(b)];

export interface FightModel { kind: 'logistic' | 'network'; weights: number[]; net?: Mlp | null }
/** The chance side A wins (loses fewer heroes), both ways round and averaged. */
export function fightChance(model: FightModel, t: number, a: FightSide, b: FightSide) {
  const one = (x: FightSide, y: FightSide) => {
    const f = fightFeatures(t, x, y);
    if (model.kind === 'network' && model.net) return mlpPredict(model.net, f)[1];
    const z = model.weights[0] + f.reduce((s, v, i) => s + v * model.weights[i + 1], 0);
    return 1 / (1 + Math.exp(-z));
  };
  return (one(a, b) + 1 - one(b, a)) / 2;
}

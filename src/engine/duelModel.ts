import type { DuelFact, DuelFighter } from './analyst';
import { gunFromName } from './guns';
import type { WinModel } from './winprob';
import MODEL from './models/duel.json';
import GBM_JSON from './models/duel-gbm.json';
import { gbmLogit, type GbmModel } from './gbm';

/**
 * The duel model: who wins a fight, from the moment the two players first had sight of each other (before any
 * shot). Fitted on FACEIT level-10 fights (tools/learn-analyst.ts → models/duel.json), so a number means "how often
 * level-10 players win this fight". What it reads, as player A against player B:
 *   health and armour, each gun's killing power at that range, the AWP (and whether it's scoped), who was moving
 *   and who peeked a still player, crouching, in the air, flashed, who saw the other first, crosshair placement at
 *   that moment, and teammates nearby.
 * Every feature is "A minus B", and training uses each fight from both sides, so P(A wins) = 1 − P(B wins).
 */
export const DUEL_FEATURES = [
  'health', 'hurt (≤30 hp)', 'armour', 'helmet', 'gun power at range', 'AWP', 'AWP at range', 'scoped',
  'peeked a still player', 'crouching', 'in the air', 'flashed', 'saw first', 'crosshair placement', 'teammates near',
];

export interface DuelSide { f: DuelFighter; aim: number | null }
export interface DuelSituation { a: DuelSide; b: DuelSide; range: number; /** +1 A saw B first, −1 B saw A first, 0 same / unknown */ sawFirst: number; /** The map, for its own trees (when it has some). */ map?: string }

const SCOPES = /awp|ssg08|scout|g3sg1|scar20|aug|sg55/;
/** Kills a second at this range (metres), from the gun table; 0 for a knife or a grenade. */
const power = (w: string, rangeM: number) => {
  const g = gunFromName(w);
  if (!g) return 0;
  const units = rangeM / 0.0254;
  return g.killRate * (Number.isFinite(g.range) ? Math.pow(0.5, units / g.range) : 1);
};
const isAwp = (w: string) => gunFromName(w)?.cls === 'awp';
const b = (v: boolean) => (v ? 1 : 0);
const peeked = (x: DuelFighter, y: DuelFighter) => b(x.moving && !y.moving);

export function duelFeatures(s: DuelSituation): number[] {
  const A = s.a.f, B = s.b.f, far = Math.min(1, s.range / 20);
  const aim = s.a.aim !== null && s.b.aim !== null ? (Math.min(40, s.b.aim) - Math.min(40, s.a.aim)) / 10 : 0;
  return [
    (A.hp - B.hp) / 100,
    b(A.hp <= 30) - b(B.hp <= 30),
    b(A.armor) - b(B.armor),
    b(A.helmet) - b(B.helmet),
    power(A.w, s.range) - power(B.w, s.range),
    b(isAwp(A.w)) - b(isAwp(B.w)),
    (b(isAwp(A.w)) - b(isAwp(B.w))) * far,
    b(A.scoped && SCOPES.test(A.w)) - b(B.scoped && SCOPES.test(B.w)),
    peeked(A, B) - peeked(B, A),
    b(A.crouch) - b(B.crouch),
    b(A.air) - b(B.air),
    b(A.flashed) - b(B.flashed),
    s.sawFirst,
    aim,
    Math.min(3, A.mates) - Math.min(3, B.mates),
  ];
}

/**
 * The boosted model's numbers: the differences above, then A's and B's own health, each gun's killing power at that
 * range and the range itself (trees use them in combinations: "both hurt", "rifle vs pistol up close").
 */
export const DUEL2_FEATURES = [...DUEL_FEATURES, 'A health', 'B health', 'A gun power', 'B gun power', 'range'];
const extra = (s: DuelSituation) => [s.a.f.hp / 100, s.b.f.hp / 100, power(s.a.f.w, s.range), power(s.b.f.w, s.range), Math.min(60, s.range) / 20];
export function duelFeatures2(s: DuelSituation): number[] { return [...duelFeatures(s), ...extra(s)]; }
const flip = (s: DuelSituation): DuelSituation => ({ a: s.b, b: s.a, range: s.range, sawFirst: -s.sawFirst, map: s.map });

/** The boosted duel model (tools/learn-duel.ts → models/duel-gbm.json), when it beat the logistic one on unseen matches. */
const GBM: (GbmModel & { maps?: Record<string, GbmModel> }) | null = (GBM_JSON as { trees?: unknown[] }).trees?.length ? (GBM_JSON as unknown as GbmModel) : null;
export const DUEL_GBM = GBM;
/** The shared trees plus the map's own on top (when it has some). */
const treesLogit = (x: number[], map?: string) => { const own = map ? GBM!.maps?.[map] : undefined; return gbmLogit(GBM!, x) + (own ? gbmLogit(own, x) : 0); };
/**
 * P(A wins) from the trees, made fair both ways: A's log-odds from A's side minus B's from B's side, halved, so
 * P(A) + P(B) = 1 exactly. `f` (the differences) may be edited (peek / hold "what if"); `ex` is A's absolute numbers.
 */
function chanceTrees(f: number[], s: DuelSituation): number {
  const ab = extra(s), ba = extra(flip(s));
  return sigmoid((treesLogit([...f, ...ab], s.map) - treesLogit([...f.map(v => -v), ...ba], s.map)) / 2);
}

/** A duel as player A (the killer, or the victim) against the other; null for fights without the contact data. */
export function duelSituation(d: DuelFact, as: 'killer' | 'victim', map?: string): DuelSituation | null {
  if (!d.pre) return null;
  const k: DuelSide = { f: d.pre.k, aim: d.detail?.kAim ?? null }, v: DuelSide = { f: d.pre.v, aim: d.detail?.vAim ?? null };
  const sf = d.detail?.spottedFirst;
  const kFirst = sf === 'killer' ? 1 : sf === 'victim' ? -1 : 0;
  return as === 'killer' ? { a: k, b: v, range: d.pre.range, sawFirst: kFirst, map } : { a: v, b: k, range: d.pre.range, sawFirst: -kFirst, map };
}

/**
 * What level-10 fights usually look like for the peeker and for the holder: how often they saw the other first and
 * the crosshair-placement feature (learned with the model). Holding still mostly pays through these two (the holder
 * has the crosshair on the angle and often sees the swing coming), so "holding instead" uses the holder's.
 */
export interface DuelProfile { sawFirst: number; aim: number }
export type DuelModel = WinModel & { peek?: DuelProfile; hold?: DuelProfile };
const M = MODEL as unknown as DuelModel | { coef?: undefined };
export const DUEL_MODEL: DuelModel | null = M.coef && M.coef.length === DUEL_FEATURES.length ? (M as DuelModel) : null;
const I_PEEK = DUEL_FEATURES.indexOf('peeked a still player'), I_SAW = DUEL_FEATURES.indexOf('saw first'), I_AIM = DUEL_FEATURES.indexOf('crosshair placement');
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** P(A wins), as level-10 players win it; null until the model is trained. */
export function duelChance(s: DuelSituation, model: WinModel | null = DUEL_MODEL): number | null {
  if (GBM && model === DUEL_MODEL) return chanceTrees(duelFeatures(s), s);
  if (!model) return null;
  return chanceOf(duelFeatures(s), model);
}
const chanceOf = (f: number[], model: WinModel) => sigmoid(model.bias + f.reduce((a, v, i) => a + v * model.coef[i], 0));

export interface DuelOdds {
  /** The chance the player had going into it (everything as it was, their crosshair included). */
  p: number;
  /** They peeked a still player: with the same health, guns and help, how a typical level-10 peek goes, and holding still instead. */
  peek: number | null;
  held: number | null;
  peeked: boolean;
}
/** The odds a player (killer or victim of the duel) had at first contact, and peeking vs holding when they peeked. */
export function duelOdds(d: DuelFact, as: 'killer' | 'victim', model: DuelModel | null = DUEL_MODEL, map?: string): DuelOdds | null {
  const s = duelSituation(d, as, map);
  if (!s || !model) return null;
  const f = duelFeatures(s);
  const trees = !!GBM && model === DUEL_MODEL;
  const of = (g: number[]) => (trees ? chanceTrees(g, s) : chanceOf(g, model));
  const p = of(f);
  const isPeek = f[I_PEEK] > 0;
  let peek: number | null = null, held: number | null = null;
  if (isPeek && model.peek && model.hold) {
    const as_ = (peekSign: number, pr: DuelProfile) => { const g = [...f]; g[I_PEEK] = peekSign; g[I_SAW] = pr.sawFirst; g[I_AIM] = pr.aim; return of(g); };
    peek = as_(1, model.peek);
    held = as_(-1, model.hold); // you stand still with the angle pre-aimed, they swing into you
  }
  return { p, peek, held, peeked: isPeek };
}

/** The peeker's and the holder's usual "saw first" and crosshair features, from training samples. */
export function duelProfiles(x: number[][]): { peek: DuelProfile; hold: DuelProfile } {
  const avg = (rows: number[][], i: number) => +(rows.reduce((a, r) => a + r[i], 0) / (rows.length || 1)).toFixed(3);
  const pk = x.filter(r => r[I_PEEK] > 0), hd = x.filter(r => r[I_PEEK] < 0);
  return { peek: { sawFirst: avg(pk, I_SAW), aim: avg(pk, I_AIM) }, hold: { sawFirst: avg(hd, I_SAW), aim: avg(hd, I_AIM) } };
}

/** Training samples from a set of duels: each fight from both sides (A won = 1 / 0); `x2`: the boosted model's numbers. */
export function duelSamples(duels: DuelFact[]): { x: number[][]; y: number[]; x2: number[][] } {
  const x: number[][] = [], y: number[] = [], x2: number[][] = [];
  for (const d of duels) {
    const k = duelSituation(d, 'killer'), v = duelSituation(d, 'victim');
    if (!k || !v) continue;
    x.push(duelFeatures(k).map(n => +n.toFixed(3))); x2.push(duelFeatures2(k).map(n => +n.toFixed(3))); y.push(1);
    x.push(duelFeatures(v).map(n => +n.toFixed(3))); x2.push(duelFeatures2(v).map(n => +n.toFixed(3))); y.push(0);
  }
  return { x, y, x2 };
}

export const pctOdds = (p: number) => `${Math.round(p * 100)}%`;

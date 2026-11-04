/**
 * The Deadlock engine's 2-step search (step 4; the CS2 engine is src/engine/search.ts): at a moment, for one player, it
 * takes the play network's likeliest moves (playNet.ts) and the one they really made, plays each two steps ahead and
 * scores where it leaves the team with the value network (winChance.ts stateChance). The move is graded by the win chance
 * it gave up against the best option, in classes calibrated on Phantom-and-up players' own moments (tools/dl-search.ts).
 *
 *   step 1   the move, over the next 20 s: a fight against the enemies near (the fight model, fightModel.ts, gives the
 *            odds), an objective (it falls if nobody defends it), or what farming, laning, moving or going to base
 *            usually does from a moment like this one (learned: what each move did to the win chance over 20 s in
 *            Phantom-and-up matches, effectOf)
 *   step 2   the enemy's reply, the one worst for the player (like a chess engine): refuse a fight and fall back (giving
 *            up an objective that stands right there), defend an objective (a fight with their objective shooting for
 *            them), or jump a player who farms or lanes close to them. Going to base can't be punished.
 *
 * Estimates, not exact like chess: Deadlock has hidden information and fights are chancy; what fights cost (heroes lost,
 * respawn, bounty) comes from rough rules below, read by the value network. Ultimates aren't in it yet (the fight model
 * doesn't have them).
 */
import CAL from './generated/dlsearch.json';
import { DL_MAP, objectiveSpot, type DlTeam } from './data';
import type { DlDemo } from './demo';
import { fightChance, sideAt, type FightModel } from './fightModel';
import FM from './generated/fightmodel.json';
import PLAY from './generated/playnet.json';
import { playerAt, type DlMatch } from './match';
import { ACTIONS, actionAt, playChances, playInput, WINDOW, type Action } from './playNet';
import type { TeamState, ValueState } from './valueNet';
import { stateChance, valueStateAt } from './winChance';
import type { Mlp } from '../engine/mlp';
import type { SearchClass } from '../engine/search';

export type { SearchClass };
const FIGHT = FM as unknown as FightModel;
const PLAY_NET = (PLAY as { net: Mlp | null }).net;
/** The win chance (0–1) a move may give up and still be Excellent, Good, an Inaccuracy, a Mistake (more: a Blunder). */
const TH = (CAL as { thresholds?: number[] }).thresholds ?? [0.005, 0.012, 0.025, 0.045];
/** What each move does to the win chance over 20 s from a moment, learned (tools/dl-search.ts): a linear model per
 * action on the play network's inputs, standardized. */
export interface Effects { mu: number[]; sd: number[]; w: Record<Action, number[]> }
const EFFECTS = (CAL as { effects?: Effects }).effects ?? null;
const REPLIES = ((CAL as { replies?: Replies }).replies ?? 'worst') as Replies;
/** The learned change in the team's win chance from a move at a moment (0 without a model). */
export function effectOf(fx: Effects | null, f: number[], a: Action) {
  const w = fx?.w[a];
  if (!w) return 0;
  return w[0] + f.reduce((acc, v, i) => acc + w[i + 1] * ((v - fx!.mu[i]) / (fx!.sd[i] || 1)), 0);
}
export const DL_SEARCH = CAL as { thresholds?: number[]; moments?: number; matches?: number; calibratedAt?: string; check?: { corr: number; teams: number } | null };
/** The same colours as the CS2 engine's classes. */
export const SEARCH_COLOR: Record<SearchClass, string> = { Best: '#1baca6', Excellent: '#5c9ced', Good: '#7fbf4d', Inaccuracy: '#f7c045', Mistake: '#e58f2a', Blunder: '#ca3431' };
export const searchClass = (loss: number): SearchClass =>
  loss <= 0.002 ? 'Best' : loss <= TH[0] ? 'Excellent' : loss <= TH[1] ? 'Good' : loss <= TH[2] ? 'Inaccuracy' : loss <= TH[3] ? 'Mistake' : 'Blunder';

/** Moves the play network gives at least this chance are tried (its top 3), plus the one really made. */
const MIN_P = 0.08, TOP = 3;
/** Near enough to be in a fight with you, or to jump you within the 20 s. */
const WITH = 0.08, THREAT = 0.14;
/** A move's souls over the 20 s for the player, as a share of the match's pace (everyone else earns 1). */
const INCOME: Record<Action, number> = { lane: 1, farm: 1.3, objective: 0.6, fight: 0.3, move: 0.4, base: 0.1 };

export interface DlOption {
  action: Action;
  /** the team's win chance after it (0–1), assuming the enemy's best reply */ value: number;
  /** the enemy's reply that's assumed, in words, and the fight's odds when there's one */ reply: string; fight?: number;
}
export interface DlSearch {
  t: number; slot: number; team: DlTeam;
  /** the team's win chance now */ before: number;
  /** every option tried, best first */ options: DlOption[];
  /** the move really made (null: the match ends before 20 s are up) and what it gave up against the best */
  played: DlOption | null; loss: number; cls: SearchClass | null;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Where a move leaves things 20 s on: souls earned, heroes lost each side, an objective down. */
interface Outcome { kills: number; losses: number; mine: number; theirs: number; objective?: 'guardians' | 'walkers' | 'baseGuardians' | 'shrines' }

/** How the enemy replies: 'worst' for you (like a chess engine), 'likely' (a fight they'd win they take, one they'd lose they
 * leave: weighted by the fight model), or 'none' (only what each move usually does). */
export type Replies = 'worst' | 'likely' | 'none';
export function searchAt(m: DlMatch, demo: DlDemo | null, slot: number, t: number, fx: Effects | null = EFFECTS, replies: Replies = REPLIES): DlSearch | null {
  const me = m.players.find(p => p.slot === slot), at = playerAt(m, slot, t);
  if (!me || !at || t + WINDOW > m.duration) return null;
  const team = me.team, foe = (1 - team) as DlTeam;
  const s0 = valueStateAt(m, demo, t);
  const value = (s: ValueState) => (team === 0 ? stateChance(s) : 1 - stateChance(s));
  const before = value(s0);

  // the match's pace: souls per player per second so far; a hero's bounty; how long the dead stay dead around now
  const pace = (s0.teams[0].souls + s0.teams[1].souls) / 12 / Math.max(60, t);
  const bounty = 150 + 12 * (t / 60);
  const near = m.deaths.filter(d => Math.abs(d.t - t) < 300 && d.respawn > 0).map(d => d.respawn).sort((a, b) => a - b);
  const respawn = near.length ? near[near.length >> 1] : 10 + t / 40;
  const stayDead = respawn > WINDOW * 0.6 ? 1 : 0.5;

  /** The moment 20 s on after an outcome (both teams earn at the match's pace; the player at their move's share). */
  const after = (o: Outcome): ValueState => {
    const next = (x: TeamState, earn: number, kills: number, lost: number, obj?: Outcome['objective']): TeamState => ({
      ...x, souls: x.souls + earn + kills * bounty, kills: x.kills + kills, alive: Math.max(0, x.alive - lost * stayDead),
      ...(obj ? { [obj]: x[obj] + 1 } : {}),
    });
    const mine = next(s0.teams[team], pace * WINDOW * o.mine, o.kills, o.losses);
    const theirs = next(s0.teams[foe], pace * WINDOW * o.theirs, o.losses, o.kills, o.objective);
    const teams: [TeamState, TeamState] = team === 0 ? [mine, theirs] : [theirs, mine];
    return { t: t + WINDOW, teams };
  };
  const plain = (a: Action): Outcome => ({ kills: 0, losses: 0, mine: 5 + INCOME[a], theirs: 6 });
  // what the move usually does from here (learned); without the model, the souls rule
  const input = playInput(m, slot, t);
  const usual = (a: Action) => (fx && input ? before + effectOf(fx, input.f, a) : value(after(plain(a))));

  // who's where: my side (me and allies with me), the enemies close enough to fight or to jump me
  const alive = (tm: DlTeam) => m.players.filter(p => p.team === tm).map(p => ({ slot: p.slot, at: playerAt(m, p.slot, t) })).filter(x => x.at) as { slot: number; at: { x: number; y: number } }[];
  const mine = alive(team).filter(x => dist(x.at, at) < WITH).map(x => x.slot);
  const threats = alive(foe).filter(x => dist(x.at, at) < THREAT).map(x => x.slot);
  /** A fight's expected outcome: my side against these enemies at a spot (their objective there shoots for them). */
  const fight = (them: number[], spot: { x: number; y: number }, mult: number) => {
    const a = sideAt(m, team, mine, t, spot), b = sideAt(m, foe, them, t, spot);
    if (!a.n || !b.n) return null;
    const p = fightChance(FIGHT, t, a, b);
    const win = after({ kills: Math.max(1, Math.round(b.n * 0.6)), losses: Math.round(a.n * 0.15), mine: 5 + mult, theirs: 6 - b.n * 0.7 });
    const lose = after({ kills: Math.round(b.n * 0.15), losses: Math.max(1, Math.round(a.n * 0.6)), mine: 5 + mult - a.n * 0.7, theirs: 6 });
    return { p, v: p * value(win) + (1 - p) * value(lose) };
  };
  // the enemy's objectives still standing, nearest first
  const KIND = { guardian: 'guardians', walker: 'walkers', 'base guardian': 'baseGuardians', shrine: 'shrines' } as const;
  const targets = m.objectives.filter(o => o.team === foe && (o.destroyed === null || o.destroyed > t) && o.kind in KIND)
    .map(o => ({ o, spot: objectiveSpot(foe, o.id) })).filter(x => x.spot).map(x => ({ ...x, d: dist(x.spot!, at) })).sort((a, b) => a.d - b.d);
  const target = targets[0] && targets[0].d < 0.2 ? targets[0] : null;
  // heroes needed to take one in the time: a guardian alone, a walker with two, base with three
  const enough = (kind: string) => mine.length >= (kind === 'guardian' ? 1 : kind === 'walker' ? 2 : 3);

  /** The enemy chooses between two lines: worst for you, or the one their fight odds favour (q: their chance in it). */
  const reply = (mineV: number, theirV: number, q: number) => (replies === 'worst' ? Math.min(mineV, theirV) : replies === 'likely' ? q * theirV + (1 - q) * mineV : mineV);
  const tryMove = (a: Action): DlOption | null => {
    const base = usual(a);
    // what the enemy near can do instead: jump me (if it's good for them)
    const jumped = threats.length ? fight(threats, at, INCOME[a]) : null;
    const punish = (v: number, what: string): DlOption => {
      if (!jumped || replies === 'none') return { action: a, value: v, reply: what };
      const r = reply(v, jumped.v, 1 - jumped.p);
      return r < v - 1e-9 ? { action: a, value: r, reply: 'they jump you', fight: jumped.p } : { action: a, value: v, reply: what };
    };
    if (a === 'fight') {
      if (!threats.length) return null;
      const f = fight(threats, at, INCOME.fight)!;
      // they can fall back instead: their objective there falls if it's close, they earn less
      const there = target && target.d < 0.07 && enough(target.o.kind) ? KIND[target.o.kind as keyof typeof KIND] : undefined;
      const back = there ? value(after({ kills: 0, losses: 0, mine: 5 + INCOME.fight, theirs: 6 - threats.length * 0.7, objective: there })) : usual('move');
      if (replies === 'none') return { action: a, value: f.v, reply: 'they take the fight', fight: f.p };
      // they take it when it's good for them (their chance 1 − p), else fall back
      const r = replies === 'worst' ? Math.min(back, f.v) : (1 - f.p) * f.v + f.p * back;
      return replies === 'worst' && back < f.v ? { action: a, value: back, reply: there ? 'they fall back, the objective falls' : 'they fall back' } : { action: a, value: r, reply: f.p > 0.5 && replies === 'likely' ? 'they likely fall back' : 'they take the fight', fight: f.p };
    }
    if (a === 'objective') {
      if (!target) return null;
      const spot = target.spot!, defenders = alive(foe).filter(x => dist(x.at, spot) < 0.12).map(x => x.slot);
      const falls = enough(target.o.kind) ? value(after({ ...plain('objective'), objective: KIND[target.o.kind as keyof typeof KIND] })) : usual('objective');
      const defend = defenders.length ? fight(defenders, spot, INCOME.objective) : null;
      if (defend && replies !== 'none') { const r = reply(falls, defend.v, 1 - defend.p); if (r < falls - 1e-9) return { action: a, value: r, reply: 'they defend it', fight: defend.p }; }
      return { action: a, value: falls, reply: enough(target.o.kind) ? 'it falls' : 'not enough of you to take it' };
    }
    if (a === 'farm' && Math.min(...DL_MAP.camps.map(c => dist(c, at))) > 0.15) return null;
    if (a === 'base') return { action: a, value: base, reply: 'safe' };
    return punish(base, 'nothing');
  };

  const chances = playChances(PLAY_NET, m, slot, t);
  const played = actionAt(m, slot, t);
  const tried = new Set<Action>((chances ? (Object.entries(chances) as [Action, number][]).sort((a, b) => b[1] - a[1]).filter(([, p], i) => i < TOP && p >= MIN_P).map(([a]) => a) : ['lane', 'farm'] as Action[]));
  if (played) tried.add(played);
  const options = [...tried].filter(a => ACTIONS.includes(a)).map(tryMove).filter((o): o is DlOption => !!o).sort((a, b) => b.value - a.value);
  if (!options.length) return null;
  const made = played ? options.find(o => o.action === played) ?? null : null;
  const loss = made ? Math.max(0, options[0].value - made.value) : 0;
  return { t, slot, team, before, options, played: made, loss, cls: made ? searchClass(loss) : null };
}

import { simulate } from './combat';
import type { TacticalEngine } from './predict';
import type { BoardState } from './types';

/** Aggregated outcome of many simulated rounds of the same setup. */
export interface BatchStats {
  rounds: number;
  players: Record<string, { pKill: number; avgKills: number; survive: number; flashed: number; utilDamage: number }>;
  /** Round result by who is left standing (no bomb modelled): elimination or more players alive. */
  ctWin: number;
  tWin: number;
  draw: number;
  /** Per grenade: average CTs/Ts it blinded (≥1 s) and damage it dealt to each side, per round. */
  utility: Record<string, { blindCT: number; blindT: number; dmgCT: number; dmgT: number; kills: number }>;
}

/** Utility impact: CT round-win change when each grenade is removed from the plan. */
export type UtilityImpact = Record<string, { ctWinDelta: number; rounds: number }>;

function accumulate(engine: TacticalEngine, board: BoardState, end: number, from: number, to: number, acc: Acc) {
  const side = new Map(board.players.map(p => [p.id, p.side]));
  for (let r = from; r < to; r++) {
    const sim = simulate(engine, board, end, 1000 + r);
    const roundKills = new Map<string, number>();
    for (const k of sim.kills) if (k.killer) roundKills.set(k.killer, (roundKills.get(k.killer) ?? 0) + 1);
    for (const [id, c] of roundKills) { acc.kills.set(id, (acc.kills.get(id) ?? 0) + c); acc.anyKill.set(id, (acc.anyKill.get(id) ?? 0) + 1); }
    const flashedThisRound = new Set<string>();
    for (const e of sim.utilEvents) {
      const u = acc.util.get(e.src) ?? { blindCT: 0, blindT: 0, dmgCT: 0, dmgT: 0, kills: 0 };
      const ct = side.get(e.id) === 'CT';
      if (e.kind === 'blind' && e.amount >= 1) { flashedThisRound.add(e.id); if (ct) u.blindCT++; else u.blindT++; }
      if (e.kind !== 'blind') {
        if (ct) u.dmgCT += e.amount; else u.dmgT += e.amount;
        acc.utilDmg.set(e.id, (acc.utilDmg.get(e.id) ?? 0) + e.amount);
      }
      acc.util.set(e.src, u);
    }
    for (const id of flashedThisRound) acc.flashed.set(id, (acc.flashed.get(id) ?? 0) + 1);
    let ctAlive = 0, tAlive = 0;
    board.players.forEach((p, i) => {
      if (Number.isFinite(sim.deathT[i])) return;
      acc.alive.set(p.id, (acc.alive.get(p.id) ?? 0) + 1);
      if (p.side === 'CT') ctAlive++; else tAlive++;
    });
    if (ctAlive > tAlive) acc.ct++; else if (tAlive > ctAlive) acc.t++; else acc.draw++;
    acc.done++;
  }
}

interface Acc {
  kills: Map<string, number>; anyKill: Map<string, number>; alive: Map<string, number>;
  flashed: Map<string, number>; utilDmg: Map<string, number>;
  util: Map<string, BatchStats['utility'][string]>;
  ct: number; t: number; draw: number; done: number;
}
const newAcc = (): Acc => ({ kills: new Map(), anyKill: new Map(), alive: new Map(), flashed: new Map(), utilDmg: new Map(), util: new Map(), ct: 0, t: 0, draw: 0, done: 0 });

function snapshot(board: BoardState, a: Acc): BatchStats {
  const n = Math.max(1, a.done);
  return {
    rounds: a.done,
    players: Object.fromEntries(board.players.map(p => [p.id, {
      pKill: (a.anyKill.get(p.id) ?? 0) / n,
      avgKills: (a.kills.get(p.id) ?? 0) / n,
      survive: (a.alive.get(p.id) ?? 0) / n,
      flashed: (a.flashed.get(p.id) ?? 0) / n,
      utilDamage: (a.utilDmg.get(p.id) ?? 0) / n,
    }])),
    ctWin: a.ct / n, tWin: a.t / n, draw: a.draw / n,
    utility: Object.fromEntries(board.utility.filter(u => u.type !== 'smoke').map(u => {
      const v = a.util.get(u.id) ?? { blindCT: 0, blindT: 0, dmgCT: 0, dmgT: 0, kills: 0 };
      return [u.id, { blindCT: v.blindCT / n, blindT: v.blindT / n, dmgCT: v.dmgCT / n, dmgT: v.dmgT / n, kills: v.kills / n }];
    })),
  };
}

/**
 * Runs `rounds` seeded simulations in small chunks so the UI stays responsive.
 * Returns a cancel function; `onUpdate` receives running totals.
 */
export function runBatch(
  engine: TacticalEngine, board: BoardState, end: number, rounds: number,
  onUpdate: (s: BatchStats, done: boolean) => void,
): () => void {
  let cancelled = false;
  const acc = newAcc();
  const chunk = () => {
    if (cancelled) return;
    accumulate(engine, board, end, acc.done, Math.min(rounds, acc.done + 8), acc);
    onUpdate(snapshot(board, acc), acc.done >= rounds);
    if (acc.done < rounds) setTimeout(chunk, 0);
  };
  setTimeout(chunk, 0);
  return () => { cancelled = true; };
}

/**
 * For each grenade, replays the same seeded rounds without it and reports how the CT
 * round-win rate moves. Same seeds on both sides, so the difference is the grenade.
 */
export function runUtilityImpact(
  engine: TacticalEngine, board: BoardState, end: number, rounds: number,
  onUpdate: (impact: UtilityImpact, done: boolean) => void,
): () => void {
  let cancelled = false;
  const items = board.utility.slice(0, 8);
  const out: UtilityImpact = {};
  let k = -1; // -1 = baseline with every grenade
  let baseline = 0;
  let acc = newAcc();
  const chunk = () => {
    if (cancelled || k >= items.length) return;
    const without = k < 0 ? board : { ...board, utility: board.utility.filter(x => x.id !== items[k].id) };
    accumulate(engine, without, end, acc.done, Math.min(rounds, acc.done + 8), acc);
    if (acc.done >= rounds) {
      const ctWin = (acc.ct + acc.draw * 0.5) / acc.done;
      if (k < 0) baseline = ctWin;
      else out[items[k].id] = { ctWinDelta: baseline - ctWin, rounds };
      k++;
      acc = newAcc();
      if (k > 0) onUpdate({ ...out }, k >= items.length);
    }
    if (k < items.length) setTimeout(chunk, 0);
  };
  setTimeout(chunk, 0);
  return () => { cancelled = true; };
}

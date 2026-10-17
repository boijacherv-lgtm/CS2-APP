import type { Hold, Move } from './situations';
import { advantageOf, proMoves, proReactions, proSituationSpots, proSpots } from '../map/positions';
import CALIBRATION from './models/engine-calibration.json';

/**
 * The positioning "engine", like Stockfish for a chess move: at each decision it lists the moves FACEIT level-10
 * players make in that situation, values each by how much it changed the round for them (`gain` from
 * tools/learn-positions.ts: round won − win chance when chosen, shrunk for small samples), picks the best, and
 * compares the player's move with it: the eval loss, a class (Best … Blunder) and an accuracy like chess.com's.
 * For a hold it also looks ahead: where level-10 players usually go next from there, and what that's worth.
 */
export type MoveClass = 'Best' | 'Excellent' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder';
export const CLASS_COLOR: Record<MoveClass, string> = {
  Best: '#1baca6', Excellent: '#5c9ced', Good: '#7fbf4d', Inaccuracy: '#f7c045', Mistake: '#e58f2a', Blunder: '#ca3431',
};
export interface Candidate { place: string; share: number; gain: number; n: number }
export interface EngineVerdict {
  /** The options, best first (only ones level-10 players really use, measured on enough choices). */
  candidates: Candidate[];
  best: Candidate | null;
  /** The player's choice as an option (null when level-10 players never make it: valued as their worst common option). */
  mine: Candidate | null;
  /** Eval lost against the best move, in win-chance points (0.05 = 5%). */
  loss: number;
  cls: MoveClass;
  /** 0–100, like chess.com's move accuracy. */
  accuracy: number;
  /** Looking ahead (holds): where level-10 players usually go next from this spot, with the value of each. */
  next: Candidate[];
}

const MIN_N = 8, MIN_SHARE = 0.03;

/**
 * Calibrated on level-10 play (tools/calibrate-engine.ts): the class thresholds are percentiles of level-10 players'
 * own eval loss, and the accuracy scale makes their typical decision score about 88. Defaults until calibrated.
 */
const CAL = CALIBRATION as { thresholds: number[] | null; scale: number };
const TH = CAL.thresholds ?? [0.02, 0.05, 0.1, 0.18];
/** chess.com-style accuracy from the win-chance points lost (in %), scaled to this game. */
export const accuracyOf = (lossPct: number) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * lossPct * (CAL.scale || 1)) - 3.1669));
export const classOf = (loss: number, isBest: boolean): MoveClass =>
  isBest || loss <= 0.002 ? 'Best' : loss <= TH[0] ? 'Excellent' : loss <= TH[1] ? 'Good' : loss <= TH[2] ? 'Inaccuracy' : loss <= TH[3] ? 'Mistake' : 'Blunder';

function verdict(options: { place: string; share: number; gain?: number; n?: number }[], chosen: string, next: Candidate[] = []): EngineVerdict | null {
  const valued = options.filter((o): o is { place: string; share: number; gain: number; n: number } => o.gain !== undefined && (o.n ?? 0) > 0);
  const candidates = valued.filter(o => o.share >= MIN_SHARE && o.n >= MIN_N).sort((a, b) => b.gain - a.gain);
  if (candidates.length < 2) return null;
  const best = candidates[0];
  const known = valued.find(o => o.place === chosen);
  // a move level-10 players don't make (or too rarely to measure): as good as their worst common option, at best
  const worst = candidates[candidates.length - 1];
  const mine = known && known.n >= 3 ? known : null;
  const value = mine ? mine.gain : worst.gain - 0.02;
  const loss = Math.max(0, best.gain - value);
  const cls = classOf(loss, mine?.place === best.place);
  return { candidates: candidates.slice(0, 5), best, mine, loss, cls, accuracy: +accuracyOf(loss * 100).toFixed(1), next };
}

/** The engine's view of a hold: the spots level-10 players take in the same situation, valued, and what comes next. */
export function engineHold(map: string, h: Hold): EngineVerdict | null {
  const pros = proSituationSpots(map, h.side, h.phase, advantageOf(h.alive), h.site, h.target) ?? proSpots(map, h.side, h.phase);
  // looking ahead: where level-10 players go from this spot
  const from = proMoves(map, h.side).filter(m => m.from === h.place);
  const total = from.reduce((a, m) => a + m.count, 0);
  const next = from.filter(m => m.gain !== undefined).map(m => ({ place: m.to, share: m.count / (total || 1), gain: m.gain!, n: m.count }))
    .sort((a, b) => b.share - a.share).slice(0, 3);
  return verdict(pros.map(p => ({ place: p.place, share: p.share, gain: p.gain, n: p.n })), h.place, next);
}

/** The engine's view of a move: where level-10 players go from the same spot (after the same trigger when there's data), valued. */
export function engineMove(map: string, m: Move): EngineVerdict | null {
  const re = m.trigger ? proReactions(map, m.side).find(r => r.from === m.from && r.trigger === m.trigger && r.n >= 8) : undefined;
  if (re) return verdict(re.to.map(t => ({ place: t.place, share: t.n / re.n, gain: t.gain, n: t.n })), m.to);
  const from = proMoves(map, m.side).filter(x => x.from === m.from);
  const total = from.reduce((a, x) => a + x.count, 0);
  return verdict(from.map(x => ({ place: x.to, share: x.count / (total || 1), gain: x.gain, n: x.count })), m.to);
}

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 1000) / 10)}%`;
/** One line for a verdict: best move, yours, and the loss (no brackets: the move card hides bracketed asides). */
export function engineLine(v: EngineVerdict, what: 'hold' | 'move', chosen: string): string {
  const best = `${v.best!.place} ${pct(v.best!.gain)}`;
  if (v.cls === 'Best') return `The best ${what === 'hold' ? 'spot' : 'move'}: ${best}.`;
  return `Best: ${best}. Yours: ${chosen}${v.mine ? ` ${pct(v.mine.gain)}` : ', which level-10 players don\u2019t do'}, ${Math.round(v.loss * 1000) / 10}% worse.`;
}

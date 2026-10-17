import type { Hold, Move } from './situations';
import { advantageOf, proMoves, proReaction, proSituationSpots, proSpots } from '../map/positions';
import { getEngine } from '../map/catalog';
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
  /** What it was compared with: the exact situation, or a broader one when that had too little data. */
  basis: string;
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

/** Game units between two callouts (straight line), or Infinity when either isn't on the map. */
function apart(map: string, a: string, b: string): number {
  const m = getEngine(map, 0).map;
  const pa = m.callouts.find(c => c.name === a)?.pos, pb = m.callouts.find(c => c.name === b)?.pos;
  return pa && pb ? Math.hypot(pa.x - pb.x, pa.y - pb.y) * m.radar.scale : Infinity;
}
/** Options a player could actually take from `place`: the nearby ones (a few seconds away), widening only if there are too few. */
function reachable<T extends { place: string }>(map: string, place: string, options: T[]): T[] {
  for (const reach of [1800, 3000]) {
    const near = options.filter(o => o.place === place || apart(map, place, o.place) <= reach);
    if (near.length >= 3) return near;
  }
  return options;
}

function verdict(options: { place: string; share: number; gain?: number; n?: number }[], chosen: string | string[], next: Candidate[] = [], basis = 'the same situation'): EngineVerdict | null {
  const valued = options.filter((o): o is { place: string; share: number; gain: number; n: number } => o.gain !== undefined && (o.n ?? 0) > 0);
  const candidates = valued.filter(o => o.share >= MIN_SHARE && o.n >= MIN_N).sort((a, b) => b.gain - a.gain);
  if (candidates.length < 2) return null;
  const best = candidates[0];
  // `chosen` can be a path: the move matches an option it went through (the best of them)
  const picks = Array.isArray(chosen) ? chosen : [chosen];
  const known = valued.filter(o => picks.includes(o.place)).sort((a, b) => b.gain - a.gain)[0];
  // a move level-10 players don't make (or too rarely to measure): as good as their worst common option, at best
  const worst = candidates[candidates.length - 1];
  const mine = known && known.n >= 3 ? known : null;
  const value = mine ? mine.gain : worst.gain - 0.02;
  const loss = Math.max(0, best.gain - value);
  const cls = classOf(loss, mine?.place === best.place);
  return { candidates: candidates.slice(0, 5), best, mine, loss, cls, accuracy: +accuracyOf(loss * 100).toFixed(1), next, basis };
}

const PHASE_WORD: Record<Hold['phase'], string> = { early: 'the first 25 s', mid: '25–60 s', late: 'after 60 s', 'post-plant': 'after the plant' };

/**
 * The engine's view of a hold: the spots level-10 players take in the same situation, valued, and what comes next.
 * When the exact situation has too little data it widens step by step, like an engine still evaluating a rare
 * position: the same part of the round and numbers → the same part of the round.
 */
export function engineHold(map: string, h: Pick<Hold, 'side' | 'place' | 'phase' | 'alive' | 'site' | 'target'>, chosen: string | string[] = h.place): EngineVerdict | null {
  const from = proMoves(map, h.side).filter(m => m.from === h.place);
  const total = from.reduce((a, m) => a + m.count, 0);
  const next = from.filter(m => m.gain !== undefined).map(m => ({ place: m.to, share: m.count / (total || 1), gain: m.gain!, n: m.count }))
    .sort((a, b) => b.share - a.share).slice(0, 3);
  const adv = advantageOf(h.alive);
  const tries: [ReturnType<typeof proSpots> | null, string][] = [
    [proSituationSpots(map, h.side, h.phase, adv, h.site, h.target), 'the same situation'],
    [proSituationSpots(map, h.side, h.phase, adv), `${PHASE_WORD[h.phase]} with the same numbers`],
    [proSpots(map, h.side, h.phase), PHASE_WORD[h.phase]],
  ];
  for (const [pros, basis] of tries) {
    if (!pros?.length) continue;
    // only the spots they could have taken from where they were
    const options = reachable(map, h.place, pros.map(p => ({ place: p.place, share: p.share, gain: p.gain, n: p.n })));
    const v = verdict(options, chosen, next, basis);
    if (v) return v;
  }
  return null;
}

/**
 * The engine's view of a move: where level-10 players go from the same spot (after the same trigger when there's
 * enough data), valued; with too little data for that spot, where they went is judged as a position at that point
 * of the round.
 */
export function engineMove(map: string, m: Move): EngineVerdict | null {
  // the move matches what pros did if it went *through* where they went (they stop there, you kept going)
  const path = [...(m.via ?? []), m.to];
  const re = m.trigger ? proReaction(map, m.side, m.from, m.trigger, m.phase, 8) : undefined;
  if (re) { const v = verdict(re.to.map(t => ({ place: t.place, share: t.n / re.n, gain: t.gain, n: t.n })), path, [], `after "${m.trigger}" at ${m.from}`); if (v) return v; }
  const from = proMoves(map, m.side).filter(x => x.from === m.from && (x.phases[m.phase] ?? 0) > 0);
  const total = from.reduce((a, x) => a + (x.phases[m.phase] ?? 0), 0);
  const v = verdict(from.map(x => ({ place: x.to, share: (x.phases[m.phase] ?? 0) / (total || 1), gain: x.gain, n: x.count })), path, [], `leaving ${m.from}`);
  if (v) return v;
  // where they went, as a position at that point of the round
  const h = engineHold(map, { side: m.side, place: m.to, phase: m.phase, alive: [5, 5] }, path);
  return h ? { ...h, basis: `where they went, as a spot at ${PHASE_WORD[m.phase]}` } : null;
}

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 1000) / 10)}%`;
/** One line for a verdict: best move, yours, and the loss (no brackets: the move card hides bracketed asides). */
export function engineLine(v: EngineVerdict, what: 'hold' | 'move', chosen: string): string {
  const best = `${v.best!.place} ${pct(v.best!.gain)}`;
  if (v.cls === 'Best') return `The best ${what === 'hold' ? 'spot' : 'move'}: ${best}.`;
  return `Best: ${best}. Yours: ${chosen}${v.mine ? ` ${pct(v.mine.gain)}` : ', which level-10 players don\u2019t do'}, ${Math.round(v.loss * 1000) / 10}% worse.`;
}

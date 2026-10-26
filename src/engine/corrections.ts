/**
 * The coach learning from disputed moments. A player says "Coach wrong?" on a move; the site's owner watches it and
 * rules who was right (Dev → Disputes). Each ruling counts for the move's pattern: its kind, the coach's mark and the
 * tags that decide marks (an isolated opening death marked ?, a wasted molly marked ?…). Once enough checked moments
 * of a pattern say the coach was wrong, moves like it are marked a step softer (or harder, for mistakes it let pass),
 * live on the site, with the reason on the card. Only rulings count, never a player's word alone.
 *
 * The learning tools (eval, calibrate) never use this: they measure the coach itself.
 */
import type { Annotation, Move, Tag } from './recap';
import { verdictKey } from './profile';

/** Rulings on one pattern: the owner sided with the player (the coach was wrong) or with the coach, and why. */
export interface Correction { wrong: number; right: number; why?: Partial<Record<JudgeReason, number>> }

/** What the coach missed (or, when it was right, what the player did wrong): picked when judging a moment. */
export const JUDGE_REASONS = {
  luck: 'Bad luck or a great shot',
  role: 'Their role there',
  call: 'The team\'s call or plan',
  info: 'Info the coach can\'t see (sound, comms)',
  position: 'Positioning',
  timing: 'Timing',
  utility: 'Utility',
  trade: 'Trading and teamwork',
  aim: 'Aim',
  economy: 'Economy',
} as const;
export type JudgeReason = keyof typeof JUDGE_REASONS;
export const isJudgeReason = (r: unknown): r is JudgeReason => typeof r === 'string' && r in JUDGE_REASONS;
export type CorrectionTable = Record<string, Correction>;

/** The tags that decide how a move is marked (the rest only describe it). */
const DECIDING: Tag[] = [
  'OPENING', 'TRADED', 'ISOLATED', 'CROSSFIRE', 'BLIND', 'LOW HP', 'AWP LOST', 'UNUSED UTIL', 'WHIFF', 'POST-PLANT', 'OUTGUNNED',
  'ECO DEATH', 'BAD PEEK', 'DRY PEEK', 'KNIFE OUT', 'NO AMMO', 'MOVING SHOT', 'LOUD', 'WASTED', 'TEAM FLASH', 'TEAM DAMAGE', 'NO TRADE',
  'LATE ROTATION', 'OVER-ROTATION', 'STALL', 'DENIED',
];
export const patternOf = (kind: string, note: string, tags: readonly string[]) =>
  `${kind}|${note}|${tags.filter(t => (DECIDING as string[]).includes(t)).sort().join(',')}`;

/** A pattern changes once this many checked moments say so, and this share of its rulings agree. */
export const MIN_CASES = 3, MIN_SHARE = 0.75;

const FLAGGED: Annotation[] = ['?!', '?', '??'];
const SOFTER: Partial<Record<Annotation, Annotation>> = { '??': '?', '?': '?!', '?!': 'book' };

/** What the rulings change on this move (null: nothing, or not enough of them yet). */
export function correctionFor(table: CorrectionTable | null, m: Pick<Move, 'kind' | 'note' | 'tags'>): { note: Annotation; why: string } | null {
  const c = table?.[patternOf(m.kind, m.note, m.tags)];
  if (!c || c.wrong < MIN_CASES || c.wrong / (c.wrong + c.right) < MIN_SHARE) return null;
  const of = c.wrong + c.right;
  // the reason given most often, so the card says what the coach misses here
  const top = Object.entries(c.why ?? {}).sort((a, b) => b[1] - a[1])[0];
  const mostly = top && top[1] >= 2 ? ` (mostly: ${JUDGE_REASONS[top[0] as JudgeReason].toLowerCase()})` : '';
  if (FLAGGED.includes(m.note)) {
    const note = SOFTER[m.note];
    return note ? { note, why: `Checked by hand: in ${c.wrong} of ${of} moments like this the player was right that it wasn't ${m.note === '?!' ? 'an inaccuracy' : 'a mistake'}${mostly}, so it's marked softer.` } : null;
  }
  // a move the coach let pass that players were right to call a mistake
  if (m.note === 'book' || m.note === '!') return { note: '?!', why: `Checked by hand: in ${c.wrong} of ${of} moments like this the player was right that it was a mistake${mostly}.` };
  return null;
}

/** The moves with the rulings applied (a new list; moves without a ruled pattern are the same objects). */
export function applyCorrections<M extends Move>(moves: M[], table: CorrectionTable | null): M[] {
  if (!table || !Object.keys(table).length) return moves;
  return moves.map(m => {
    const c = correctionFor(table, m);
    return c ? { ...m, note: c.note, why: [...m.why, c.why] } : m;
  });
}

/** The table from rulings (worker/src/clips.ts keeps them). */
export function tableOf(rulings: { pattern: string; side: 'player' | 'coach'; reason?: JudgeReason }[]): CorrectionTable {
  const out: CorrectionTable = {};
  for (const r of rulings) {
    const c = (out[r.pattern] ??= { wrong: 0, right: 0 });
    if (r.side === 'player') {
      c.wrong++;
      if (r.reason) (c.why ??= {})[r.reason] = (c.why[r.reason] ?? 0) + 1;
    } else c.right++;
  }
  return out;
}

/** Marks the owner removed by hand, one moment at a time (verdictKey of the moment: match, round, time, player, kind). */
export const REMOVED_WHY = 'Removed by hand: checked, not a mistake.';
/** The moves with the removed marks taken off (they stay as plain moves, so the mark can be restored). */
export function removeMarks<M extends Move>(moves: M[], removed: readonly string[] | null | undefined, at: { match: string; round: number }): M[] {
  if (!removed?.length) return moves;
  const set = new Set(removed);
  return moves.map(m => (set.has(verdictKey({ match: at.match, round: at.round, t: m.t, player: m.player, kind: m.kind }))
    ? { ...m, note: 'book' as Annotation, gain: Math.max(0, m.gain), why: [...m.why, REMOVED_WHY], removed: true } : m));
}

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

/** Rulings on one pattern: the owner sided with the player (the coach was wrong) or with the coach. */
export interface Correction { wrong: number; right: number }
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
  if (FLAGGED.includes(m.note)) {
    const note = SOFTER[m.note];
    return note ? { note, why: `Checked by hand: in ${c.wrong} of ${of} moments like this the player was right that it wasn't ${m.note === '?!' ? 'an inaccuracy' : 'a mistake'}, so it's marked softer.` } : null;
  }
  // a move the coach let pass that players were right to call a mistake
  if (m.note === 'book' || m.note === '!') return { note: '?!', why: `Checked by hand: in ${c.wrong} of ${of} moments like this the player was right that it was a mistake.` };
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
export function tableOf(rulings: { pattern: string; side: 'player' | 'coach' }[]): CorrectionTable {
  const out: CorrectionTable = {};
  for (const r of rulings) {
    const c = (out[r.pattern] ??= { wrong: 0, right: 0 });
    if (r.side === 'player') c.wrong++; else c.right++;
  }
  return out;
}

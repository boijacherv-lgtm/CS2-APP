import type { Hold, Move } from './situations';
import { PHASE_LABEL } from './situations';
import { advantageOf, proMoves, proReaction, proRisk, proSituationSpots, proSpots, type ProRisk, type ProSpot } from '../map/positions';

/**
 * Step 2 of the decision coach: each of a player's decisions next to what FACEIT level-10 players do in the same
 * situation (learned by tools/learn-positions.ts).
 *   a hold   where they stood, against where level-10 players stand at that point of the round with the same
 *            numbers (2v3, 5v5…), with how often each choice wins the round
 *   a move   where they went, against where level-10 players go from that spot, after the same trigger when there's
 *            enough data for it (a teammate died at X, an enemy was seen at Y)
 */
export type Usual = 'common' | 'rare' | 'unusual' | 'unknown';
export const USUAL_LABEL: Record<Usual, string> = { common: 'Like the pros', rare: 'Rare for pros', unusual: 'Pros don’t', unknown: 'No data' };

export interface HoldVerdict {
  kind: Usual; share: number | null; winRate: number | null; pros: ProSpot[]; basis: string; text: string; better: ProSpot | null;
  /** Step 3: why, from how holding this spot goes for level-10 players in the same pressure / support. */
  reasons: string[];
  /** What the coach should flag: stayed under pressure where pros leave, played it alone where pros need a teammate. */
  flags: ('stayed-under-fire' | 'alone' | 'off-meta')[];
  /** Where pros fall back to from here under this pressure. */
  fallback: string | null;
}
export interface MoveVerdict { kind: Usual; pros: { place: string; share: number }[]; basis: string; text: string; samples: number }

const pct = (v: number) => `${Math.round(v * 100)}%`;
const SIDE_WORD = { CT: 'CTs', T: 'Ts' } as const;
const advWord = (alive: [number, number]) => `${alive[0]}v${alive[1]}`;

/** A hold against where level-10 players stand in the same situation. */
export function judgeHold(map: string, h: Hold): HoldVerdict {
  const adv = advantageOf(h.alive);
  const inSituation = proSituationSpots(map, h.side, h.phase, adv, h.site, h.target);
  const pros = inSituation ?? proSpots(map, h.side, h.phase);
  const when = h.phase === 'post-plant' ? `after the plant${h.site ? ` on ${h.site}` : ''}` : `at ${PHASE_LABEL[h.phase]}`;
  const basis = `level-10 ${SIDE_WORD[h.side]} ${when}${inSituation ? ` (${adv === 'even' ? 'even numbers' : adv === 'up' ? 'a player up' : 'a player down'})` : ''}`;
  if (!pros.length) return { kind: 'unknown', share: null, winRate: null, pros, basis, text: 'No level-10 data for this map yet.', better: null, reasons: [], flags: [], fallback: null };
  const mine = pros.find(p => p.place === h.place) ?? null;
  // "pros don't" only when it's really never (under 1% of their time) and there's enough data to say so
  const kind: Usual = mine ? (mine.share >= 0.08 ? 'common' : 'rare') : pros.reduce((a, p) => a + p.rounds, 0) >= 60 ? 'unusual' : 'rare';
  // a clearly better-winning common spot, if there is one
  // only a clear, well-measured gap (both spots seen in 25+ rounds, 12+ points apart) counts as "better"
  const better = pros.filter(p => p.place !== h.place && p.share >= 0.08 && p.rounds >= 25 && (mine?.rounds ?? 0) >= 25 && p.winRate >= (mine?.winRate ?? 0) + 0.12)
    .sort((a, b) => b.winRate - a.winRate)[0] ?? null;
  const top = pros.slice(0, 3).map(p => `${p.place} ${pct(p.share)}`).join(', ');
  const { reasons, flags, fallback } = holdReasons(map, h);
  if (kind === 'unusual') flags.push('off-meta');
  const text = [
    `${h.contact ? 'Fought at' : 'Held'} ${h.place} (${advWord(h.alive)}${h.target ? `, team going ${h.target}` : ''}).`,
    mine ? `${pct(mine.share)} of ${basis} are here (they win ${pct(mine.winRate)} of those rounds).` : `Level-10 players almost never stand here at this point; they're at ${top}.`,
    mine && kind !== 'common' ? `Most are at ${top}.` : '',
    better ? `${better.place} wins more: ${pct(better.winRate)}${mine ? ` vs ${pct(mine.winRate)}` : ''}.` : '',
    ...reasons,
  ].filter(Boolean).join(' ');
  return { kind, share: mine?.share ?? null, winRate: mine?.winRate ?? null, pros, basis, text, better, reasons, flags, fallback };
}

/** A move against where level-10 players go from the same spot (after the same trigger when there's data for it). */
export function judgeMove(map: string, m: Move): MoveVerdict {
  const reaction = m.trigger ? proReaction(map, m.side, m.from, m.trigger, m.phase, 5) : undefined;
  let pros: { place: string; share: number }[], samples: number, basis: string;
  if (reaction) {
    samples = reaction.n;
    pros = reaction.to.map(t => ({ place: t.place, share: t.n / reaction.n }));
    basis = `level-10 ${SIDE_WORD[m.side]} at ${m.from} after "${m.trigger}"`;
  } else {
    const from = proMoves(map, m.side).filter(x => x.from === m.from);
    samples = from.reduce((a, x) => a + x.count, 0);
    pros = from.map(x => ({ place: x.to, share: x.count / (samples || 1) })).sort((a, b) => b.share - a.share);
    basis = `level-10 ${SIDE_WORD[m.side]} leaving ${m.from}`;
  }
  if (samples < 5) return { kind: 'unknown', pros, basis, samples, text: `Moved ${m.from} → ${m.to}${m.trigger ? ` after "${m.trigger}"` : ''}. Not enough level-10 data for this spot yet.` };
  // going *through* where pros go counts: they stop there, you kept going
  const path = [...(m.via ?? []), m.to];
  const mine = pros.filter(p => path.includes(p.place)).sort((a, b) => b.share - a.share)[0];
  const kind: Usual = mine ? (mine.share >= 0.15 ? 'common' : 'rare') : samples >= 20 ? 'unusual' : 'rare';
  const top = pros.slice(0, 3).map(p => `${p.place} ${pct(p.share)}`).join(', ');
  const text = [
    `Moved ${m.from} → ${m.to}${m.trigger ? ` right after "${m.trigger}"` : ''}.`,
    mine ? `${pct(mine.share)} of ${basis} ${mine.place === m.to ? 'do the same' : `go to ${mine.place}, which you went through`} (${samples} times seen).` : `${basis[0].toUpperCase()}${basis.slice(1)} go elsewhere: ${top} (${samples} times seen).`,
    mine && kind !== 'common' ? `More often: ${top}.` : '',
  ].filter(Boolean).join(' ');
  return { kind, pros, basis, samples, text };
}

const enemies = (n: number) => (n >= 2 ? '2+ enemies' : n === 1 ? 'an enemy' : 'no enemy');
const died = (r: ProRisk) => r.died / r.n;

/**
 * Step 3, the "why": how holding this spot goes for level-10 players with the same pressure (enemies in sight
 * nearby) and support (alone or not), compared with the alternatives: staying vs falling back, alone vs with a
 * teammate. Only said when there are enough holds to mean something.
 */
export function holdReasons(map: string, h: Hold): { reasons: string[]; flags: HoldVerdict['flags']; fallback: string | null } {
  const reasons: string[] = [], flags: HoldVerdict['flags'] = [];
  const p = Math.min(2, h.pressure ?? 0);
  const here = proRisk(map, h.side, h.place, p, !!h.alone);
  let fallback: string | null = null;
  if (here && here.n >= 8) {
    const fall = here.to[0];
    if (fall && here.moved / here.n >= 0.3) fallback = fall.place;
    if (p >= 1)
      reasons.push(`Level-10 players holding here with ${enemies(p)} in sight ${h.alone ? 'alone ' : ''}die ${pct(died(here))} of the time${here.moved / here.n >= 0.25 ? `; ${pct(here.moved / here.n)} leave${fall ? `, mostly to ${fall.place}` : ''}` : ''}.`);
    if (p >= 1 && h.ended === 'died' && died(here) >= 0.35 && here.moved / here.n >= 0.3) flags.push('stayed-under-fire');
  }
  // alone vs with a teammate, same spot and pressure
  const other = proRisk(map, h.side, h.place, p, !h.alone);
  if (h.alone && here && other && here.n >= 8 && other.n >= 8 && died(here) - died(other) >= 0.12) {
    reasons.push(`Alone here they die ${pct(died(here))} of the time, with a teammate nearby ${pct(died(other))}.`);
    if (h.ended === 'died') flags.push('alone');
  }
  // the calm version: pros rarely die holding this
  if (here && here.n >= 8 && p === 0 && died(here) <= 0.15 && h.ended === 'died') reasons.push(`When level-10 players do hold ${h.place} with no enemy in sight, they rarely die there (${pct(died(here))}): this was a fight lost, not the spot itself.`);
  if (h.mateDown && h.ended === 'died') reasons.push('A teammate had just died near you: that was the moment to fall back or trade.');
  return { reasons, flags, fallback };
}

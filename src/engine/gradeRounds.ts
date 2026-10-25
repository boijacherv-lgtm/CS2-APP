import { getEngine } from '../map/catalog';
import { analyzeRound } from './analyst';
import { summarizeRound, type RoundSummary } from './match';
import { buildReplay, reviewRound, type DemoData } from './recap';
import { applyCorrections, type CorrectionTable } from './corrections';
import { roundDecisions } from './situations';
import type { BoardState } from './types';

/** The board context grading uses when there's no board (the demo bot, tools): it only shapes the replay's start. */
export const DEFAULT_CONTEXT: BoardState['context'] = { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } };

/**
 * Grades every round of a match: the review (every move's grade), the decisions and the analyst's facts. Used by the
 * browser (match.worker.ts) and by the demo bot (tools/grade-profile.ts). `onRound` gets each as it's done; a round
 * that can't be graded is null. `corrections`: the site's checked disputes (the demo bot grades without them).
 */
export function gradeRounds(data: DemoData, context: BoardState['context'] = DEFAULT_CONTEXT, onRound: (i: number, s: RoundSummary | null) => void = () => {},
  corrections: CorrectionTable | null = null): (RoundSummary | null)[] {
  const engine = getEngine(data.map, 0);
  return data.rounds.map((_, i) => {
    let summary: RoundSummary | null = null;
    try {
      const rep = buildReplay(engine, data, i, context);
      const review = reviewRound(engine, rep);
      summary = summarizeRound(rep, corrections ? { ...review, moves: applyCorrections(review.moves, corrections) } : review);
      try { summary.decisions = roundDecisions(engine, data.rounds[i]); } catch { /* positions are extra */ }
      try { summary.analyst = analyzeRound(engine, data.rounds[i], data.rounds.slice(0, i), data.rounds.length); } catch { /* the analyst is extra */ }
    } catch (err) { console.warn(`round ${i + 1} could not be graded`, err); }
    onRound(i, summary);
    return summary;
  });
}

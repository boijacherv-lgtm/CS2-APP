import { getEngine } from '../map/catalog';
import { analyzeRound } from './analyst';
import { summarizeRound, type RoundSummary } from './match';
import { buildReplay, reviewRound, type DemoData } from './recap';
import { roundDecisions } from './situations';
import type { BoardState } from './types';

/** The board context grading uses when there's no board (the demo bot, tools): it only shapes the replay's start. */
export const DEFAULT_CONTEXT: BoardState['context'] = { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } };

/**
 * Grades every round of a match: the review (every move's grade), the decisions and the analyst's facts. Used by the
 * browser (match.worker.ts) and by the demo bot (tools/grade-profile.ts). `onRound` gets each as it's done; a round
 * that can't be graded is null.
 */
export function gradeRounds(data: DemoData, context: BoardState['context'] = DEFAULT_CONTEXT, onRound: (i: number, s: RoundSummary | null) => void = () => {}): (RoundSummary | null)[] {
  const engine = getEngine(data.map, 0);
  return data.rounds.map((_, i) => {
    let summary: RoundSummary | null = null;
    try {
      const rep = buildReplay(engine, data, i, context);
      summary = summarizeRound(rep, reviewRound(engine, rep));
      try { summary.decisions = roundDecisions(engine, data.rounds[i]); } catch { /* positions are extra */ }
      try { summary.analyst = analyzeRound(engine, data.rounds[i], data.rounds.slice(0, i), data.rounds.length); } catch { /* the analyst is extra */ }
    } catch (err) { console.warn(`round ${i + 1} could not be graded`, err); }
    onRound(i, summary);
    return summary;
  });
}

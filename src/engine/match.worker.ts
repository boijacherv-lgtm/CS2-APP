/// <reference lib="webworker" />
import { getEngine } from '../map/catalog';
import { summarizeRound, type RoundSummary } from './match';
import { roundDecisions } from './situations';
import { analyzeRound } from './analyst';
import { buildReplay, reviewRound, type DemoData } from './recap';
import type { BoardState } from './types';

/**
 * Grades every round of a match off the main thread (about half a second a round with the engine), posting each as
 * it's done. Whatever happens it ends with `done`; a failure that stops it says why (`error`), and the rounds already
 * graded stay.
 */
export type MatchWorkerIn = { data: DemoData; context: BoardState['context'] };
export type MatchWorkerOut = { i: number; summary: RoundSummary | null } | { error: string } | { done: true };

const post = (m: MatchWorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<MatchWorkerIn>) => {
  try { gradeAll(e.data); } catch (err) { post({ error: err instanceof Error ? err.message : String(err) }); }
  post({ done: true });
};

function gradeAll({ data, context }: MatchWorkerIn) {
  const engine = getEngine(data.map, 0);
  for (let i = 0; i < data.rounds.length; i++) {
    let summary: RoundSummary | null = null;
    try {
      const rep = buildReplay(engine, data, i, context);
      summary = summarizeRound(rep, reviewRound(engine, rep));
      try { summary.decisions = roundDecisions(engine, data.rounds[i]); } catch { /* positions are extra */ }
      try { summary.analyst = analyzeRound(engine, data.rounds[i], data.rounds.slice(0, i), data.rounds.length); } catch { /* the analyst is extra */ }
    } catch (err) { console.warn(`round ${i + 1} could not be graded`, err); }
    post({ i, summary });
  }
}

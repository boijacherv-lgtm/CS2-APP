/// <reference lib="webworker" />
import { getEngine } from '../map/catalog';
import { summarizeRound, type RoundSummary } from './match';
import { buildReplay, reviewRound, type DemoData } from './recap';
import type { BoardState } from './types';

/** Grades every round of a match off the main thread (~0.5 s a round), posting each as it's done. */
export type MatchWorkerIn = { data: DemoData; context: BoardState['context'] };
export type MatchWorkerOut = { i: number; summary: RoundSummary | null } | { done: true };

self.onmessage = (e: MessageEvent<MatchWorkerIn>) => {
  const { data, context } = e.data;
  const engine = getEngine(data.map, 0);
  for (let i = 0; i < data.rounds.length; i++) {
    let summary: RoundSummary | null = null;
    try {
      const rep = buildReplay(engine, data, i, context);
      summary = summarizeRound(rep, reviewRound(engine, rep));
    } catch (err) { console.warn(`round ${i + 1} could not be graded`, err); }
    (self as unknown as Worker).postMessage({ i, summary } satisfies MatchWorkerOut);
  }
  (self as unknown as Worker).postMessage({ done: true } satisfies MatchWorkerOut);
};

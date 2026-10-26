/// <reference lib="webworker" />
import type { RoundSummary } from './match';
import { gradeRounds } from './gradeRounds';
import type { DemoData } from './recap';
import type { BoardState } from './types';
import type { CorrectionTable } from './corrections';

/**
 * Grades every round of a match off the main thread (about half a second a round with the engine), posting each as
 * it's done. Whatever happens it ends with `done`; a failure that stops it says why (`error`), and the rounds already
 * graded stay.
 */
export type MatchWorkerIn = { data: DemoData; context: BoardState['context']; corrections?: { table: CorrectionTable; removed: string[] } | null };
export type MatchWorkerOut = { i: number; summary: RoundSummary | null } | { error: string } | { done: true };

const post = (m: MatchWorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<MatchWorkerIn>) => {
  try { gradeAll(e.data); } catch (err) { post({ error: err instanceof Error ? err.message : String(err) }); }
  post({ done: true });
};

function gradeAll({ data, context, corrections }: MatchWorkerIn) {
  gradeRounds(data, context, (i, summary) => post({ i, summary }), corrections ?? null);
}

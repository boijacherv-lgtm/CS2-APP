import type { RoundSummary } from '../engine/match';
import type { MatchWorkerIn, MatchWorkerOut } from '../engine/match.worker';
import type { DemoData } from '../engine/recap';
import type { BoardState } from '../engine/types';
import { currentCorrections } from './corrections';

export interface Grading {
  /** Ends with every round's summary (null where a round couldn't be graded), and why it stopped early if it did. */
  done: Promise<{ rounds: (RoundSummary | null)[]; error?: string }>;
  stop(): void;
}

/** Grades every round of a match in a worker (about half a second a round), calling `onRound` as each is done. */
export function gradeMatch(data: DemoData, context: BoardState['context'], onRound: (rounds: (RoundSummary | null)[]) => void = () => {}): Grading {
  const rounds: (RoundSummary | null)[] = Array(data.rounds.length).fill(null);
  const w = new Worker(new URL('../engine/match.worker.ts', import.meta.url), { type: 'module' });
  let error: string | undefined;
  const done = new Promise<{ rounds: (RoundSummary | null)[]; error?: string }>(resolve => {
    const finish = () => { w.terminate(); resolve({ rounds: [...rounds], ...(error ? { error } : {}) }); };
    w.onmessage = (e: MessageEvent<MatchWorkerOut>) => {
      const m = e.data;
      if ('error' in m) { error = m.error; console.error('grading stopped:', m.error); return; }
      if ('done' in m) { finish(); return; }
      rounds[m.i] = m.summary;
      onRound([...rounds]);
    };
    // the worker itself crashed (out of memory, failed to load): stop waiting, keep what was graded
    w.onerror = e => { e.preventDefault(); error = e.message || 'the grader crashed (the match may be too big for this browser)'; finish(); };
    w.onmessageerror = () => { error = 'a graded round could not be read back'; finish(); };
  });
  w.postMessage({ data, context, corrections: currentCorrections() } satisfies MatchWorkerIn);
  return { done, stop: () => w.terminate() };
}

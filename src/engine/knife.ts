// Kept apart from recap.ts: the store imports it, and the store is on every page (recap.ts pulls in the engine).
import type { DemoData } from './recap';

/**
 * FACEIT and other servers play a knife round first, for sides: every kill with a knife, then the real match starts
 * (often with the sides swapped). It isn't part of the match: drop it, so it's never graded or drawn as round 1.
 */
export function withoutKnifeRound(d: DemoData): DemoData {
  const r = d.rounds[0];
  const knife = !!r && r.kills.length > 0 && r.kills.every(k => /knife|bayonet|karambit|butterfly|dagger/i.test(k.weapon ?? ''));
  // the rounds after it are numbered from 1 again (the match's own round 1)
  return knife && d.rounds.length > 1 ? { ...d, rounds: d.rounds.slice(1).map(x => ({ ...x, n: x.n - 1 })) } : d;
}

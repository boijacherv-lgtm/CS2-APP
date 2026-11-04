/**
 * A player's match through the Deadlock engine (step 5): the 2-step search (search.ts) every 20 s they're alive, each
 * move graded Best … Blunder with the reasons in words, built from the search's own numbers (the fight's odds and who
 * was in it, the objective, what the enemy could do, what it cost), and an accuracy score like chess.com's, scaled so a
 * typical Phantom-and-up player's game is 90 (tools/dl-search.ts).
 */
import CAL from './generated/dlsearch.json';
import type { DlDemo } from './demo';
import type { DlMatch } from './match';
import { WINDOW, type Action } from './playNet';
import { searchAt, type DlOption, type DlSearch, type SearchClass } from './search';

const SCALE = (CAL as { accuracyScale?: number }).accuracyScale ?? 9;
/** chess.com's accuracy curve on the average win chance given up (points), scaled so a typical good game is 90. */
export const engineAccuracy = (avgLoss: number) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avgLoss * 100 * SCALE) - 3.1669));

const DID: Record<Action, string> = { fight: 'took the fight', objective: 'went for the objective', farm: 'farmed', lane: 'laned', base: 'went to base', move: 'moved around' };
const DO: Record<Action, string> = { fight: 'taking the fight', objective: 'going for the objective', farm: 'farming', lane: 'laning', base: 'going to base', move: 'moving' };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const odds = (p: number) => `${Math.round(p * 100)}%`;
const sides = (o: DlOption) => (o.sides ? `your ${o.sides[0]} against their ${o.sides[1]}` : 'the fight');
/** Where a fight was, when that explains the odds. */
const where = (o: DlOption) => (o.where === 'theirs' ? ' deep in their half' : o.where === 'ours' ? ' in your half' : '');

/** Why an option was worth what it was, in a sentence (from what the search assumed). */
function because(o: DlOption): string | null {
  if (o.reply === 'they jump you' && o.fight !== undefined) return `${o.sides?.[1] ?? 'Enemies'} of them were close enough to jump you${where(o)}: ${odds(o.fight)} for you if they did.`;
  if (o.action === 'fight' && o.fight !== undefined) return `${o.sides ? `Your ${o.sides[0]} against their ${o.sides[1]}` : 'The fight'}${where(o)}: ${odds(o.fight)} to win it.`;
  if (o.action === 'fight') return `They could back off${o.reply.includes('objective') ? ' and lose the objective there' : ''}.`;
  if (o.action === 'objective' && o.reply === 'it falls') return `${o.target ?? 'Their objective'} was right there with nobody defending it.`;
  if (o.action === 'objective' && o.reply === 'they defend it' && o.fight !== undefined) return `${o.target ?? 'The objective'} had defenders: ${sides(o)}, ${odds(o.fight)} for you with their objective shooting.`;
  if (o.action === 'objective' && o.reply.startsWith('not enough')) return `Not enough of you there to take ${o.target ?? 'it'} in time.`;
  if (o.action === 'base') return 'Going to base was safe, but earned next to nothing.';
  return null;
}

export interface EngineMove extends DlSearch {
  played: DlOption; cls: SearchClass;
  /** "Mistake: laned instead of taking the fight", and the reasons */ title: string; why: string[];
  /** the gap to the next best option (for a best move: how much better it was than the rest) */ margin: number;
}
export interface EngineReview {
  moves: EngineMove[]; accuracy: number; avgLoss: number;
  counts: Record<SearchClass, number>;
  /** the costliest moves (Inaccuracy and worse), costliest first; and the best calls (the best move, well clear of the rest) */
  worst: EngineMove[]; best: EngineMove[];
}

/** One graded move in words. */
export function explain(s: DlSearch & { played: DlOption; cls: SearchClass }): { title: string; why: string[] } {
  const top = s.options[0], mine = s.played;
  if (top.action === mine.action) {
    const next = s.options[1];
    return {
      title: `${s.cls}: ${DID[mine.action]}`,
      why: [because(mine), next ? `The next best, ${DO[next.action]}, was worth ${pct(mine.value - next.value)} less.` : 'Nothing else made sense from there.'].filter((x): x is string => !!x),
    };
  }
  return {
    title: `${s.cls}: ${DID[mine.action]} instead of ${DO[top.action]}`,
    why: [because(top), because(mine), `It gave up ${pct(s.loss)} win chance (${pct(top.value)} → ${pct(mine.value)}).`].filter((x): x is string => !!x),
  };
}

/** The player's match, every 20 s they're alive. */
export function engineReview(m: DlMatch, demo: DlDemo | null, slot: number): EngineReview {
  const moves: EngineMove[] = [];
  for (let t = 60; t + WINDOW <= m.duration; t += WINDOW) {
    const s = searchAt(m, demo, slot, t);
    if (!s?.played || !s.cls) continue;
    const g = s as DlSearch & { played: DlOption; cls: SearchClass };
    const margin = s.options[0].action === s.played.action ? s.played.value - (s.options[1]?.value ?? s.played.value) : -s.loss;
    moves.push({ ...g, ...explain(g), margin });
  }
  const counts = { Best: 0, Excellent: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 } as Record<SearchClass, number>;
  for (const x of moves) counts[x.cls]++;
  const avgLoss = moves.reduce((a, x) => a + x.loss, 0) / Math.max(1, moves.length);
  const bad = new Set<SearchClass>(['Inaccuracy', 'Mistake', 'Blunder']);
  const t1 = (CAL as { thresholds?: number[] }).thresholds?.[1] ?? 0.005;
  return {
    moves, avgLoss, counts, accuracy: moves.length ? engineAccuracy(avgLoss) : 0,
    worst: moves.filter(x => bad.has(x.cls)).sort((a, b) => b.loss - a.loss),
    // a best call: the best move by more than a Good move gives up
    best: moves.filter(x => x.cls === 'Best' && x.margin > t1).sort((a, b) => b.margin - a.margin),
  };
}

import { useMemo } from 'react';
import { evaluated, type DemoData, type EvalScope, type Move } from '../engine/recap';
import { useStore } from '../store';

/**
 * The one rule for which moves Review evaluates on screen (map letters, timeline, killfeed letters, move cards,
 * ◀ ▶): every move, or every move of the signed-in player. "Mine" needs you to be logged in with Steam and in this
 * match; otherwise it falls back to every move.
 */
export function shownRule(scope: EvalScope, me: string | null, data: DemoData | undefined) {
  const canMine = !!me && !!data && data.rounds.some(r => r.frames.players[me]);
  const mine = scope === 'mine' && canMine;
  return { shown: evaluated(mine ? 'mine' : 'all', me) as (m: Move) => boolean, mine, canMine };
}

export function useShown() {
  const scope = useStore(s => s.evalScope), me = useStore(s => s.me), data = useStore(s => s.review?.data);
  return useMemo(() => shownRule(scope, me, data), [scope, me, data]);
}

/** The same rule from outside React (keyboard shortcuts). */
export function shownNow() {
  const st = useStore.getState();
  return shownRule(st.evalScope, st.me, st.review?.data).shown;
}

import { useMemo } from 'react';
import { useProfile } from '../ui/profileApi';
import { steamId3 } from './api';
import { coachMatch, type DlMove } from './coach';
import { useDl } from './store';

/** Your player slot in the open match (logged in with Steam and you played in it), else null. */
export function useMySlot(): number | null {
  const me = useProfile(s => s.me?.steamId);
  const match = useDl(s => s.match);
  return useMemo(() => {
    if (!me || !match) return null;
    const acc = Number(steamId3(me));
    return match.players.find(p => p.account === acc)?.slot ?? null;
  }, [me, match]);
}

/** The open match graded (every death, kill and lane), and the moves shown: yours, or everyone's. */
export function useCoach(): { all: DlMove[]; shown: DlMove[]; mine: number | null; canMine: boolean } {
  const match = useDl(s => s.match), bench = useDl(s => s.bench), names = useDl(s => s.names), scope = useDl(s => s.scope), demo = useDl(s => s.demo);
  const mine = useMySlot();
  const all = useMemo(() => (match ? coachMatch(match, bench, names, demo) : []), [match, bench, names, demo]);
  const shown = useMemo(() => (scope === 'mine' && mine !== null ? all.filter(m => m.slot === mine) : all), [all, scope, mine]);
  return { all, shown, mine, canMine: mine !== null };
}

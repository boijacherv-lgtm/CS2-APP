import { useMemo } from 'react';
import { useProfile } from '../ui/profileApi';
import { steamId3 } from './api';
import { coachMatch, type D2Move } from './coach';
import { useD2 } from './store';

/** The open match graded, and the moves shown: yours (logged in with Steam and you played in it), or everyone's. */
export function useCoach(): { all: D2Move[]; shown: D2Move[]; mine: number | null; canMine: boolean } {
  const me = useProfile(s => s.me?.steamId);
  const match = useD2(s => s.match), scope = useD2(s => s.scope);
  const mine = useMemo(() => {
    if (!me || !match) return null;
    const acc = Number(steamId3(me));
    return match.players.find(p => p.account === acc)?.slot ?? null;
  }, [me, match]);
  const all = useMemo(() => (match ? coachMatch(match) : []), [match]);
  const shown = useMemo(() => (scope === 'mine' && mine !== null ? all.filter(m => m.slot === mine) : all), [all, scope, mine]);
  return { all, shown, mine, canMine: mine !== null };
}

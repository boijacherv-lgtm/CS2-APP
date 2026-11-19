import { useEffect, useMemo, useState } from 'react';
import { loadCorrections, type Corrections } from './disputes';
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
export function useCoach(): { all: DlMove[]; shown: DlMove[]; mine: number | null; canMine: boolean; focus: number | null } {
  const match = useDl(s => s.match), bench = useDl(s => s.bench), names = useDl(s => s.names), scope = useDl(s => s.scope), demo = useDl(s => s.demo), selected = useDl(s => s.selected);
  const mine = useMySlot();
  // the owner's rulings on disputed marks (once per visit)
  const [corr, setCorr] = useState<Corrections>({});
  useEffect(() => { loadCorrections().then(setCorr).catch(() => {}); }, []);
  const all = useMemo(() => (match ? coachMatch(match, bench, names, demo, corr) : []), [match, bench, names, demo, corr]);
  // whose cards: yours when you played, else the player picked on the board (one player's, not 130 for all 12)
  const focus = mine ?? selected;
  const shown = useMemo(() => (scope === 'mine' && focus !== null ? all.filter(m => m.slot === focus) : all), [all, scope, focus]);
  return { all, shown, mine, canMine: focus !== null, focus };
}

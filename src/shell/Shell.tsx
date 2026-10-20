import { useEffect } from 'react';
import { App as Cs2App } from '../App';
import type { RoundSummary } from '../engine/match';
import type { MatchWorkerIn, MatchWorkerOut } from '../engine/match.worker';
import { MatchReportPage } from '../ui/Report';
import { finishSteamLogin } from '../ui/steamApi';
import { Home } from '../site/Home';
import { NavBar } from '../site/Nav';
import { Pricing } from '../site/Pricing';
import { Profile } from '../site/Profile';
import { Settings } from '../site/Settings';
import '../site/site.css';
import { useStore, whoAmI } from '../store';
import { buildMatchReport } from '../engine/match';
import { profileMatchOf } from '../engine/habits';
import type { DemoData } from '../engine/recap';
import { recordMatch, refreshProfile, useProfile } from '../ui/profileApi';
import { useRoute } from './router';

export function Shell() {
  const route = useRoute();
  const setMode = useStore(s => s.setMode);

  // the URL decides the CS2 mode (so Back/Forward and bookmarks work); the report page has no board
  useEffect(() => { if (route.page === 'cs2' && route.mode !== 'report') setMode(route.mode); }, [route, setMode]);
  useMatchGrader();
  // a graded match you played in goes on your profile (also when you say "This is me" afterwards)
  const who = useStore(whoAmI), report = useStore(s => s.report);
  useEffect(() => { if (report?.done && !report.error) recordIfYours(report.data, report.rounds); }, [who, report?.done]); // eslint-disable-line react-hooks/exhaustive-deps
  // website: Steam just sent us back from its login page → finish the login (once)
  // after a Steam login comes back, learn who you are (your profile; Review can evaluate only your moves)
  useEffect(() => { finishSteamLogin().then(refreshProfile).catch(() => {}); }, []);
  const steamId = useProfile(s => s.me?.steamId ?? null);
  useEffect(() => { useStore.setState({ me: steamId }); }, [steamId]);

  return (
    <div className="shell">
      <NavBar route={route} />
      <main className="shell-main">
        {route.page === 'cs2' ? (route.mode === 'report' ? <MatchReportPage /> : <Cs2App />)
          : route.page === 'profile' ? <Profile /> : route.page === 'pricing' ? <Pricing /> : route.page === 'settings' ? <Settings /> : <Home />}
      </main>
    </div>
  );
}

/** Grades every round of the loaded match in a worker, so the report fills in while you watch. */
function useMatchGrader() {
  const data = useStore(s => s.review?.data);
  useEffect(() => {
    if (!data) return;
    const rounds: (RoundSummary | null)[] = Array(data.rounds.length).fill(null);
    useStore.setState({ report: { data, rounds: [...rounds], done: false } });
    const w = new Worker(new URL('../engine/match.worker.ts', import.meta.url), { type: 'module' });
    let error: string | undefined;
    const finish = () => {
      useStore.setState({ report: { data, rounds: [...rounds], done: true, ...(error ? { error } : {}) } });
      w.terminate();
    };
    w.onmessage = (e: MessageEvent<MatchWorkerOut>) => {
      const m = e.data;
      if ('error' in m) { error = m.error; console.error('grading stopped:', m.error); return; }
      if ('done' in m) { finish(); return; }
      rounds[m.i] = m.summary;
      useStore.setState({ report: { data, rounds: [...rounds], done: false } });
    };
    // the worker itself crashed (out of memory, failed to load): stop waiting, keep what was graded
    w.onerror = e => { e.preventDefault(); error = e.message || 'the grader crashed (the match may be too big for this browser)'; finish(); };
    w.onmessageerror = () => { error = 'a graded round could not be read back'; finish(); };
    w.postMessage({ data, context: useStore.getState().board.context } satisfies MatchWorkerIn);
    return () => w.terminate();
  }, [data]);
}

/** A match you played in goes on your profile once it's graded (you: Steam login, or "This is me"). */
function recordIfYours(data: DemoData, rounds: (RoundSummary | null)[]) {
  const me = whoAmI(useStore.getState());
  if (!me || !data.rounds.some(r => r.frames.players[me])) return;
  try {
    const view = buildMatchReport(data, rounds);
    const p = view.players.find(x => x.id === me);
    if (p?.played) recordMatch(profileMatchOf(data, view, p, rounds.map(r => r?.analyst))).catch(() => {});
  } catch (e) { console.warn('could not add the match to your profile', e); }
}

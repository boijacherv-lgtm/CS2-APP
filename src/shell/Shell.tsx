import { useEffect } from 'react';
import { App as Cs2App } from '../App';
import type { RoundSummary } from '../engine/match';
import { MatchReportPage } from '../ui/Report';
import { finishSteamLogin } from '../ui/steamApi';
import { gradeMatch } from '../ui/gradeMatch';
import { Home } from '../site/Home';
import { NavBar } from '../site/Nav';
import { Pricing } from '../site/Pricing';
import { Profile } from '../site/Profile';
import { Settings } from '../site/Settings';
import { Deadlock } from '../site/Deadlock';
import { Dev } from '../site/Dev';
import '../site/site.css';
import { Tours } from '../ui/Tour';
import { DlReview } from '../deadlock/DlReview';
import { DlReport } from '../deadlock/DlReport';
import { DlTactical } from '../deadlock/DlTactical';
import { useStore, whoAmI } from '../store';
import { buildMatchReport } from '../engine/match';
import { profileMatchOf } from '../engine/habits';
import type { DemoData } from '../engine/recap';
import { recordMatch, refreshProfile, useProfile } from '../ui/profileApi';
import { useRoute, type Route } from './router';
import { applyGame, themeOf } from '../ui/tokens';

export function Shell() {
  const route = useRoute();
  // the site wears the colours of the game you're in
  useEffect(() => { applyGame(themeOf(route.page)); }, [route.page]);
  // each page its own tab title (browser history, bookmarks, search results)
  useEffect(() => { document.title = pageTitle(route); }, [route]);
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
          : route.page === 'profile' ? <Profile /> : route.page === 'pricing' ? <Pricing /> : route.page === 'settings' ? <Settings /> : route.page === 'dev' ? <Dev /> : route.page === 'deadlock' ? (route.mode === 'review' ? <DlReview /> : route.mode === 'report' ? <DlReport /> : route.mode === 'tactical' ? <DlTactical /> : <Deadlock />) : <Home />}
      </main>
      <Tours />
    </div>
  );
}

/** Grades every round of the loaded match in a worker, so the report fills in while you watch. */
function useMatchGrader() {
  const data = useStore(s => s.review?.data);
  useEffect(() => {
    if (!data) return;
    useStore.setState({ report: { data, rounds: Array(data.rounds.length).fill(null), done: false } });
    const g = gradeMatch(data, useStore.getState().board.context, rounds => useStore.setState({ report: { data, rounds, done: false } }));
    g.done.then(({ rounds, error }) => useStore.setState({ report: { data, rounds, done: true, ...(error ? { error } : {}) } }));
    return () => g.stop();
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

const MODE_TITLE = { tactical: 'Plan', review: 'Review a match', report: 'Match recap', home: 'Coach' } as const;
const PAGE_TITLE: Record<string, string> = { profile: 'Profile', pricing: 'Pricing', settings: 'Settings', dev: 'Dev' };
export function pageTitle(r: Route): string {
  if (r.page === 'cs2') return `CS2 ${MODE_TITLE[r.mode]} · RageView`;
  if (r.page === 'deadlock') return `Deadlock ${MODE_TITLE[r.mode]} · RageView`;
  return r.page === 'home' ? 'RageView: prove you were right' : `${PAGE_TITLE[r.page] ?? r.page} · RageView`;
}

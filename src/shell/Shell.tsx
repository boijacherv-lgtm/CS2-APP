import { useEffect, useState } from 'react';
import { App as Cs2App } from '../App';
import type { RoundSummary } from '../engine/match';
import { MatchReportPage } from '../ui/Report';
import { finishSteamLogin } from '../ui/steamApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { Icon } from '../ui/Icon';
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
import { saveMoments } from '../moments/moments';
import { MomentsPage, SharedMoment } from '../moments/MomentsPage';
import { Changelog, Privacy } from '../site/InfoPages';
import { Cs2Home } from '../site/Cs2Home';
import { cs2Moments } from '../moments/build';
import type { DemoData } from '../engine/recap';
import { recordMatch, refreshProfile, useProfile } from '../ui/profileApi';
import { routeHref, useRoute, type Route } from './router';
import { applyGame, themeOf } from '../ui/tokens';

export function Shell() {
  const route = useRoute();
  // the site wears the colours of the game you're in
  // a shared moment dresses itself in its own game's colours (SharedMoment)
  useEffect(() => { if (route.page !== 'moment') applyGame(themeOf(route.page)); }, [route.page]);
  // a new page starts at its top (the page scrolls inside .shell-main, which stays mounted between pages)
  const where = routeHref(route);
  useEffect(() => { document.querySelector('.shell-main')?.scrollTo(0, 0); window.scrollTo(0, 0); }, [where]);
  // each page its own tab title (browser history, bookmarks, search results)
  useEffect(() => { document.title = pageTitle(route); }, [route]);
  const setMode = useStore(s => s.setMode);

  // the URL decides the CS2 mode (so Back/Forward and bookmarks work); the report page has no board
  useEffect(() => { if (route.page === 'cs2' && route.mode !== 'report' && route.mode !== 'home') setMode(route.mode); }, [route, setMode]);
  useMatchGrader();
  // a graded match you played in goes on your profile (also when you say "This is me" afterwards)
  const who = useStore(whoAmI), report = useStore(s => s.report);
  useEffect(() => { if (report?.done && !report.error) recordIfYours(report.data, report.rounds); }, [who, report?.done]); // eslint-disable-line react-hooks/exhaustive-deps
  // website: Steam just sent us back from its login page → finish the login (once)
  // after a Steam login comes back, learn who you are (your profile; Review can evaluate only your moves)
  // a sign-in that came back from Steam but didn't finish says so (it used to fail silently)
  const [loginFailed, setLoginFailed] = useState(false);
  useEffect(() => { finishSteamLogin().then(refreshProfile).catch(() => setLoginFailed(true)); }, []);
  const steamId = useProfile(s => s.me?.steamId ?? null);
  useEffect(() => { useStore.setState({ me: steamId }); }, [steamId]);

  return (
    <div className="shell">
      <NavBar route={route} />
      <main className="shell-main">
        {loginFailed && <div className="login-failed" role="alert"><span>Steam login didn't finish. Try again.</span><SteamLoginButton compact /><button className="ghost" aria-label="Dismiss" onClick={() => setLoginFailed(false)}><Icon name="close" size={14} /></button></div>}
        {route.page === 'cs2' ? (route.mode === 'report' ? <MatchReportPage /> : route.mode === 'home' ? <Cs2Home /> : <Cs2App />)
          : route.page === 'profile' ? <Profile /> : route.page === 'pricing' ? <Pricing /> : route.page === 'settings' ? <Settings /> : route.page === 'dev' ? <Dev /> : route.page === 'puzzles' ? <MomentsPage /> : route.page === 'missing' ? <NotFound /> : route.page === 'privacy' ? <Privacy /> : route.page === 'changelog' ? <Changelog /> : route.page === 'moment' ? <SharedMoment code={route.code} /> : route.page === 'deadlock' ? (route.mode === 'review' ? <DlReview /> : route.mode === 'report' ? <DlReport /> : route.mode === 'tactical' ? <DlTactical /> : <Deadlock />) : <Home />}
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
    // your moments: puzzles, the mistake reel and the next-match focus
    if (p?.played) saveMoments(cs2Moments(data, rounds, me));
  } catch (e) { console.warn('could not add the match to your profile', e); }
}

const MODE_TITLE = { tactical: 'Tactical Board', review: 'Review a match', report: 'Match recap', home: 'Coach' } as const;
const PAGE_TITLE: Record<string, string> = { missing: 'Page not found', privacy: 'Privacy', changelog: 'What\'s new', profile: 'Profile', pricing: 'Pricing', settings: 'Settings', dev: 'Dev', puzzles: 'Puzzles', moment: 'A shared moment' };
export function pageTitle(r: Route): string {
  if (r.page === 'cs2') return r.mode === 'review' ? 'CS2 Demo Review · RageView' : `CS2 ${MODE_TITLE[r.mode]} · RageView`;
  if (r.page === 'deadlock') return r.mode === 'review' ? 'Deadlock Match Review · RageView' : r.mode === 'tactical' ? 'Deadlock Meta & Builds · RageView' : `Deadlock ${MODE_TITLE[r.mode]} · RageView`;
  return r.page === 'home' ? 'RageView: Free CS2 & Deadlock Match Review' : `${PAGE_TITLE[r.page] ?? r.page} · RageView`;
}

/** An address that isn't a page. */
function NotFound() {
  return (
    <div className="page not-found">
      <h1>Whiffed.</h1>
      <p className="muted">This page doesn't exist.</p>
      <p><a className="cta primary" href="/">Back to home</a></p>
    </div>
  );
}

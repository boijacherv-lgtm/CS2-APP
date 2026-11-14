import { GUIDES } from '../site/guideList';
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { reportError, reportGradingTime } from '../ui/telemetry';
import { useSiteConfig } from '../ui/siteConfig';
import type { RoundSummary } from '../engine/match';
import { finishSteamLogin } from '../ui/steamApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { Icon } from '../ui/Icon';
import { gradeMatch } from '../ui/gradeMatch';
import { Home } from '../site/Home';
import { NavBar } from '../site/Nav';
import { Pricing } from '../site/Pricing';
import { Deadlock } from '../site/Deadlock';
import '../site/site.css';
import { Hints } from '../ui/Hints';
import { useStore, whoAmI } from '../store';
import { Changelog, Guides, Privacy } from '../site/InfoPages';
import { Cs2Home } from '../site/Cs2Home';
import { MissArt } from '../ui/Art';
import type { DemoData } from '../engine/recap';
import { recordMatch, refreshProfile, useProfile } from '../ui/profileApi';
import { routeHref, useRoute, type Route } from './router';
import { applyGame, themeOf } from '../ui/tokens';

// each big page is its own download, fetched when you open it (the front page doesn't carry the replay and the engine)
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, k: K) => lazy(() => load().then(m => ({ default: m[k] }), reloadIfStale));
/**
 * A page's file missing: a new version of the site went up since this tab opened (each version names its files anew).
 * The tab reloads once to get the new version; a second failure within a minute is a real error (shown by PageGuard).
 */
function reloadIfStale(e: unknown): never {
  const KEY = 'rv.staleReload';
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY) ?? 0); } catch { /* private mode */ }
  if (Date.now() - last > 60_000) {
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ }
    location.reload();
  }
  throw e;
}
const Cs2App = named(() => import('../App'), 'App');
const MatchReportPage = named(() => import('../ui/Report'), 'MatchReportPage');
const Dev = named(() => import('../site/Dev'), 'Dev');
const DlReview = named(() => import('../deadlock/DlReview'), 'DlReview');
const DlReport = named(() => import('../deadlock/DlReport'), 'DlReport');
const DlTactical = named(() => import('../deadlock/DlTactical'), 'DlTactical');
const MomentsPage = named(() => import('../moments/MomentsPage'), 'MomentsPage');
const SharedMoment = named(() => import('../moments/MomentsPage'), 'SharedMoment');
const Profile = named(() => import('../site/Profile'), 'Profile');
const Settings = named(() => import('../site/Settings'), 'Settings');

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

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
  // /dev: the owner (or a local copy) only; for anyone else it's an address that doesn't exist, and its code never loads
  const devOk = useProfile(s => (LOCAL || s.me?.owner ? true : s.loaded ? false : null));
  useEffect(() => { useStore.setState({ me: steamId }); }, [steamId]);
  // pages the dev page took down for a moment (Content → maintenance); the owner still sees them
  const maintenance = useSiteConfig().maintenance, owner = useProfile(s => !!s.me?.owner);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <NavBar route={route} />
      <main className="shell-main" id="main" tabIndex={-1}>
        {loginFailed && <div className="login-failed" role="alert"><span>Steam login didn't finish. Try again.</span><SteamLoginButton compact /><button className="ghost" aria-label="Dismiss" onClick={() => setLoginFailed(false)}><Icon name="close" size={14} /></button></div>}
        <SiteBanner />
        <PageGuard key={routeHref(route)}><Suspense fallback={<div className="page" aria-busy="true" />}>
        {maintenance.includes(route.page) && !owner ? <BackSoon />
          : route.page === 'cs2' ? (route.mode === 'report' ? <MatchReportPage /> : route.mode === 'home' ? <Cs2Home /> : <Cs2App />)
          : route.page === 'profile' ? <Profile /> : route.page === 'pricing' ? <Pricing /> : route.page === 'settings' ? <Settings /> : route.page === 'dev' ? (devOk ? <Dev /> : devOk === null ? <div className="page" aria-busy="true" /> : <NotFound />) : route.page === 'puzzles' ? <MomentsPage /> : route.page === 'missing' ? <NotFound /> : route.page === 'privacy' ? <Privacy /> : route.page === 'changelog' ? <Changelog /> : route.page === 'guides' ? <Guides guide={'guide' in route ? route.guide : undefined} /> : route.page === 'moment' ? <SharedMoment code={route.code} /> : route.page === 'deadlock' ? (route.mode === 'review' ? <DlReview /> : route.mode === 'report' ? <DlReport /> : route.mode === 'tactical' ? <DlTactical /> : <Deadlock />) : <Home />}
        </Suspense></PageGuard>
      </main>
      <Hints />
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
    const started = performance.now();
    g.done.then(({ rounds, error }) => { useStore.setState({ report: { data, rounds, done: true, ...(error ? { error } : {}) } }); if (!error) reportGradingTime(performance.now() - started, rounds); });
    return () => g.stop();
  }, [data]);
}

/** A match you played in goes on your profile once it's graded (you: Steam login, or "This is me"). */
async function recordIfYours(data: DemoData, rounds: (RoundSummary | null)[]) {
  const me = whoAmI(useStore.getState());
  if (!me || !data.rounds.some(r => r.frames.players[me])) return;
  try {
    const [{ buildMatchReport }, { profileMatchOf }, { saveMoments }, { cs2Moments }] = await Promise.all([
      import('../engine/match'), import('../engine/habits'), import('../moments/moments'), import('../moments/build')]);
    const view = buildMatchReport(data, rounds);
    const p = view.players.find(x => x.id === me);
    if (p?.played) recordMatch(profileMatchOf(data, view, p, rounds.map(r => r?.analyst))).catch(() => {});
    // your moments: puzzles, the mistake reel and the next-match focus
    if (p?.played) saveMoments(cs2Moments(data, rounds, me));
  } catch (e) { console.warn('could not add the match to your profile', e); }
}

const MODE_TITLE = { tactical: 'Tactical Board', review: 'Review a match', report: 'Match recap', home: 'Coach' } as const;
const PAGE_TITLE: Record<string, string> = { missing: 'Page not found', privacy: 'Privacy', changelog: 'What\'s new', profile: 'Profile', pricing: 'Pricing', settings: 'Settings', dev: 'Page not found', puzzles: 'Puzzles', guides: 'Guides', moment: 'A shared moment' };
export function pageTitle(r: Route): string {
  // the public pages: the same titles as their static copies (tools/spa-pages.mjs META)
  if (r.page === 'cs2') return r.mode === 'home' ? 'CS2 demo review: every round graded S+ to F · RageView' : r.mode === 'review' ? 'CS2 Demo Review · RageView' : `CS2 ${MODE_TITLE[r.mode]} · RageView`;
  if (r.page === 'deadlock') return r.mode === 'home' ? 'Deadlock match review by match ID: every fight graded · RageView' : r.mode === 'review' ? 'Deadlock Match Review · RageView'
    : r.mode === 'tactical' ? 'Deadlock meta & builds this patch, by position · RageView' : `Deadlock ${MODE_TITLE[r.mode]} · RageView`;
  if (r.page === 'guides' && 'guide' in r) return GUIDES.find(g => g.slug === r.guide)?.title ?? 'Guides · RageView';
  if (r.page === 'puzzles') return 'CS2 & Deadlock puzzles: find the best play · RageView';
  if (r.page === 'pricing') return 'RageView pricing: free, Pro free in early access';
  return r.page === 'home' ? 'RageView — Free CS2 & Deadlock match review, every play graded' : `${PAGE_TITLE[r.page] ?? r.page} · RageView`;
}

/** An address that isn't a page. */
/** The dev page's announcement (Content → banner): until its date, closable for this visit. */
function SiteBanner() {
  const b = useSiteConfig().banner;
  const [closed, setClosed] = useState(false);
  if (!b.on || !b.text || closed || (b.until && Date.now() > b.until)) return null;
  return (
    <div className="site-banner" role="status">
      <span>{b.text}</span>{b.link && <a href={b.link}>More</a>}
      <button className="ghost" aria-label="Dismiss" onClick={() => setClosed(true)}><Icon name="close" size={14} /></button>
    </div>
  );
}

/** A page the dev page took down for a moment. */
function BackSoon() {
  return <div className="page not-found"><h1>Back in a moment.</h1><p className="muted">This page is being worked on. Everything else works.</p><p><a className="cta primary" href="/">Back to home</a></p></div>;
}

function NotFound() {
  return (
    <div className="page not-found">
      <MissArt />
      <h1>Whiffed.</h1>
      <p className="muted">This page doesn't exist.</p>
      <p><a className="cta primary" href="/">Back to home</a></p>
    </div>
  );
}

/** One page crashing shows a message there; the nav and the rest of the site keep working. */
class PageGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error(e); reportError(e instanceof Error ? e.message : String(e)); }
  render() {
    return this.state.failed
      ? <div className="page not-found"><h1>This page broke.</h1><p className="muted">Something went wrong showing it. Reload, or go back home.</p><p><a className="cta" href="/">Back to home</a></p></div>
      : this.props.children;
  }
}

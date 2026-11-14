import { useEffect, useRef, useState } from 'react';
import { proEarlyAccess } from '../ui/siteConfig';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { navigate, routeHref, type Route } from '../shell/router';
import { STEAM_AVAILABLE } from '../env';
import { GAMES } from './games';
import { GameMark } from './gameMarks';

import { useStore } from '../store';
import { MAPS } from '../map/catalog';
import { Icon } from '../ui/Icon';
import { refreshProfile, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { steamSignOut } from '../ui/steamApi';
import { useDl } from '../deadlock/store';
import { gameOf } from '../ui/tokens';

type KitGame = 'cs2' | 'deadlock';
/**
 * The game kit's places. Browsing: Overview · Review · <the game's own tab> · Puzzles. Inside an open match: Review ·
 * Recap · the match tab. The 4th tab is the game's: CS2's Tactical board, Deadlock's Meta & builds.
 */
type Place = 'overview' | 'review' | 'recap' | 'tab' | 'puzzles';
const GAME_TAB: Record<KitGame, { label: string; icon: 'grid' | 'stats'; href: string; tip: string }> = {
  cs2: { label: 'Tactical', icon: 'grid', href: '/cs2/tactical', tip: 'Tactical board: place players, utility and routes, then play the round out' },
  deadlock: { label: 'Meta', icon: 'stats', href: '/deadlock/meta', tip: 'Meta & builds: heroes this patch by position, builds, draft and macro planners' },
};
const HREF: Record<KitGame, Record<Place, string>> = {
  cs2: { overview: '/cs2', review: '/cs2/review', recap: '/cs2/report', tab: GAME_TAB.cs2.href, puzzles: '/puzzles' },
  deadlock: { overview: '/deadlock', review: '/deadlock/review', recap: '/deadlock/report', tab: GAME_TAB.deadlock.href, puzzles: '/puzzles' },
};

/** The bar on every page: the brand, every game, the game's places (or the open match's), Profile and your account. */
export function NavBar({ route }: { route: Route }) {
  const loaded = useStore(s => s.review), report = useStore(s => s.report);
  const exitReview = useStore(s => s.exitReview);
  const dlMatch = useDl(s => s.match), dlClose = useDl(s => s.close);
  const me = useProfile(s => s.me);
  const cs2 = route.page === 'cs2';
  // the CS2 Tactical board and an open match share the board: with a match open, its address goes to Review
  useEffect(() => {
    if (cs2 && loaded && route.mode === 'tactical') navigate({ page: 'cs2', mode: 'review' });
  }, [cs2, loaded, route]); // eslint-disable-line react-hooks/exhaustive-deps
  // who's logged in, again whenever you come back to the tab (a login in another tab, a session that ran out)
  useEffect(() => {
    const again = () => { refreshProfile(); };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  // the game the bar is about: the page's, else the one you were last in (puzzles open on it too)
  const game: KitGame = route.page === 'cs2' || route.page === 'deadlock' ? route.page : gameOf('profile');
  const here: Place | null = route.page === 'puzzles' ? 'puzzles'
    : route.page === 'cs2' || route.page === 'deadlock'
      ? (route.mode === 'home' ? 'overview' : route.mode === 'review' ? 'review' : route.mode === 'report' ? 'recap' : 'tab')
      : null;
  // inside a match: this game has one open, and you're on the game's pages
  const open = game === 'cs2' ? !!loaded : !!dlMatch;
  const inMatch = open && (route.page === 'cs2' || route.page === 'deadlock');
  const places: Place[] = inMatch ? ['review', 'recap'] : ['overview', 'review', 'tab', 'puzzles'];
  const label: Record<Place, string> = { overview: 'Overview', review: 'Review', recap: 'Recap', tab: GAME_TAB[game].label, puzzles: 'Puzzles' };
  const icon = { overview: 'info', review: 'play', recap: 'star', tab: GAME_TAB[game].icon, puzzles: 'target' } as const;
  const tip: Record<Place, string> = {
    overview: `What RageView does for ${GAMES.find(g => g.id === game)?.name}`, review: open ? 'Replay this match with the coach' : 'Load a match to replay it with the coach',
    recap: 'The match report: grades, the coach, the scoreboard', tab: GAME_TAB[game].tip, puzzles: `${GAMES.find(g => g.id === game)?.name} puzzles`,
  };
  // CS2's recap fills in while the rounds are graded: a ring with how far, then "ready" once
  const grading = game === 'cs2' && loaded && report && !report.done ? { done: report.rounds.filter(Boolean).length, of: report.rounds.length } : null;
  const ready = useRecapReady(game === 'cs2' && !!loaded && !!report?.done, route.page === 'cs2' && route.mode === 'report');
  return (
    <header className="navbar">
      <a className="brand" href="/" aria-label={`${APP_NAME} home`}><LogoMark /><span>{APP_NAME}</span></a>
      <GameRow game={game} active={here !== null} />
      {/* on the pages that belong to no game (home, guides, pricing, settings …) the game's tabs are hidden: none would be lit */}
      {here !== null && <nav className="modes" aria-label={`${GAMES.find(g => g.id === game)?.name}`}>
        {places.map(p => (
          <a key={p} href={HREF[game][p]} aria-current={here === p ? 'page' : undefined} className={`${here === p ? 'on' : ''} ${p === 'recap' && ready.pulse ? 'pulse' : ''}`} title={tip[p]}
            onClick={() => { if (p === 'puzzles') { try { localStorage.setItem('stratboard.game', game); } catch { /* private mode */ } } }}>
            <Icon name={icon[p]} className="mode-ico" /> <span className="mode-label">{label[p]}</span>
            {p === 'review' && open && !inMatch ? <i className="dot-live" title="A match is open" /> : null}
            {p === 'recap' && grading && <ProgressRing done={grading.done} of={grading.of} />}
          </a>
        ))}
      </nav>}
      {/* the open matches, like browser tabs: back to one, or × to close it */}
      {loaded && (
        <span className={`match-tab ${cs2 ? '' : 'away'}`} title={`Open CS2 match: ${MAPS.find(m => m.id === loaded.data.map)?.name ?? loaded.data.map}, ${loaded.data.rounds.length} rounds`}>
          <a href="/cs2/review"><Icon name="map" size={14} /><b>{MAPS.find(m => m.id === loaded.data.map)?.name ?? loaded.data.map}</b></a>
          <button className="match-tab-x" onClick={exitReview} aria-label="Close the CS2 match" title="Close this match"><Icon name="close" size={13} /></button>
        </span>
      )}
      {dlMatch && (
        <span className={`match-tab ${route.page === 'deadlock' ? '' : 'away'}`} title={`Open Deadlock match ${dlMatch.id}`}>
          <a href="/deadlock/review"><Icon name="map" size={14} /><b>Match {dlMatch.id}</b></a>
          <button className="match-tab-x" onClick={dlClose} aria-label="Close the Deadlock match" title="Close this match"><Icon name="close" size={13} /></button>
        </span>
      )}
      <div className="nav-right">
        {/* logged out there is no account menu: this one (Profile, Pricing, Settings, tips) shows at every width */}
        <details className={`nav-menu ${me ? '' : 'always'}`} key={routeHref(route)}>
          <summary aria-label="Menu"><Icon name="menu" size={18} /></summary>
          <div className="account-pop" role="menu">
            <a role="menuitem" href="/profile"><Icon name="user" size={16} /> Profile</a>
            <a role="menuitem" href="/pricing"><Icon name="coins" size={16} /> Pricing</a>
            <a role="menuitem" href="/settings"><Icon name="gear" size={16} /> Settings</a>
            <button role="menuitem" className="ghost" onClick={() => dispatchEvent(new Event('rv:hints'))}><Icon name="info" size={16} /> Tips &amp; shortcuts</button>
          </div>
        </details>
        <AccountMenu route={route} />
      </div>
      {ready.toast && (
        <div className="hint-card recap-toast" role="status">
          <span><b>Your recap is ready.</b></span>
          <a className="cta primary small-btn" href="/cs2/report" onClick={ready.close}>Open</a>
          <button className="ghost small-btn" onClick={ready.close}>Later</button>
        </div>
      )}
    </header>
  );
}

/** "21/30": how much of the recap is graded, as a small ring. */
function ProgressRing({ done, of }: { done: number; of: number }) {
  const share = of ? done / of : 0;
  return (
    <span className="nav-ring" title={`Grading the rounds: ${done} of ${of}`} aria-label={`${done} of ${of} rounds graded`}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden><circle cx="10" cy="10" r="8" className="nav-ring-track" /><circle cx="10" cy="10" r="8" className="nav-ring-fill" pathLength={1} strokeDasharray={`${share} 1`} transform="rotate(-90 10 10)" /></svg>
      <span className="num">{done}/{of}</span>
    </span>
  );
}

/** The moment the recap is ready (grading just finished): the Recap tab pulses once and a toast offers to open it. */
function useRecapReady(done: boolean, onRecap: boolean) {
  const [was, setWas] = useState(done);
  const [toast, setToast] = useState(false), [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (done && !was && !onRecap) { setToast(true); setPulse(true); setTimeout(() => setPulse(false), 1200); }
    if (!done) setToast(false);
    setWas(done);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (onRecap) setToast(false); }, [onRecap]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(false), 12000); return () => clearTimeout(t); }, [toast]);
  return { toast, pulse, close: () => setToast(false) };
}

/** Every game, by its icon and full name: the live ones as links (switching keeps your place), the coming ones greyed. */
function GameRow({ game, active }: { game: KitGame; active: boolean }) {
  const path = typeof location !== 'undefined' ? location.pathname : '';
  const same = (to: KitGame) => {
    const place = (Object.keys(HREF[game]) as Place[]).find(p => HREF[game][p] === path && p !== 'puzzles' && p !== 'tab');
    return place ? HREF[to][place] : HREF[to].overview;
  };
  return (
    <nav className="game-row" aria-label="Games">
      {GAMES.filter(x => x.review || x.id === 'dota2').map(x => x.review
        ? <a key={x.id} href={same(x.id as KitGame)} className={`game-pill ${x.id === game && active ? 'on' : ''}`} aria-current={x.id === game && active ? 'page' : undefined}>
            <GameMark game={x} size={20} muted={x.id !== game} /><span>{x.name}</span></a>
        : <span key={x.id} className="game-pill soon" aria-disabled="true" title={`${x.name}: coming`}><GameMark game={x} size={20} muted /><span>{x.name}</span><em>soon</em></span>)}
    </nav>
  );
}

/** Your avatar with Profile, Settings and Sign out; or Log in with Steam. */
function AccountMenu({ route }: { route: Route }) {
  const me = useProfile(s => s.me);
  const menu = useRef<HTMLDetailsElement>(null);
  // a pick closes the menu
  useEffect(() => { if (menu.current) menu.current.open = false; }, [route]);
  if (me === undefined && STEAM_AVAILABLE) return <span className="account-wait" />;
  if (!me) return (
    <div className="account">
      <a className={`nav-link nav-wide ${route.page === 'profile' ? 'on' : ''}`} href="/profile" aria-label="Profile"><Icon name="user" size={16} /> <span>Profile</span></a>
      {STEAM_AVAILABLE && <SteamLoginButton compact />}
    </div>
  );
  const signOut = async () => { await steamSignOut(); useStore.setState({ me: null }); await refreshProfile(); };
  return (
    <details className="account-menu" ref={menu}>
      <summary title="Your account">
        {me.avatar ? <img src={me.avatar} alt="" width={28} height={28} /> : <Icon name="user" size={22} />}
        <span className="account-name">{me.name ?? 'You'}</span>
        {proEarlyAccess() && <span className="pro-badge" title="Pro is free during early access">PRO</span>}
        <Icon name="chevronDown" size={12} />
      </summary>
      <div className="account-pop" role="menu">
        <a role="menuitem" href="/profile"><Icon name="user" size={16} /> Profile</a>
        <a role="menuitem" href="/settings"><Icon name="gear" size={16} /> Settings</a>
        <a role="menuitem" href="/pricing"><Icon name="coins" size={16} /> Pricing</a>
        <button role="menuitem" className="ghost" onClick={() => dispatchEvent(new Event('rv:hints'))}><Icon name="info" size={16} /> Tips &amp; shortcuts</button>
        {me.owner && <a role="menuitem" href="/dev"><Icon name="stats" size={16} /> Dev</a>}
        <a role="menuitem" href={`https://steamcommunity.com/profiles/${me.steamId}`} target="_blank" rel="noreferrer"><Icon name="arrowRight" size={16} /> Steam profile</a>
        <button role="menuitem" className="ghost" onClick={signOut}><Icon name="signOut" size={16} /> Sign out</button>
      </div>
    </details>
  );
}

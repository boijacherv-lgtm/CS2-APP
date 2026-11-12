import { useEffect, useRef } from 'react';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { navigate, routeHref, type Route } from '../shell/router';
import { STEAM_AVAILABLE } from '../env';
import { GAMES } from './games';
import { GameMark } from './gameMarks';
import { hasPro } from '../engine/profile';
import { useStore } from '../store';
import { MAPS } from '../map/catalog';
import { Icon } from '../ui/Icon';
import { refreshProfile, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { steamSignOut } from '../ui/steamApi';
import { useDl } from '../deadlock/store';
import { gameOf } from '../ui/tokens';

type KitGame = 'cs2' | 'deadlock';
/** The 5 places every game has, in the same order with the same names (spec: the game kit). */
const PLACES = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'review', label: 'Review', icon: 'play' },
  { id: 'recap', label: 'Recap', icon: 'star' },
  { id: 'meta', label: 'Meta', icon: 'stats' },
  { id: 'puzzles', label: 'Puzzles', icon: 'target' },
] as const;
type Place = (typeof PLACES)[number]['id'];
/** Where each place is for a game. */
const HREF: Record<KitGame, Record<Place, string>> = {
  cs2: { overview: '/cs2', review: '/cs2/review', recap: '/cs2/report', meta: '/cs2/tactical', puzzles: '/puzzles' },
  deadlock: { overview: '/deadlock', review: '/deadlock/review', recap: '/deadlock/report', meta: '/deadlock/meta', puzzles: '/puzzles' },
};
/** What Meta is in each game. */
const META_TIP: Record<KitGame, string> = { cs2: 'Tactical board: plan rounds with players, grenades and fights', deadlock: 'Meta & builds: heroes, builds, a draft and a macro planner for this patch' };

/** The bar on every page: the brand, the game switcher, the game's 5 places, the open match, Profile and your account. */
export function NavBar({ route }: { route: Route }) {
  const loaded = useStore(s => s.review);
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
      ? (route.mode === 'home' ? 'overview' : route.mode === 'review' ? 'review' : route.mode === 'report' ? 'recap' : 'meta')
      : null;
  const open = game === 'cs2' ? !!loaded : !!dlMatch;
  const tip = (p: Place) => p === 'meta' ? (game === 'cs2' && loaded ? 'Close the open match to plan on the Tactical board' : META_TIP[game])
    : p === 'recap' ? (open ? 'The match report: grades, the coach, the scoreboard' : 'Opens after you review a match')
    : p === 'review' ? (open ? 'Replay this match with the coach' : 'Load a match to replay it with the coach')
    : p === 'overview' ? `What RageView does for ${GAMES.find(g => g.id === game)?.name}` : `${GAMES.find(g => g.id === game)?.name} puzzles`;
  return (
    <header className="navbar">
      <a className="brand" href="/" aria-label={`${APP_NAME} home`}><LogoMark /><span>{APP_NAME}</span></a>
      <GameSwitch game={game} active={here !== null} />
      <nav className="modes" aria-label={`${GAMES.find(g => g.id === game)?.name}`}>
        {PLACES.map(p => {
          const off = p.id === 'meta' && game === 'cs2' && !!loaded;
          return off
            ? <span key={p.id} className="mode-off" title={tip(p.id)} aria-disabled="true"><Icon name={p.icon} className="mode-ico" /> <span className="mode-label">{p.label}</span></span>
            : <a key={p.id} href={HREF[game][p.id]} aria-current={here === p.id ? 'page' : undefined} className={here === p.id ? 'on' : ''} title={tip(p.id)}
                onClick={() => { if (p.id === 'puzzles') { try { localStorage.setItem('stratboard.game', game); } catch { /* private mode */ } } }}>
                <Icon name={p.icon} className="mode-ico" /> <span className="mode-label">{p.label}</span>{p.id === 'review' && open ? <i className="dot-live" title="A match is open" /> : null}
              </a>;
        })}
      </nav>
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
        {/* phones: the page links in a labelled menu */}
        <button className="nav-help" onClick={() => dispatchEvent(new Event('rv:hints'))} aria-label="Shortcuts and hints" title="Shortcuts and hints (?)">?</button>
        {/* logged out there is no account menu: this one (Profile, Pricing, Settings) shows at every width */}
        <details className={`nav-menu ${me ? '' : 'always'}`} key={routeHref(route)}>
          <summary aria-label="Menu"><Icon name="menu" size={18} /></summary>
          <div className="account-pop" role="menu">
            <a role="menuitem" href="/profile"><Icon name="user" size={16} /> Profile</a>
            <a role="menuitem" href="/pricing"><Icon name="coins" size={16} /> Pricing</a>
            <a role="menuitem" href="/settings"><Icon name="gear" size={16} /> Settings</a>
            <button role="menuitem" className="ghost" onClick={() => dispatchEvent(new Event('rv:hints'))}><Icon name="info" size={16} /> Shortcuts and hints</button>
          </div>
        </details>
        <AccountMenu route={route} />
      </div>
    </header>
  );
}

/** The game you're in (its mark and name) and a menu of the others: switching keeps your place (Review → Review). */
function GameSwitch({ game, active }: { game: KitGame; active: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const g = GAMES.find(x => x.id === game)!;
  const path = typeof location !== 'undefined' ? location.pathname : '';
  const same = (to: KitGame) => {
    const place = (Object.keys(HREF[game]) as Place[]).find(p => HREF[game][p] === path && p !== 'puzzles');
    return place ? HREF[to][place] : HREF[to].overview;
  };
  return (
    <details className={`game-switch ${active ? 'on' : ''}`} ref={ref}>
      <summary title="Switch game"><GameMark game={g} size={24} /><span className="gs-name">{g.short}</span><Icon name="chevronDown" size={12} /></summary>
      <div className="account-pop" role="menu">
        {GAMES.filter(x => x.review || x.status === 'next' || x.id === 'dota2').map(x => x.review
          ? <a key={x.id} role="menuitem" href={same(x.id as KitGame)} className={x.id === game ? 'on' : ''} onClick={() => { if (ref.current) ref.current.open = false; }}>
              <GameMark game={x} size={20} /> {x.name} <span className={`games-status ${x.status}`}>{x.status === 'live' ? 'Live' : 'Beta'}</span></a>
          : <span key={x.id} className="game-soon" role="menuitem" aria-disabled="true"><GameMark game={x} size={20} muted /> {x.name} <span className="games-status planned">Soon</span></span>)}
      </div>
    </details>
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
        {hasPro() && <span className="pro-badge" title="Pro is free during early access">PRO</span>}
        <Icon name="chevronDown" size={12} />
      </summary>
      <div className="account-pop" role="menu">
        <a role="menuitem" href="/profile"><Icon name="user" size={16} /> Profile</a>
        <a role="menuitem" href="/settings"><Icon name="gear" size={16} /> Settings</a>
        <a role="menuitem" href="/pricing"><Icon name="coins" size={16} /> Pricing</a>
        {me.owner && <a role="menuitem" href="/dev"><Icon name="stats" size={16} /> Dev</a>}
        <a role="menuitem" href={`https://steamcommunity.com/profiles/${me.steamId}`} target="_blank" rel="noreferrer"><Icon name="arrowRight" size={16} /> Steam profile</a>
        <button role="menuitem" className="ghost" onClick={signOut}><Icon name="signOut" size={16} /> Sign out</button>
      </div>
    </details>
  );
}

import { useEffect, useRef } from 'react';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { navigate, routeHref, type Route } from '../shell/router';
import { STEAM_AVAILABLE } from '../env';
import { GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';
import { hasPro } from '../engine/profile';
import { useStore } from '../store';
import { MAPS } from '../map/catalog';
import { Icon } from '../ui/Icon';
import { refreshProfile, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { steamSignOut } from '../ui/steamApi';
import { useDl } from '../deadlock/store';
import { useD2 } from '../dota2/store';

/** The bar on every page: the brand, the game, CS2's three modes, Pricing and your account. */
export function NavBar({ route }: { route: Route }) {
  const loaded = useStore(s => s.review);
  const exitReview = useStore(s => s.exitReview);
  const cs2 = route.page === 'cs2';
  // with a match loaded there's no Tactical tab: its address goes to Review (Load another closes the match);
  // without one there's no recap to show: Match recap goes to Review too
  useEffect(() => {
    if (cs2 && ((loaded && route.mode === 'tactical') || (!loaded && route.mode === 'report'))) navigate({ page: 'cs2', mode: 'review' });
  }, [cs2, loaded, route]); // eslint-disable-line react-hooks/exhaustive-deps
  // who's logged in, again whenever you come back to the tab (a login in another tab, a session that ran out)
  useEffect(() => {
    const again = () => { refreshProfile(); };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  return (
    <header className="navbar">
      <a className="brand" href="#/"><LogoMark /><span>{APP_NAME}</span></a>
      <nav className="game-bar" aria-label="Games">
        {GAMES.map(g => g.status === 'live' ? (
          <a key={g.id} href={routeHref({ page: 'cs2', mode: cs2 ? route.mode : 'review' })} className={`game-btn live ${cs2 ? 'on' : ''}`} title={`${g.name}: live`}>
            <GameMark game={g} size={24} /><span>{g.short}</span>
          </a>
        ) : g.status === 'beta' && g.review ? (
          <a key={g.id} href={route.page === g.id ? routeHref(route) : g.review} className={`game-btn live ${route.page === g.id ? 'on' : ''}`} title={`${g.name}: beta`}>
            <GameMark game={g} size={24} muted={route.page !== g.id} /><span>{g.short}</span>
          </a>
        ) : g.page ? (
          // a coming game with its own page (what it will do, notify me)
          <a key={g.id} href={g.page} className={`game-btn soon has-page ${route.page === g.id ? 'on' : ''}`} title={`${g.name}: ${STATUS_LABEL[g.status].toLowerCase()}. See what's coming`}>
            <GameMark game={g} size={24} muted={route.page !== g.id} />
          </a>
        ) : (
          <span key={g.id} className="game-btn soon" role="img" aria-label={`${g.name}: ${STATUS_LABEL[g.status].toLowerCase()}`} title={`${g.name}: ${STATUS_LABEL[g.status].toLowerCase()}`}>
            <GameMark game={g} size={24} muted />
          </span>
        ))}
      </nav>
      {cs2 && (
        <div className="modes" role="tablist" aria-label="Mode">
          {/* before a match is loaded: plan (Tactical) or load one (Review); with a match: Review and its recap */}
          {!loaded && (
            <button role="tab" aria-selected={route.mode === 'tactical'} className={route.mode === 'tactical' ? 'on' : ''}
              onClick={() => navigate({ page: 'cs2', mode: 'tactical' })} title="Plan rounds on the board">
              <Icon name="grid" className="mode-ico" /> <span className="mode-label">Tactical</span>
            </button>
          )}
          <button role="tab" aria-selected={route.mode === 'review'} className={route.mode === 'review' ? 'on' : ''}
            onClick={() => navigate({ page: 'cs2', mode: 'review' })} title={loaded ? 'Replay and grade this match' : 'Load a match to replay and grade it'}>
            <Icon name="play" className="mode-ico" /> <span className="mode-label">Review</span>{loaded ? <i className="dot-live" title="A match is loaded" /> : null}
          </button>
          {loaded && (
            <button role="tab" aria-selected={route.mode === 'report'} className={route.mode === 'report' ? 'on' : ''}
              onClick={() => navigate({ page: 'cs2', mode: 'report' })} title="The coach's notes, every player's grades and estimated rating for the match">
              <Icon name="star" className="mode-ico" /> <span className="mode-label">Match recap</span>
            </button>
          )}
        </div>
      )}
      {/* the open match, like a browser tab: what it is, and × to close it (back to picking a match) */}
      {cs2 && loaded && (
        <div className="match-tab" title={`Open match: ${MAPS.find(m => m.id === loaded.data.map)?.name ?? loaded.data.map}, ${loaded.data.rounds.length} rounds`}>
          <Icon name="map" size={14} />
          <b>{MAPS.find(m => m.id === loaded.data.map)?.name ?? loaded.data.map}</b>
          <span className="match-tab-n">{loaded.data.rounds.length} rds</span>
          <button className="match-tab-x" onClick={exitReview} aria-label="Close match" title="Close this match and pick another one"><Icon name="close" size={13} /></button>
        </div>
      )}
      {route.page === 'deadlock' && <DlNav route={route} />}
      {route.page === 'dota2' && <D2Nav route={route} />}
      <div className="nav-right">
        <a className={`nav-link ${route.page === 'pricing' ? 'on' : ''}`} href="#/pricing">Pricing</a>
        <AccountMenu route={route} />
      </div>
    </header>
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
      <a className={`nav-link ${route.page === 'profile' ? 'on' : ''}`} href="#/profile" aria-label="Profile"><Icon name="user" size={16} /> <span>Profile</span></a>
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
        <a role="menuitem" href="#/profile"><Icon name="user" size={16} /> Profile</a>
        <a role="menuitem" href="#/settings"><Icon name="gear" size={16} /> Settings</a>
        {me.owner && <a role="menuitem" href="#/dev"><Icon name="stats" size={16} /> Dev</a>}
        <a role="menuitem" href={`https://steamcommunity.com/profiles/${me.steamId}`} target="_blank" rel="noreferrer"><Icon name="arrowRight" size={16} /> Steam profile</a>
        <button role="menuitem" className="ghost" onClick={signOut}><Icon name="signOut" size={16} /> Sign out</button>
      </div>
    </details>
  );
}

/** Deadlock's modes (Tactical, Review, and Match recap once a match is open) and its open match, like CS2's. */
function D2Nav({ route }: { route: Extract<Route, { page: 'deadlock' | 'dota2' }> }) {
  const match = useD2(s => s.match), close = useD2(s => s.close);
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <>
      <div className="modes" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={route.mode === 'tactical'} className={route.mode === 'tactical' ? 'on' : ''}
          onClick={() => navigate({ page: 'dota2', mode: 'tactical' })} title="Plan: lanes, rotations and wards, or a teamfight">
          <Icon name="grid" className="mode-ico" /> <span className="mode-label">Tactical</span>
        </button>
        <button role="tab" aria-selected={route.mode === 'review'} className={route.mode === 'review' ? 'on' : ''}
          onClick={() => navigate({ page: 'dota2', mode: 'review' })} title={match ? 'Replay this match' : 'Pick a match to replay'}>
          <Icon name="play" className="mode-ico" /> <span className="mode-label">Review</span>{match ? <i className="dot-live" title="A match is loaded" /> : null}
        </button>
        {match && (
          <button role="tab" aria-selected={route.mode === 'report'} className={route.mode === 'report' ? 'on' : ''}
            onClick={() => navigate({ page: 'dota2', mode: 'report' })} title="The coach's lessons, fights, objectives, item timings and the scoreboard">
            <Icon name="star" className="mode-ico" /> <span className="mode-label">Match recap</span>
          </button>
        )}
      </div>
      {match && (
        <div className="match-tab" title={`Open match ${match.id}, ${mins(match.duration)}`}>
          <Icon name="map" size={14} />
          <b>Match {match.id}</b>
          <span className="match-tab-n">{mins(match.duration)}</span>
          <button className="match-tab-x" onClick={close} aria-label="Close match" title="Close this match and pick another one"><Icon name="close" size={13} /></button>
        </div>
      )}
    </>
  );
}

function DlNav({ route }: { route: Extract<Route, { page: 'deadlock' | 'dota2' }> }) {
  const match = useDl(s => s.match), close = useDl(s => s.close);
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <>
      <div className="modes" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={route.mode === 'tactical'} className={route.mode === 'tactical' ? 'on' : ''}
          onClick={() => navigate({ page: 'deadlock', mode: 'tactical' })} title="Plan: lanes and rotations, a teamfight, builds and power spikes">
          <Icon name="grid" className="mode-ico" /> <span className="mode-label">Tactical</span>
        </button>
        <button role="tab" aria-selected={route.mode === 'review'} className={route.mode === 'review' ? 'on' : ''}
          onClick={() => navigate({ page: 'deadlock', mode: 'review' })} title={match ? 'Replay this match' : 'Pick a match to replay'}>
          <Icon name="play" className="mode-ico" /> <span className="mode-label">Review</span>{match ? <i className="dot-live" title="A match is loaded" /> : null}
        </button>
        {match && (
          <button role="tab" aria-selected={route.mode === 'report'} className={route.mode === 'report' ? 'on' : ''}
            onClick={() => navigate({ page: 'deadlock', mode: 'report' })} title="The coach's lessons, fights, objectives and the scoreboard">
            <Icon name="star" className="mode-ico" /> <span className="mode-label">Match recap</span>
          </button>
        )}
      </div>
      {match && (
        <div className="match-tab" title={`Open match ${match.id}, ${mins(match.duration)}`}>
          <Icon name="map" size={14} />
          <b>Match {match.id}</b>
          <span className="match-tab-n">{mins(match.duration)}</span>
          <button className="match-tab-x" onClick={close} aria-label="Close match" title="Close this match and pick another one"><Icon name="close" size={13} /></button>
        </div>
      )}
    </>
  );
}

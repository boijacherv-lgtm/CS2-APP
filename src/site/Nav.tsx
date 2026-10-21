import { useEffect, useRef } from 'react';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { navigate, routeHref, type Route } from '../shell/router';
import { STEAM_AVAILABLE } from '../env';
import { GAMES, STATUS_LABEL } from './games';
import { hasPro } from '../engine/profile';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { refreshProfile, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { steamSignOut } from '../ui/steamApi';

/** The bar on every page: the brand, the game, CS2's three modes, Pricing and your account. */
export function NavBar({ route }: { route: Route }) {
  const loaded = useStore(s => s.review);
  const cs2 = route.page === 'cs2';
  const gamesMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (gamesMenu.current) gamesMenu.current.open = false; }, [route]);
  // who's logged in, again whenever you come back to the tab (a login in another tab, a session that ran out)
  useEffect(() => {
    const again = () => { refreshProfile(); };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  return (
    <header className="navbar">
      <a className="brand" href="#/"><LogoMark /><span>{APP_NAME}</span></a>
      <nav className="games" aria-label="Game">
        <a href={routeHref({ page: 'cs2', mode: cs2 ? route.mode : 'review' })} className={`game-tab ${cs2 ? 'on' : ''}`}>CS2</a>
        <details className="games-menu" ref={gamesMenu}>
          <summary className="game-tab games-btn" title="Games coming to RageView">Games <Icon name="chevronDown" size={10} /></summary>
          <div className="games-pop">
            {GAMES.map(g => g.status === 'live' ? (
              <a key={g.id} href={routeHref({ page: 'cs2', mode: 'review' })} className="games-row live"><b>{g.name}</b><span className="games-status live">{STATUS_LABEL[g.status]}</span></a>
            ) : (
              <div key={g.id} className="games-row" title={g.note}><b>{g.name}</b><span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span></div>
            ))}
          </div>
        </details>
      </nav>
      {cs2 && (
        <div className="modes" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={route.mode === 'review'} className={route.mode === 'review' ? 'on' : ''}
            onClick={() => navigate({ page: 'cs2', mode: 'review' })} title="Replay and grade a played match">
            <Icon name="play" className="mode-ico" /> Review{loaded ? <i className="dot-live" title="A match is loaded" /> : null}
          </button>
          <button role="tab" aria-selected={route.mode === 'report'} className={route.mode === 'report' ? 'on' : ''}
            onClick={() => navigate({ page: 'cs2', mode: 'report' })} title="The coach's notes, every player's grades and estimated rating for the match">
            <Icon name="star" className="mode-ico" /> Match recap
          </button>
          <button role="tab" aria-selected={route.mode === 'tactical'} className={route.mode === 'tactical' ? 'on' : ''}
            onClick={() => navigate({ page: 'cs2', mode: 'tactical' })} title="Plan rounds on the board">
            <Icon name="grid" className="mode-ico" /> Tactical
          </button>
        </div>
      )}
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
      <a className={`nav-link ${route.page === 'profile' ? 'on' : ''}`} href="#/profile"><Icon name="user" size={16} /> Profile</a>
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

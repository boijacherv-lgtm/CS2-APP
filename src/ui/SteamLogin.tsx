import { useCallback, useEffect, useState } from 'react';
import { ONLINE } from '../env';

/**
 * "Log in with Steam", the way Leetify / FACEIT do it: Steam OpenID. The browser goes to Steam's own
 * login page (QR code with Steam Guard there) and comes back with a signed SteamID; the app never sees a
 * password, token or session. The dev server handles /api/steam/openid/* (tools/steam.mjs).
 */

type Me = { steamId: string; name: string | null; avatar: string | null } | null;

/** Steam's logo mark. */
export function SteamLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="currentColor" />
      <circle cx="15.6" cy="8.9" r="3.2" fill="none" stroke="#000" strokeWidth="1.5" />
      <circle cx="15.6" cy="8.9" r="1.6" fill="#000" />
      <path d="M2.2 14.6l4.9 2a2.7 2.7 0 1 0 1.3-3.6L13 9.6" fill="none" stroke="#000" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Link that starts the sign-in and brings you back to the page you were on. */
export function SteamLoginButton({ compact }: { compact?: boolean }) {
  const back = typeof location !== 'undefined' && location.hash.startsWith('#/') ? location.hash.split('?')[0] : '#/cs2/review';
  return (
    <a className={`steam-login ${compact ? 'compact' : ''}`} href={`/api/steam/openid/start?back=${encodeURIComponent(back)}`}
      title="Opens Steam's own login page; you can scan its QR code with the Steam app. The app only receives your SteamID.">
      <SteamLogo /> Log in with Steam
    </a>
  );
}

/** Your Steam account in the nav bar: avatar + name, or the login button. Hidden without the dev server. */
export function SteamAccount() {
  const [me, setMe] = useState<Me | undefined>(undefined); // undefined = unknown / no server
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/steam/me');
      if (!res.ok) throw new Error();
      setMe((await res.json()).me);
    } catch { setMe(undefined); }
  }, []);
  useEffect(() => {
    if (ONLINE) return; // no server on the public site
    load();
    const t = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { clearInterval(t); window.removeEventListener('focus', load); };
  }, [load]);

  if (me === undefined) return null;
  if (!me) return <SteamLoginButton compact />;
  const signOut = async () => { await fetch('/api/steam/signout', { method: 'POST' }); load(); };
  return (
    <div className="steam-me">
      {me.avatar && <img src={me.avatar} alt="" width={26} height={26} />}
      <a href={`https://steamcommunity.com/profiles/${me.steamId}`} target="_blank" rel="noreferrer">{me.name ?? me.steamId}</a>
      <button onClick={signOut} title="Forget your Steam account on this computer">Sign out</button>
    </div>
  );
}

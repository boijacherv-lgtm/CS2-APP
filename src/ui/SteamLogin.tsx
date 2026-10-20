import { steamLoginHref } from './steamApi';

/**
 * "Log in with Steam", the way Leetify / FACEIT do it: Steam OpenID. The browser goes to Steam's own
 * login page (QR code with Steam Guard there) and comes back with a signed SteamID; the app never sees a
 * password, token or session. Locally the dev server checks it (tools/steam.mjs); on the website the
 * Cloudflare Worker does (worker/).
 */

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
    <a className={`steam-login ${compact ? 'compact' : ''}`} href={steamLoginHref(back)}
      title="Opens Steam's own login page; you can scan its QR code with the Steam app. The app only receives your SteamID.">
      <SteamLogo /> Log in with Steam
    </a>
  );
}

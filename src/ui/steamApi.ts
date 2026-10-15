import { openIdLoginUrl } from '../engine/sharecode';
import { API_URL, ONLINE } from '../env';

/**
 * Talks to whichever Steam backend this build has: the local dev server (/api/steam/*, it keeps who is
 * logged in) or, on the website, the Cloudflare Worker (session token kept in this browser).
 */
const TOKEN_KEY = 'stratboard.steamSession';
const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

export function steamFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!ONLINE) return fetch(`/api/steam${path}`, init);
  const t = token();
  return fetch(`${API_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
}

export async function steamSignOut() {
  await steamFetch('/signout', { method: 'POST' }).catch(() => {});
  if (ONLINE) setToken(null);
}

/** "Log in with Steam": Steam's own login page, coming back to the page you were on. */
export function steamLoginHref(back: string) {
  if (!ONLINE) return `/api/steam/openid/start?back=${encodeURIComponent(back)}`;
  // Steam comes back to the website itself; finishSteamLogin() hands its signed answer to the Worker
  return openIdLoginUrl(`${location.origin}/?back=${encodeURIComponent(back)}`, location.origin);
}

/**
 * On the website, Steam sends the browser back to https://site/?back=…&openid.…: give Steam's signed answer to
 * the Worker (it checks it with Steam), keep the session token, tidy the URL and go back to where you were.
 */
export async function finishSteamLogin(): Promise<void> {
  if (!ONLINE) return;
  const q = new URLSearchParams(location.search);
  if (!q.get('openid.mode')) return;
  const back = /^#\/[\w/-]*$/.test(q.get('back') ?? '') ? q.get('back')! : '#/cs2/review';
  const params = Object.fromEntries([...q].filter(([k]) => k.startsWith('openid.')));
  let to = back;
  try {
    const res = await fetch(`${API_URL}/openid/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params }) });
    const out = await res.json();
    if (!res.ok || !out.token) throw new Error(out.error ?? 'Steam login failed.');
    setToken(out.token);
  } catch (e) {
    to = `#/cs2/review?steam_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`;
  }
  history.replaceState(null, '', `${location.pathname}${to}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

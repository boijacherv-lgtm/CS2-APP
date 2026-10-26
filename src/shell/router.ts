import { useSyncExternalStore } from 'react';

/** Pages, addressed by the URL hash so Back/Forward and bookmarks work without a server. */
export type Cs2Mode = 'tactical' | 'review' | 'report';
/** Deadlock: its landing page (home) and the same three modes as CS2. */
export type DlMode = 'home' | 'tactical' | 'review' | 'report';
export type SitePage = 'home' | 'profile' | 'pricing' | 'settings' | 'dev';
export type Route = { page: SitePage } | { page: 'cs2'; mode: Cs2Mode } | { page: 'deadlock'; mode: DlMode };
const PAGES: SitePage[] = ['profile', 'pricing', 'settings', 'dev'];

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean); // ?… carries messages (e.g. Steam sign-in)
  if (parts[0] === 'cs2') return { page: 'cs2', mode: parts[1] === 'review' || parts[1] === 'report' ? parts[1] : 'tactical' };
  if (parts[0] === 'deadlock') return { page: 'deadlock', mode: parts[1] === 'review' || parts[1] === 'report' || parts[1] === 'tactical' ? parts[1] : 'home' };
  if (PAGES.includes(parts[0] as SitePage)) return { page: parts[0] as SitePage };
  return { page: 'home' };
}

export const routeHref = (r: Route) => (r.page === 'cs2' ? `#/cs2/${r.mode}` : r.page === 'deadlock' ? (r.mode === 'home' ? '#/deadlock' : `#/deadlock/${r.mode}`)
  : r.page === 'home' ? '#/' : `#/${r.page}`);

export function navigate(r: Route) {
  const href = routeHref(r);
  if (location.hash !== href) location.hash = href;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseRoute(hash);
}

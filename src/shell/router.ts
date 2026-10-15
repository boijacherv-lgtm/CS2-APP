import { useSyncExternalStore } from 'react';

/** Pages, addressed by the URL hash so Back/Forward and bookmarks work without a server. */
export type Cs2Mode = 'tactical' | 'review' | 'report';
export type Route = { page: 'home' } | { page: 'cs2'; mode: Cs2Mode };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'cs2') return { page: 'cs2', mode: parts[1] === 'review' || parts[1] === 'report' ? parts[1] : 'tactical' };
  return { page: 'home' };
}

export const routeHref = (r: Route) => (r.page === 'home' ? '#/' : `#/cs2/${r.mode}`);

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

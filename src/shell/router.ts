import { useSyncExternalStore } from 'react';
import { GUIDES } from '../site/guideList';

/** Pages, addressed by real paths (/cs2/review); each has its own copy of index.html (tools/spa-pages.mjs). */
/** home: the game's page (/cs2), like Deadlock's. */
export type Cs2Mode = 'home' | 'tactical' | 'review' | 'report';
/** Deadlock: its landing page (home) and the same three modes as CS2. */
export type DlMode = 'home' | 'tactical' | 'review' | 'report';
export type SitePage = 'home' | 'profile' | 'pricing' | 'settings' | 'dev' | 'puzzles' | 'missing' | 'privacy' | 'changelog' | 'guides';
/** `moment`: a shared moment, the whole of it in the address (/m?c=<code>). */
export type Route = { page: SitePage } | { page: 'guides'; guide: string } | { page: 'cs2'; mode: Cs2Mode } | { page: 'deadlock'; mode: DlMode } | { page: 'moment'; code: string };
const PAGES: SitePage[] = ['profile', 'pricing', 'settings', 'dev', 'puzzles', 'privacy', 'changelog', 'guides'];

/** A path ("/cs2/review", "/m?c=…", or an old "#/cs2/review") as a page. */
export function parseRoute(path: string): Route {
  const [where, query = ''] = path.replace(/^#/, '').split('?'); // ?… carries messages (e.g. Steam sign-in) and a shared moment
  const parts = where.split('/').filter(Boolean);
  if (parts[0] === 'cs2') return { page: 'cs2', mode: parts[1] === 'review' || parts[1] === 'report' || parts[1] === 'tactical' ? parts[1] : 'home' };
  // /deadlock/meta is Meta & builds (mode 'tactical' inside; /deadlock/tactical was its old address)
  if (parts[0] === 'deadlock') return { page: 'deadlock', mode: parts[1] === 'review' || parts[1] === 'report' ? parts[1] : parts[1] === 'meta' || parts[1] === 'tactical' ? 'tactical' : 'home' };
  if (parts[0] === 'm') { const code = parts[1] ?? new URLSearchParams(query).get('c'); if (code) return { page: 'moment', code }; }
  if (parts[0] === 'index.html' && parts.length === 1) return { page: 'home' };
  if (parts[0] === 'guides' && parts[1]) return GUIDES.some(g => g.slug === parts[1]) ? { page: 'guides', guide: parts[1] } : { page: 'missing' };
  if (PAGES.includes(parts[0] as SitePage)) return { page: parts[0] as SitePage };
  // the front page is / ; anything else unknown is a page that doesn't exist
  return parts.length ? { page: 'missing' } : { page: 'home' };
}

/** A page's address. A shared moment's code goes in the query (/m?c=…): /m is a real page, so the link loads as one. */
export const routeHref = (r: Route) => (r.page === 'cs2' ? (r.mode === 'home' ? '/cs2' : `/cs2/${r.mode}`) : r.page === 'deadlock' ? (r.mode === 'home' ? '/deadlock' : `/deadlock/${r.mode === 'tactical' ? 'meta' : r.mode}`)
  : r.page === 'moment' ? `/m?c=${r.code}` : r.page === 'home' ? '/' : 'guide' in r ? `/guides/${r.guide}` : `/${r.page}`);

const NAV = 'rv:navigate';
/** Goes to an address in the app (a path), without reloading. */
export function go(href: string, replace = false) {
  if (`${location.pathname}${location.search}` === href) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', href);
  window.dispatchEvent(new Event(NAV));
}
export function navigate(r: Route) { go(routeHref(r)); }

/** Old links ("/#/cs2/review", from before the site had real paths, or the dev server's sign-in) become the path. */
function fromHash() {
  // old or odd addresses become the real one
  const fix = ({ '/deadlock/tactical': '/deadlock/meta', '/index.html': '/' } as Record<string, string>)[location.pathname.replace(/(.)\/$/, '$1')]
    ?? (location.pathname.length > 1 && location.pathname.endsWith('/') ? location.pathname.slice(0, -1) : null);
  if (fix && !location.hash) { history.replaceState(null, '', fix + location.search); window.dispatchEvent(new Event(NAV)); return; }
  if (location.hash.startsWith('#/')) { history.replaceState(null, '', location.hash.slice(1) || '/'); window.dispatchEvent(new Event(NAV)); }
}
if (typeof window !== 'undefined') { fromHash(); window.addEventListener('hashchange', fromHash); }

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb); window.addEventListener(NAV, cb);
  return () => { window.removeEventListener('popstate', cb); window.removeEventListener(NAV, cb); };
};

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => `${location.pathname}${location.search}`);
  return parseRoute(path);
}

/** In-app links (<a href="/…">) go without a reload; files, other sites, new tabs and modified clicks are left alone. */
export function handleLinks(root: Document = document) {
  root.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    const href = a?.getAttribute('href');
    if (!a || !href || !href.startsWith('/') || href.startsWith('//') || a.target || a.hasAttribute('download')) return;
    if (/\.[a-z0-9]{2,5}($|\?)/i.test(href.split('#')[0]) || href.startsWith('/api')) return;
    e.preventDefault();
    go(href);
  });
}

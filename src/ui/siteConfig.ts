import { useSyncExternalStore } from 'react';
import { API_URL } from '../env';
import { DEFAULT_CONFIG, type SiteConfig } from '../../worker/src/site';
import { setRageOverride } from '../engine/rage';
import { resetHints } from './Hints';

/**
 * The site's content and switches from the dev page (Worker /config, worker/src/site.ts), read once at load and kept
 * for the visit: the banner, maintenance, feature flags, samples, the daily puzzle, Rage lines, the hints version.
 * Without the Worker (a local copy) the defaults apply.
 */
let config: SiteConfig = DEFAULT_CONFIG;
const subs = new Set<() => void>();
export const siteConfig = () => config;
export function setSiteConfig(c: SiteConfig) {
  config = c;
  setRageOverride(c.rage);
  // a new hints version from the dev page: everyone sees the hints once more
  try {
    const was = +(localStorage.getItem(HINTS_VERSION) ?? 1);
    if (c.hintsVersion > was) { resetHints(); localStorage.setItem(HINTS_VERSION, String(c.hintsVersion)); }
  } catch { /* private mode */ }
  subs.forEach(f => f());
}
const HINTS_VERSION = 'rageview.hintsVersion';
export function useSiteConfig(): SiteConfig {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => config);
}
/** Called once at start-up (main.tsx). */
export function loadSiteConfig() {
  if (!API_URL) return;
  fetch(`${API_URL}/config`, { signal: AbortSignal.timeout(6000) })
    .then(r => (r.ok ? (r.json() as Promise<SiteConfig>) : null))
    .then(c => { if (c) setSiteConfig({ ...DEFAULT_CONFIG, ...c, flags: { ...DEFAULT_CONFIG.flags, ...c.flags } }); })
    .catch(() => { /* the defaults stay */ });
}

/** Pro for everyone while early access is on (dev page → Content → flags); there are no payments yet. */
export const proEarlyAccess = () => config.flags.proEarlyAccess;

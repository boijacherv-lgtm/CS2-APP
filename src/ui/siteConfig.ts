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
export function setSiteConfig(raw: SiteConfig) {
  // an older Worker lacks the newest fields: the defaults fill them, so no page reads an undefined
  const c: SiteConfig = { ...DEFAULT_CONFIG, ...raw, flags: { ...DEFAULT_CONFIG.flags, ...raw.flags }, games: { ...DEFAULT_CONFIG.games, ...raw.games }, footer: { ...DEFAULT_CONFIG.footer, ...raw.footer }, pricing: { ...DEFAULT_CONFIG.pricing, ...raw.pricing }, hero: { ...DEFAULT_CONFIG.hero, ...raw.hero } };
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
  const once = () => fetch(`${API_URL}/config`, { signal: AbortSignal.timeout(6000) })
    .then(r => (r.ok ? (r.json() as Promise<SiteConfig>) : Promise.reject(new Error(`The Worker answered ${r.status}.`))))
    .then(c => { configError = null; setSiteConfig({ ...DEFAULT_CONFIG, ...c, flags: { ...DEFAULT_CONFIG.flags, ...c.flags }, games: { ...DEFAULT_CONFIG.games, ...c.games }, footer: { ...DEFAULT_CONFIG.footer, ...c.footer }, pricing: { ...DEFAULT_CONFIG.pricing, ...c.pricing }, hero: { ...DEFAULT_CONFIG.hero, ...c.hero } }); })
    .catch(e => { configError = e instanceof Error ? e.message : String(e); subs.forEach(f => f()); /* the defaults stay */ });
  void once();
  // edits from the dev page show without a reload: look again every minute while the tab is open
  setInterval(() => { if (document.visibilityState === 'visible') void once(); }, 60_000);
}
/** Why the config didn't load (shown to the owner only); null when it did. */
let configError: string | null = null;
export const configProblem = () => configError;
export const useConfigProblem = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => configError);

/** Pro for everyone while early access is on (dev page → Content → flags); there are no payments yet. */
export const proEarlyAccess = () => config.flags.proEarlyAccess;

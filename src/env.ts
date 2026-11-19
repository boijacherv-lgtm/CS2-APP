/**
 * The public website (GitHub Pages, built with VITE_ONLINE=1) has no server of its own: .dem files are read in the
 * browser (WebAssembly parser, src/ui/demoWorker.ts).
 * Log in with Steam and "Your matches" run there through the Cloudflare Worker (worker/) when VITE_API_URL
 * points at it. Locally (npm run dev) everything goes through the dev server instead.
 */
export const ONLINE = import.meta.env.VITE_ONLINE === '1';
/** The Worker's address on the website, e.g. https://stratboard-api.<you>.workers.dev (no trailing slash). */
export const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
/** Where the site reads the Deadlock bot's view: the Worker (the bot runs on GitHub Actions, server/src/once.mjs, and
 * reports there); VITE_DL_BOT_URL points it at a bot service instead (server/src/deadlock.mjs). Empty: no bot. */
export const DL_BOT_URL = String(import.meta.env.VITE_DL_BOT_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
/** Steam login + match list available here? (always locally; online only with the Worker) */
export const STEAM_AVAILABLE = !ONLINE || !!API_URL;

declare const __BUILD__: { commit: string; time: string } | undefined;
/** This build: the git commit and when it was built (vite.config.ts), for the dev page. */
export const BUILD = typeof __BUILD__ !== 'undefined' && __BUILD__ ? __BUILD__ : { commit: 'dev', time: '' };

/** Debug details (the game's timers on the Deadlock map, the demo's state): `?debug` in the address, or
 * localStorage `stratboard.debug` = 1. */
export const DEBUG = (() => {
  try { return /[?&]debug\b/.test(location.search + location.hash) || localStorage.getItem('stratboard.debug') === '1'; } catch { return false; }
})();

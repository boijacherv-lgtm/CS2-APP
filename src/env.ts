/**
 * The public website (GitHub Pages, built with VITE_ONLINE=1) has no server of its own: no .dem parsing.
 * Log in with Steam and "Your matches" run there through the Cloudflare Worker (worker/) when VITE_API_URL
 * points at it. Locally (npm run dev) everything goes through the dev server instead.
 */
export const ONLINE = import.meta.env.VITE_ONLINE === '1';
/** The Worker's address on the website, e.g. https://stratboard-api.<you>.workers.dev (no trailing slash). */
export const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
/** Steam login + match list available here? (always locally; online only with the Worker) */
export const STEAM_AVAILABLE = !ONLINE || !!API_URL;
export const LOCAL_ONLY_NOTE = 'Reading .dem files works in the desktop version (run it from GitHub). Here you can open a match saved as .json.';

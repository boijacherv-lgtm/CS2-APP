/**
 * The public website (GitHub Pages, built with VITE_ONLINE=1) has no server behind it: no .dem parsing,
 * no Log in with Steam, no Steam match list. Those stay in the local version (npm run dev).
 */
export const ONLINE = import.meta.env.VITE_ONLINE === '1';
export const LOCAL_ONLY_NOTE = 'Reading .dem files, Log in with Steam and your Steam match list work in the desktop version (run it from GitHub). Here you can open a match saved as .json.';

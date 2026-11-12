import { LETTER_COLOR } from '../engine/notes';

/**
 * The design tokens: every colour the app uses, in one place. The page gets them as CSS custom properties
 * (applyTokens() writes them to :root before the first render), and the Konva canvas imports the same values
 * (it can't read CSS variables), so the map and the page never drift apart.
 *
 * The rule: only team colours, grenade colours and grade colours are colourful. The chrome (panels, buttons,
 * text) is greyscale, like CS2's own menus, and white is the interactive colour.
 */
export const T = {
  // Tactical night: near-black layers a small step apart, so the map, the team colours and the grades carry the colour
  bg0: '#0A0C10', // page
  bg1: '#0E1116', // around the map, tracks of bars and toggles
  surface1: '#12161C', // panels, drawer, cards
  surface2: '#191E26', // cards inside cards, inputs
  surface3: '#222833', // hover, selected
  border: '#262D38',
  borderStrong: '#343C48',
  text1: '#ECEFF4',
  text2: '#A3ACBA',
  text3: '#7D889A', // 4.5:1 on the cards (was #687384, under AA)
  ct: '#5B9BFF', ctDim: '#1F3558',
  t: '#F2B13C', tDim: '#5A4317',
  smoke: '#C9D1D9', flash: '#FFF6A8', molly: '#FF6B2C', mollyCore: '#FFB020', he: '#7BD88F',
  bomb: '#E5483A', c4: '#B8963A',
  good: '#22C55E', warn: '#F0C33C', bad: '#E5484D',
  // the brand's red: the logo and Rage mode, nothing else
  rage: '#FF4D3D',
  // the same on dark text: health, money, a better or worse number
  goodSoft: '#7FD18B', badSoft: '#FF7A6E',
  // what the screen points at right now: a place a card names, a lineup, the spot ranking
  highlight: '#FFD166',
} as const;

/**
 * The light theme: the same names, light values (the map canvas keeps the dark ones: map images stay dark in a dark
 * frame). Grades keep their hues on dark ink.
 */
export const LIGHT: Partial<Record<keyof typeof T, string>> = {
  bg0: '#F6F7F9', bg1: '#EEF1F5', surface1: '#FFFFFF', surface2: '#EEF1F5', surface3: '#E3E8EF', border: '#D9DEE6', borderStrong: '#C3CBD6',
  text1: '#0F141A', text2: '#4A5566', text3: '#6B7686', ct: '#2563EB', ctDim: '#DCE7FD', t: '#B7791F', tDim: '#F6E7CC',
  good: '#15803D', warn: '#B45309', bad: '#DC2626', goodSoft: '#15803D', badSoft: '#DC2626', highlight: '#B7791F',
};
/** How the site looks: the system's choice, or always dark / light (Settings → Look). */
export type Look = 'system' | 'dark' | 'light';
const LOOK_KEY = 'rageview.look';
export function lookPref(): Look {
  try { const v = localStorage.getItem(LOOK_KEY); if (v === 'dark' || v === 'light') return v; } catch { /* private mode */ }
  return 'system';
}
const prefersLight = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
/** The look in effect now: light or dark. */
export const isLight = () => { const p = lookPref(); return p === 'light' || (p === 'system' && prefersLight()); };
/** Saves the look and repaints the page in it. */
export function setLook(l: Look) {
  try { l === 'system' ? localStorage.removeItem(LOOK_KEY) : localStorage.setItem(LOOK_KEY, l); } catch { /* private mode */ }
  applyTokens();
  applyGame((document.documentElement.dataset.game as GameId | 'neutral' | undefined) ?? 'neutral');
}

/**
 * Each game's accent (the site takes on the colour of the game you're in): buttons, links, tabs, focus, charts, glows
 * and a faint tint in backgrounds and cards. Team, grenade and mark colours don't change. `ink` is text on the accent.
 */
export type GameId = 'cs2' | 'deadlock';
export const GAME_THEME: Record<GameId, { accent: string; ink: string; name: string }> = {
  cs2: { accent: '#F2A23A', ink: '#1A1206', name: 'Counter-Strike 2' }, // CS2's menus: warm amber
  deadlock: { accent: '#3FC9A3', ink: '#06170F', name: 'Deadlock' }, // Deadlock's art deco: jade
};
const GAME_KEY = 'stratboard.game';
/** The game the site is dressed in: the page's game, else the last one you were in (CS2 at first). */
export function gameOf(page: string): GameId {
  if (page === 'cs2' || page === 'deadlock') { try { localStorage.setItem(GAME_KEY, page); } catch { /* private mode */ } return page; }
  try { const g = localStorage.getItem(GAME_KEY); if (g === 'cs2' || g === 'deadlock') return g; } catch { /* private mode */ }
  return 'cs2';
}
/** The pages about the site itself rather than one game (the front page, plans, the dev page): white, the chrome's own
 * colour. */
const NEUTRAL = { accent: T.text1, ink: T.bg0 };
/** The accents on the light theme: darker, so they read on white. */
const LIGHT_ACCENT: Record<GameId | 'neutral', { accent: string; ink: string }> = {
  cs2: { accent: '#B7791F', ink: '#1A1206' }, deadlock: { accent: '#0F8F72', ink: '#06170F' }, neutral: { accent: '#0F141A', ink: '#F6F7F9' },
};
const NEUTRAL_PAGES = new Set(['home', 'pricing', 'dev', 'missing', 'privacy', 'changelog']);
/** What a page is dressed in: neutral for the site's own pages, else its game (gameOf). */
export function themeOf(page: string): GameId | 'neutral' {
  return NEUTRAL_PAGES.has(page) || page === '' ? 'neutral' : gameOf(page);
}
/** Dresses the page in a game's colours, or neutral (CSS --theme / --theme-ink, html[data-game]); the stylesheet fades
 * between them. */
export function applyGame(game: GameId | 'neutral', root: HTMLElement = document.documentElement) {
  const c = isLight() ? LIGHT_ACCENT[game] : game === 'neutral' ? NEUTRAL : GAME_THEME[game];
  root.dataset.game = game;
  root.style.setProperty('--theme', c.accent);
  root.style.setProperty('--theme-ink', c.ink);
}

/** Overlay surface over the map: solid enough to read on a busy radar (no blur: the canvas repaints every frame). */
export const OVERLAY = 'rgba(10, 12, 16, 0.88)';

export const SIDE_COLOR = { CT: T.ct, T: T.t } as const;
export const UTIL_COLOR = { smoke: T.smoke, flash: T.flash, molotov: T.molly, he: T.he } as const;

// Both have Cyrillic (player names like КРЫСА): Unbounded for headlines, grade letters and big numbers; Onest for the UI
// --font-display is for numbers and short labels in the app (Onest, tabular); Unbounded only for page headlines
// (28px and up) and the grade letters (--font-headline)
export const FONT_DISPLAY = "Onest, system-ui, -apple-system, 'Segoe UI', sans-serif";
export const FONT_HEADLINE = "Unbounded, 'Exo 2', system-ui, sans-serif";
export const FONT_UI = "Onest, system-ui, -apple-system, 'Segoe UI', sans-serif";

const kebab = (k: string) => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`).replace(/(\d)/, '-$1');

/** Writes the tokens to :root as CSS variables (plus the older names the stylesheet still uses). */
export function applyTokens(root: HTMLElement = document.documentElement) {
  const vars: Record<string, string> = {};
  const light = isLight(), P = { ...T, ...(light ? LIGHT : {}) };
  root.dataset.theme = light ? 'light' : 'dark';
  root.style.colorScheme = light ? 'light' : 'dark';
  for (const [k, v] of Object.entries(P)) vars[`--${kebab(k)}`] = v;
  // the letter colours (moves, rounds and matches share them): --letter-splus, --letter-s … --letter-f
  for (const [l, c] of Object.entries(LETTER_COLOR)) vars[`--letter-${l === 'S+' ? 'splus' : l.toLowerCase()}`] = c;
  Object.assign(vars, {
    '--overlay': OVERLAY, '--font-display': FONT_DISPLAY, '--font-headline': FONT_HEADLINE, '--font-ui': FONT_UI,
    // older names, kept so every existing rule picks up the new palette
    '--bg': P.bg0, '--panel': P.surface1, '--panel2': P.surface2, '--line': P.border,
    '--text': P.text1, '--muted': P.text2, '--accent': P.text1,
  });
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  // the replay boards stay dark on the light theme (the map is a dark image; the overlays on it are drawn for dark)
  if (typeof document !== 'undefined') {
    let el = document.getElementById('dark-scope') as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = 'dark-scope'; document.head.appendChild(el); }
    const dark = Object.entries(T).map(([k, v]) => `--${kebab(k)}:${v}`).join(';');
    el.textContent = light ? `.board,.dl-board{${dark};--bg:${T.bg0};--panel:${T.surface1};--panel2:${T.surface2};--line:${T.border};--text:${T.text1};--muted:${T.text2};color:${T.text1};color-scheme:dark}` : '';
  }
}

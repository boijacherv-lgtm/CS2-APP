import { LETTER_COLOR } from '../engine/recap';

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
  surface1: '#13171D', // panels, drawer, cards
  surface2: '#1A1F27', // cards inside cards, inputs
  surface3: '#232A34', // hover, selected
  border: '#222831',
  borderStrong: '#343C48',
  text1: '#E8ECF2',
  text2: '#9AA4B2',
  text3: '#7D889A', // 4.5:1 on the cards (was #687384, under AA)
  ct: '#5B9BFF', ctDim: '#1F3558',
  t: '#F2B13C', tDim: '#5A4317',
  smoke: '#C9D1D9', flash: '#FFF6A8', molly: '#FF6B2C', mollyCore: '#FFB020', he: '#7BD88F',
  bomb: '#E5483A', c4: '#B8963A',
  good: '#22C55E', warn: '#F0C33C', bad: '#E5483A',
  // the same on dark text: health, money, a better or worse number
  goodSoft: '#7FD18B', badSoft: '#FF7A6E',
  // what the screen points at right now: a place a card names, a lineup, the spot ranking
  highlight: '#FFD166',
} as const;

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
const NEUTRAL_PAGES = new Set(['home', 'pricing', 'dev', 'missing', 'privacy', 'changelog']);
/** What a page is dressed in: neutral for the site's own pages, else its game (gameOf). */
export function themeOf(page: string): GameId | 'neutral' {
  return NEUTRAL_PAGES.has(page) || page === '' ? 'neutral' : gameOf(page);
}
/** Dresses the page in a game's colours, or neutral (CSS --theme / --theme-ink, html[data-game]); the stylesheet fades
 * between them. */
export function applyGame(game: GameId | 'neutral', root: HTMLElement = document.documentElement) {
  const c = game === 'neutral' ? NEUTRAL : GAME_THEME[game];
  root.dataset.game = game;
  root.style.setProperty('--theme', c.accent);
  root.style.setProperty('--theme-ink', c.ink);
}

/** Overlay surface over the map: solid enough to read on a busy radar (no blur: the canvas repaints every frame). */
export const OVERLAY = 'rgba(10, 12, 16, 0.88)';

export const SIDE_COLOR = { CT: T.ct, T: T.t } as const;
export const UTIL_COLOR = { smoke: T.smoke, flash: T.flash, molotov: T.molly, he: T.he } as const;

export const FONT_DISPLAY = "Rajdhani, 'Barlow Condensed', system-ui, sans-serif";
export const FONT_UI = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

const kebab = (k: string) => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`).replace(/(\d)/, '-$1');

/** Writes the tokens to :root as CSS variables (plus the older names the stylesheet still uses). */
export function applyTokens(root: HTMLElement = document.documentElement) {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(T)) vars[`--${kebab(k)}`] = v;
  // the letter colours (moves, rounds and matches share them): --letter-splus, --letter-s … --letter-f
  for (const [l, c] of Object.entries(LETTER_COLOR)) vars[`--letter-${l === 'S+' ? 'splus' : l.toLowerCase()}`] = c;
  Object.assign(vars, {
    '--overlay': OVERLAY, '--font-display': FONT_DISPLAY, '--font-ui': FONT_UI,
    // older names, kept so every existing rule picks up the new palette
    '--bg': T.bg0, '--panel': T.surface1, '--panel2': T.surface2, '--line': T.border,
    '--text': T.text1, '--muted': T.text2, '--accent': T.text1,
  });
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

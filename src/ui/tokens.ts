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
  text3: '#687384',
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

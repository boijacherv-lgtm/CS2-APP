import type { Annotation } from '../engine/notes';
import { GAME_THEME } from './tokens';

/**
 * Move marks drawn as eyes: the same eye for every mark, and what's in it says the mark (a star glint for !!, two
 * pupils for !, a plain pupil for book, a tired lid and bags for ?!, a bloodshot white for ?, a cataract for ??).
 * Each game colours them from its own accent: a worse mark is the same hue, duller and darker, never another hue.
 *
 * One SVG string serves both the page (MarkFace) and the Konva map (as an image), so the two never drift apart.
 * With `animate`, the string also carries the parts the reveal plays (styles.css, "eye reveal"): the eye opens
 * on a neutral pupil, then its mark grows in (a star, a split pupil, a sagging lid, a reddening white, a cataract)
 * while the ring draws.
 */

export type EyeGame = keyof typeof GAME_THEME;

const INK = '#0A0C10', WHITE = '#F4F1EA', SCLERA_EDGE = '#C9C4BA', LID = '#5A606C';
const EYE = 'M2.6 12Q12 3.4 21.4 12Q12 20.6 2.6 12z';

/** Iris and ring lightness per mark, best to worst: [saturation %, lightness %]. */
const IRIS: Record<Annotation, [number, number]> = { '!!': [100, 60], '!': [85, 54], book: [38, 50], '?!': [34, 42], '?': [30, 36], '??': [34, 30] };
const RING: Record<Annotation, [number, number]> = { '!!': [100, 66], '!': [90, 56], book: [20, 50], '?!': [40, 38], '?': [45, 28], '??': [30, 20] };

/** The hue (0–360) of a #rrggbb colour. */
export function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${Math.max(0, Math.min(100, l))}%)`;

/** A mark's colours in a game: the iris (base, dark edge, light centre) and the ring around the eye. */
export function eyeColors(note: Annotation, game: EyeGame) {
  const h = hueOf(GAME_THEME[game].accent), [s, l] = IRIS[note], [rs, rl] = RING[note];
  return { iris: hsl(h, s, l), irisDark: hsl(h, s, Math.max(10, l - 20)), irisLight: hsl(h, s, Math.min(85, l + 16)), ring: hsl(h, rs, rl), hue: h };
}

/** The game the page is dressed in (tokens.applyGameTheme sets it on <html>); CS2 for the site's own pages. */
export function pageGame(): EyeGame {
  const g = typeof document === 'undefined' ? undefined : document.documentElement.dataset.game;
  return g && g in GAME_THEME ? g as EyeGame : 'cs2';
}

const glint = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity=".9"/>`;
const FIBRES = '<path d="M12 7V9.2M15.3 8.4l-1.2 1.4M16.8 11.6h-1.7M15.3 15.4l-1.2-1.4M12 17v-2.2M8.7 15.4l1.2-1.4M7.2 11.6h1.7M8.7 8.4l1.2 1.4" stroke="#fff" stroke-opacity=".32" stroke-width=".55" stroke-linecap="round"/>';
const PUPIL = `<circle cx="12" cy="12" r="2.2" fill="${INK}"/>${glint(13.9, 10, 1)}`;

/** What's in the eye for each mark, drawn over the iris (inside the eye's clip). `id` keeps gradient ids unique. */
const STATE: Record<Annotation, (id: string) => string> = {
  '!!': () => `<circle cx="12" cy="12" r="2.1" fill="${INK}"/><g class="eye-star"><path d="M12 7.2L12.8 11.2L16.8 12L12.8 12.8L12 16.8L11.2 12.8L7.2 12L11.2 11.2z" fill="#fff"/><circle cx="12" cy="12" r="1" fill="#fff"/></g><circle cx="14.6" cy="9.6" r=".6" fill="#fff"/>`,
  '!': () => `<ellipse class="eye-p1" cx="10.6" cy="11.4" rx="1.55" ry="1.75" fill="${INK}"/><ellipse class="eye-p2" cx="13.6" cy="12.8" rx="1.35" ry="1.5" fill="${INK}"/>${glint(14.4, 9.9, 0.8)}`,
  book: () => PUPIL,
  '?!': id => `<path class="eye-blush" d="M2 13Q12 20 22 13V22H2z" fill="#C98A8A" fill-opacity=".35"/><g class="eye-droop"><circle cx="12" cy="12.6" r="1.8" fill="${INK}"/>${glint(13.4, 13.4, 0.5)}</g>`
    + `<defs><linearGradient id="lid${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2430"/><stop offset="1" stop-color="#4A3E52"/></linearGradient></defs>`
    + `<g class="eye-heavy"><path d="M1 1H23V12.2Q12 8.8 1 12.2z" fill="url(#lid${id})"/><path d="M2.6 12.2Q12 8.8 21.4 12.2" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/></g>`,
  '?': () => `<circle class="eye-dilate" cx="12" cy="12" r="2.6" fill="${INK}"/>${glint(13.9, 10, 0.7)}`,
  '??': id => `<defs><radialGradient id="cl${id}"><stop offset="0" stop-color="#F7F8FA" stop-opacity=".95"/><stop offset=".55" stop-color="#E4E8EE" stop-opacity=".8"/><stop offset="1" stop-color="#E4E8EE" stop-opacity="0"/></radialGradient></defs><circle class="eye-cloud" cx="12" cy="12" r="3.6" fill="url(#cl${id})"/>`,
};

/** A bloodshot white for ?, under the iris. */
const bloodshot = (id: string) => `<defs><radialGradient id="rd${id}" cx="50%" cy="50%" r="55%"><stop offset=".35" stop-color="#F2B8B4"/><stop offset=".8" stop-color="#E0565A"/><stop offset="1" stop-color="#B8202A"/></radialGradient></defs><path class="eye-blood" d="${EYE}" fill="url(#rd${id})"/>`
  + '<g class="eye-veins" stroke="#B0141E" fill="none" stroke-linecap="round" stroke-width=".7"><path d="M2.8 12q2.4-.8 4.2-.2l1.2-1.6M3.6 13q2-.2 3.4.8l.8 1M4.4 10.6q1.4.2 2.4 1.2M5 14.6q1.4-.6 2.4.2M6.4 9.4l.6 1.4"/><path d="M21.2 12q-2.4-.8-4.2-.2l-1.2-1.6M20.4 13q-2-.2-3.4.8l-.8 1M19.6 10.6q-1.4.2-2.4 1.2M19 14.6q-1.4-.6-2.4.2M17.6 9.4l-.6 1.4"/></g>';
/** Outside the eye: bags under it (?!) and lashes over it (!!). */
const BAGS = '<path d="M3.4 13.2Q12 23.4 20.6 13.2Q12 26.2 3.4 13.2z" fill="#3E2F4C" fill-opacity=".85"/><path d="M4.4 15.6Q12 23.8 19.6 15.6" fill="none" stroke="#5E4A72" stroke-width=".8" stroke-opacity=".8"/><path d="M6 18.2Q12 23.6 18 18.2" fill="none" stroke="#5E4A72" stroke-width=".6" stroke-opacity=".55"/>';
const LASHES = `<path d="M6.6 6.4L5.6 4.4M9.4 5.2L9 3M12 4.8V2.6M14.6 5.2L15 3M17.4 6.4l1-2" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`;

/** A class per mark, so each plays its own reveal. */
const SLUG: Record<Annotation, string> = { '!!': 'brilliant', '!': 'great', book: 'book', '?!': 'tired', '?': 'red', '??': 'cataract' };

/** The eye's box: 28 units around the 24-unit eye, room for the ring, the lashes and the bags. */
export const EYE_VIEWBOX = '-2 -2 28 28';

/**
 * A mark's eye as an SVG string (no width/height: the caller sizes it). `id` must be unique on the page when several
 * eyes share it (their gradients and clip paths are referenced by id). `animate` adds the reveal's parts.
 * Only fixed markup goes in: titles and labels (they hold player names from demos) stay on the caller's element.
 */
export function eyeSvg(note: Annotation, game: EyeGame, id: string, animate = false): string {
  const c = eyeColors(note, game);
  const iris = `<defs><radialGradient id="ir${id}"><stop offset=".3" stop-color="${c.irisLight}"/><stop offset=".75" stop-color="${c.iris}"/><stop offset="1" stop-color="${c.irisDark}"/></radialGradient></defs>`
    + `<circle cx="12" cy="12" r="5.6" fill="url(#ir${id})"/><circle cx="12" cy="12" r="5.15" fill="none" stroke="${INK}" stroke-opacity=".6" stroke-width=".9"/>${FIBRES}`;
  const glow = note === '!!' ? `<defs><filter id="gw${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1"/></filter></defs><path class="eye-glow" d="${EYE}" fill="none" stroke="${c.ring}" stroke-width="4.5" filter="url(#gw${id})" opacity=".9"/>` : '';
  const outside = note === '?!' ? BAGS : note === '!!' ? LASHES : '';
  // the mark's own look; when animated, the eye opens on a neutral pupil and the state grows over it (styles.css)
  const state = (note === '?' ? bloodshot(id) : '') + iris + STATE[note](id);
  const inside = animate && note !== '?' && note !== 'book' ? `<g class="eye-neutral">${iris}${PUPIL}</g><g class="eye-state">${state}</g>` : state;
  // the lid: grey, not black, so a shut eye reads as a shut eye; it hangs from the eye's top and drops to its bottom
  const lid = animate ? `<path class="eye-lid" d="M2 7.6H22V16.6H2z" fill="${LID}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${EYE_VIEWBOX}"${animate ? ` class="eye-anim eye-${SLUG[note]}"` : ''} aria-hidden="true">`
    + `<defs><radialGradient id="sc${id}" cx="50%" cy="40%" r="60%"><stop offset=".6" stop-color="${WHITE}"/><stop offset="1" stop-color="${SCLERA_EDGE}"/></radialGradient><clipPath id="cp${id}"><path d="${EYE}"/></clipPath></defs>`
    + `<g class="eye-out">${outside}</g>${glow}`
    + `<path class="eye-ring" d="${EYE}" pathLength="1" fill="none" stroke="${c.ring}" stroke-width="4.4" stroke-linejoin="round"/>`
    + `<path d="${EYE}" fill="url(#sc${id})"/><g clip-path="url(#cp${id})">${inside}${lid}</g>`
    + `<path d="${EYE}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

import type { Annotation } from '../engine/recap';

/**
 * The marks as little faces (in place of !! ! ?! ? ??), drawn once as SVG paths on a 24×24 grid so the page (MarkFace)
 * and the Konva map (Board, Nades) draw the same thing. The coloured disc behind is the mark's colour; these are the
 * features on it. Placeholders until the final drawings: star-eyes, smile, puzzled, frown, poop, and a straight face
 * for book.
 */
export interface FacePart { d: string; fill?: string; stroke?: string; width?: number }

const INK = '#141414', POO = '#6B4226', WHITE = '#FFFFFF';
const dot = (cx: number, cy: number, r: number) => `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
const star = (x: number, y: number, s = 2.3, w = 0.75) => `M${x},${y - s}L${x + w},${y - w}L${x + s},${y}L${x + w},${y + w}L${x},${y + s}L${x - w},${y + w}L${x - s},${y}L${x - w},${y - w}Z`;
const eyes = dot(8.6, 10, 1.35) + dot(15.4, 10, 1.35);

export const FACE: Record<Annotation, FacePart[]> = {
  '!!': [
    { d: star(8.4, 9.6) + star(15.6, 9.6), fill: INK },
    { d: 'M6.8,13.3Q12,20.5 17.2,13.3Z', fill: INK },
  ],
  '!': [
    { d: eyes, fill: INK },
    { d: 'M7.6,13.9Q12,18.2 16.4,13.9', stroke: INK, width: 1.7 },
  ],
  '?!': [
    { d: eyes, fill: INK },
    { d: 'M6.6,7.1L10.2,7.4M13.9,6.7L17.3,5.5', stroke: INK, width: 1.4 },
    { d: 'M7.8,15.6Q9.9,13.9 12,15.6T16.2,15.6', stroke: INK, width: 1.6 },
  ],
  '?': [
    { d: eyes, fill: INK },
    { d: 'M7.9,16.6Q12,12.9 16.1,16.6', stroke: INK, width: 1.7 },
  ],
  '??': [
    { d: 'M5,17.6C5,15.6 6.9,15 8,15C7.5,13.1 9.4,12 10.5,12.2C10,10.1 11.9,8.6 13.5,9C14.6,7.6 13.3,6 12.5,5.7C15.6,5.7 16.9,8 15.9,10.2C17.6,10.5 18.1,12.5 17.1,13.8C18.9,14 19.5,15.6 19,17.6C18.6,18.9 17.4,19.1 12,19.1C6.6,19.1 5.4,18.9 5,17.6Z', fill: POO },
    { d: dot(10.1, 15.3, 1.15) + dot(14, 15.3, 1.15), fill: WHITE },
    { d: dot(10.3, 15.5, 0.55) + dot(14.2, 15.5, 0.55), fill: INK },
    { d: 'M10.9,17.5Q12.05,18.2 13.2,17.5', stroke: INK, width: 1 },
  ],
  book: [
    { d: eyes, fill: INK },
    { d: 'M8.6,15.2L15.4,15.2', stroke: INK, width: 1.7 },
  ],
};

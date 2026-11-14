import type { BlastField } from '../engine/blast';

/** The field as a picture (one pixel a cell, red, stronger where it hurts more), for the board. */
export function blastCanvas(f: BlastField): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
  const g = c.getContext('2d'); if (!g) return null;
  const img = g.createImageData(f.w, f.h);
  for (let i = 0; i < f.dmg.length; i++) {
    const v = f.dmg[i]; if (v <= 0) continue;
    const k = Math.min(1, v / 100), o = i * 4;   // 100 damage already reads as a full-HP threat
    img.data[o] = 255; img.data[o + 1] = 59; img.data[o + 2] = 48; img.data[o + 3] = Math.round(35 + 150 * k);
  }
  g.putImageData(img, 0, 0);
  return c;
}

import { describe, expect, it } from 'vitest';
import { blastField, blastDamageAt } from '../blast';
import { CELL, type MapGrid } from '../grid';

/** A tiny grid: a corridor, a wall column, and a room round a corner. */
function grid(rows: string[]): MapGrid {
  const h = rows.length, w = rows[0].length, walk = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== '#') walk[y * w + x] = 1; }));
  return { w, h, walk, idx: (p: { x: number; y: number }) => { const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL); return cx < 0 || cy < 0 || cx >= w || cy >= h ? -1 : cy * w + cx; } } as unknown as MapGrid;
}
const at = (x: number, y: number) => ({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL });

describe('blast model', () => {
  const g = grid(['..........', '.####.####', '..........']);
  it('is strongest at the bomb, weaker with distance, and zero on walls', () => {
    const f = blastField(g, at(0, 0), 20);
    expect(blastDamageAt(f, at(0, 0))).toBeGreaterThan(blastDamageAt(f, at(5, 0)));
    expect(blastDamageAt(f, at(2, 1))).toBe(0);   // a wall
  });
  it('goes round a wall, not through it: the far side of a wall is reached by the long way only', () => {
    const f = blastField(g, at(0, 0), 20), straight = blastDamageAt(f, at(0, 0)) - blastDamageAt(f, at(2, 0));
    const around = blastDamageAt(f, at(2, 2));   // two cells below, past the wall: reached via the corridor ends
    expect(around).toBeLessThan(blastDamageAt(f, at(2, 0)));
    expect(straight).toBeGreaterThan(0);
  });
});

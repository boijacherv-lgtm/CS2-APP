import { CELL, type MapGrid } from './grid';
import type { Vec2 } from './types';

/**
 * The C4's blast as an estimate (round 10, B3). Since CS2's July 2026 update the blast is a shockwave that follows open
 * paths from the plant spot: walls stop it and corners weaken it (the old model was two circles through walls). Valve's
 * exact numbers are baked into its maps and not public, so this is an ESTIMATE: it spreads over the walkable grid
 * (8 neighbours, real step lengths); each turn of more than 45° costs extra distance (a corner), and the damage falls from 500
 * at the bomb to nothing at 1750 units of such distance (the old model's reach). Never through a wall, never on one.
 */
export const BLAST_MAX_DAMAGE = 500, BLAST_REACH_U = 1750, CORNER_COST_U = 140;

export interface BlastField { w: number; h: number; /** expected damage per cell (0 where nothing reaches or it's a wall) */ dmg: Float32Array }

/** `unitsPerPx`: world units in one radar px (a cell is CELL px). */
export function blastField(grid: MapGrid, origin: Vec2, unitsPerPx: number): BlastField {
  const { w, h } = grid, dist = new Float64Array(w * h).fill(Infinity), settled = new Uint8Array(w * h), dir = new Int8Array(w * h).fill(-1);
  const start = grid.idx(origin);
  const step = CELL * unitsPerPx;
  const dmg = new Float32Array(w * h);
  if (start < 0) return { w, h, dmg };
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  // Dijkstra on the cells (a binary heap, each cell settled once). A plain queue that re-queues a cell every time a shorter way is
  // found (label-correcting, with distances rounded to 32 bits so "shorter" stayed true) grew without end on open maps (Dust II, Anubis, Overpass, Inferno: millions of entries, then
  // "Invalid array length" and a crashed page when a bomb was planted); the turn cost depends on the way a cell was reached, so the
  // answer here is the cheapest way found when the cell is settled, which is the estimate this model needs.
  const hd: number[] = [], hi: number[] = []; // heap of (distance, cell)
  const push = (d: number, i: number) => {
    let k = hd.length; hd.push(d); hi.push(i);
    while (k > 0) { const p = (k - 1) >> 1; if (hd[p] <= d) break; hd[k] = hd[p]; hi[k] = hi[p]; k = p; }
    hd[k] = d; hi[k] = i;
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [hd[0], hi[0]], d = hd.pop()!, i = hi.pop()!;
    if (hd.length) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1; if (c >= hd.length) break;
        if (c + 1 < hd.length && hd[c + 1] < hd[c]) c++;
        if (hd[c] >= d) break;
        hd[k] = hd[c]; hi[k] = hi[c]; k = c;
      }
      hd[k] = d; hi[k] = i;
    }
    return top;
  };
  dist[start] = 0; push(0, start);
  while (hd.length) {
    const [dcur, i] = pop();
    if (settled[i]) continue; // an older, longer entry for a cell that is already settled
    settled[i] = 1;
    const cx = i % w, cy = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!grid.walk[j] || settled[j]) continue;
      // a diagonal squeezing between two walls is blocked
      if (d % 2 === 1 && (!grid.walk[cy * w + nx] || !grid.walk[ny * w + cx])) continue;
      const turn = dir[i] < 0 ? 0 : Math.min((d - dir[i] + 8) % 8, (dir[i] - d + 8) % 8);
      const cost = (d % 2 ? 1.4142 : 1) * step + (turn >= 2 ? CORNER_COST_U : 0);
      const nd = dcur + cost;
      if (nd < dist[j] && nd < BLAST_REACH_U) { dist[j] = nd; dir[j] = d; push(nd, j); }
    }
  }
  for (let i = 0; i < dmg.length; i++) if (dist[i] < BLAST_REACH_U) dmg[i] = BLAST_MAX_DAMAGE * (1 - dist[i] / BLAST_REACH_U);
  return { w, h, dmg };
}

/** The expected damage at a point (0 outside the shockwave). */
export function blastDamageAt(f: BlastField, p: Vec2): number {
  const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
  return cx < 0 || cy < 0 || cx >= f.w || cy >= f.h ? 0 : f.dmg[cy * f.w + cx];
}

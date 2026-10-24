import type { FloorShape, MapDefinition, PackedGrid, Utility, Vec2 } from './types';

/**
 * Walkability grid derived from the official radar (or hand-drawn floor shapes).
 * Drives both pathing (Dijkstra => travel times) and line-of-sight (ray marching).
 */
export const CELL = 4; // radar px per cell (= 20 world units on Mirage)

export class MapGrid {
  readonly w: number;
  readonly h: number;
  readonly walk: Uint8Array;

  constructor(readonly map: MapDefinition) {
    this.w = Math.ceil(map.radar.sizePx / CELL);
    this.h = this.w;
    this.walk = map.grid ? unpack(map.grid, this.w * this.h) : new Uint8Array(this.w * this.h);
    if (map.floor)
      for (let cy = 0; cy < this.h; cy++)
        for (let cx = 0; cx < this.w; cx++) {
          const p = { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
          if (map.floor.some(s => insideShape(p, s))) this.walk[cy * this.w + cx] = 1;
        }
    for (const wall of map.walls ?? []) this.carve(wall);
  }

  /** Mark cells along a polyline as solid. */
  private carve(pts: Vec2[]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2));
      for (let s = 0; s <= steps; s++) {
        const j = this.idx({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
        if (j >= 0) this.walk[j] = 0;
      }
    }
  }

  /** Doorway segment through `at` across direction `angle` (radians), clipped to walls. */
  fitPortalAt(at: Vec2, angle: number, maxHalf = 70): [Vec2, Vec2] {
    const d = { x: Math.cos(angle), y: Math.sin(angle) };
    const reach = (sign: number) => {
      let len = 0;
      while (len < maxHalf && this.isWalkable({ x: at.x + d.x * sign * (len + 1), y: at.y + d.y * sign * (len + 1) })) len++;
      return len;
    };
    const lo = reach(-1), hi = reach(1);
    return [{ x: at.x - d.x * lo, y: at.y - d.y * lo }, { x: at.x + d.x * hi, y: at.y + d.y * hi }];
  }

  /** Fit a doorway segment through `at`, extended along `axis` until it hits walls. */
  fitPortal(at: Vec2, axis: 'h' | 'v', maxHalf = 70): [Vec2, Vec2] {
    const d = axis === 'h' ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const reach = (sign: number) => {
      let len = 0;
      while (len < maxHalf && this.isWalkable({ x: at.x + d.x * sign * (len + 1), y: at.y + d.y * sign * (len + 1) })) len++;
      return len;
    };
    const lo = reach(-1), hi = reach(1);
    return [{ x: at.x - d.x * lo, y: at.y - d.y * lo }, { x: at.x + d.x * hi, y: at.y + d.y * hi }];
  }

  idx(p: Vec2) {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1;
    return cy * this.w + cx;
  }

  isWalkable(p: Vec2) {
    const i = this.idx(p);
    return i >= 0 && this.walk[i] === 1;
  }

  /** Nearest walkable cell index to p (players dropped slightly off-floor still work). */
  snap(p: Vec2): number {
    const i = this.idx(p);
    if (i >= 0 && this.walk[i]) return i;
    let best = -1, bestD = Infinity;
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    for (let dy = -20; dy <= 20; dy++)
      for (let dx = -20; dx <= 20; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const j = y * this.w + x;
        if (this.walk[j] && dx * dx + dy * dy < bestD) { bestD = dx * dx + dy * dy; best = j; }
      }
    return best;
  }

  /**
   * Multi-source Dijkstra over 8-connected cells. Returns path length in radar px
   * from the nearest source to every cell (Infinity where unreachable).
   * `start` gives each source a head start (in px); `blocked` cells can't be entered.
   */
  distanceField(sources: Vec2[], opts: { blocked?: Uint8Array; start?: number[] } = {}): Float64Array {
    const n = this.w * this.h;
    const d = new Float64Array(n).fill(Infinity);
    const heap = new MinHeap();
    sources.forEach((s, k) => {
      const i = this.snap(s);
      const d0 = opts.start?.[k] ?? 0;
      if (i >= 0 && d0 < d[i]) { d[i] = d0; heap.push(i, d0); }
    });
    const blocked = opts.blocked;
    const diag = Math.SQRT2 * CELL;
    while (heap.size) {
      const [i, di] = heap.pop();
      if (di > d[i]) continue;
      const x = i % this.w, y = (i / this.w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const j = ny * this.w + nx;
          if (!this.walk[j] || (blocked && blocked[j])) continue;
          // no corner cutting through walls
          if (dx && dy && (!this.walk[y * this.w + nx] || !this.walk[ny * this.w + x])) continue;
          const nd = di + (dx && dy ? diag : CELL);
          if (nd < d[j]) { d[j] = nd; heap.push(j, nd); }
        }
    }
    return d;
  }

  /**
   * Cells visible from `origin` inside the cone [facing ± fov/2], by dense ray casting.
   * Calls `mark(cellIndex)` once per ray step; callers dedupe with a stamp array.
   */
  castVision(origin: Vec2, facing: number, fov: number, smokes: SmokeDisc[], mark: (i: number) => void, maxLen = 1100, rays = Math.ceil(fov * 520)) {
    const step = CELL * 0.5;
    for (let r = 0; r <= rays; r++) {
      const ang = facing - fov / 2 + (r / rays) * fov;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      for (let len = 0; len < maxLen; len += step) {
        const p = { x: origin.x + dx * len, y: origin.y + dy * len };
        const i = this.idx(p);
        if (i < 0 || !this.walk[i]) break;
        if (smokes.length && smokes.some(s => (p.x - s.pos.x) ** 2 + (p.y - s.pos.y) ** 2 < s.r * s.r)) break;
        mark(i);
      }
    }
  }

  /**
   * Walkable path a -> b (A* over 8-connected cells), string-pulled into straight legs.
   * Returns null when b can't be reached from a.
   */
  shortestPath(a: Vec2, b: Vec2, blocked?: Uint8Array): Vec2[] | null {
    const s0 = this.snap(a), goal = this.snap(b);
    if (s0 < 0 || goal < 0) return null;
    const n = this.w * this.h;
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const gx = goal % this.w, gy = (goal / this.w) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % this.w) - gx), dy = Math.abs(((i / this.w) | 0) - gy);
      return CELL * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
    };
    const heap = new MinHeap();
    g[s0] = 0;
    heap.push(s0, h(s0));
    const diag = Math.SQRT2 * CELL;
    while (heap.size) {
      const [i] = heap.pop();
      if (i === goal) break;
      const x = i % this.w, y = (i / this.w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const j = ny * this.w + nx;
          if (!this.walk[j] || (blocked && blocked[j] && j !== goal)) continue;
          if (dx && dy && (!this.walk[y * this.w + nx] || !this.walk[ny * this.w + x])) continue;
          const ng = g[i] + (dx && dy ? diag : CELL);
          if (ng < g[j]) { g[j] = ng; parent[j] = i; heap.push(j, ng + h(j)); }
        }
    }
    if (!Number.isFinite(g[goal])) return null;
    const cells: Vec2[] = [];
    for (let i = goal; i !== -1; i = parent[i]) cells.push({ x: ((i % this.w) + 0.5) * CELL, y: (((i / this.w) | 0) + 0.5) * CELL });
    cells.reverse();
    cells[0] = this.isWalkable(a) ? a : cells[0];
    cells[cells.length - 1] = this.isWalkable(b) ? b : cells[cells.length - 1];
    // string-pull: jump to the farthest point still in a straight walkable line
    const out = [cells[0]];
    let k = 0;
    while (k < cells.length - 1) {
      let j = k + 1;
      while (j + 1 < cells.length && this.lineOfSight(cells[k], cells[j + 1])) j++;
      out.push(cells[j]);
      k = j;
    }
    return out;
  }

  at(field: Float64Array, p: Vec2) {
    const i = this.snap(p);
    return i >= 0 ? field[i] : Infinity;
  }

  /** True when the straight segment a->b stays on walkable floor and crosses no active smoke. */
  lineOfSight(a: Vec2, b: Vec2, smokes: SmokeDisc[] = []): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(len / (CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (!this.isWalkable(p)) return false;
    }
    return !smokes.some(sm => segmentHitsCircle(a, b, sm.pos, sm.r));
  }

  /**
   * Visibility polygon by casting rays until they hit a wall or smoke.
   * With `cone` = [facing, fov] only that wedge is cast and the polygon starts at the origin.
   */
  visibilityPolygon(origin: Vec2, smokes: SmokeDisc[] = [], cone?: [number, number], rays = 540, maxLen = 1100): number[] {
    const out: number[] = cone ? [origin.x, origin.y] : [];
    const step = CELL * 0.5;
    const from = cone ? cone[0] - cone[1] / 2 : 0, span = cone ? cone[1] : Math.PI * 2;
    const n = cone ? Math.ceil((rays * span) / (Math.PI * 2)) + 1 : rays;
    for (let r = 0; r < n; r++) {
      const ang = from + (cone ? (r / (n - 1)) * span : (r / rays) * span);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let len = 0;
      while (len < maxLen) {
        const p = { x: origin.x + dx * (len + step), y: origin.y + dy * (len + step) };
        if (!this.isWalkable(p) || smokes.some(s => Math.hypot(p.x - s.pos.x, p.y - s.pos.y) < s.r)) break;
        len += step;
      }
      out.push(origin.x + dx * len, origin.y + dy * len);
    }
    return out;
  }
}

export interface SmokeDisc { pos: Vec2; r: number }

/** Default release-to-pop time per grenade type. */
export const DEFAULT_FLIGHT: Record<Utility['type'], number> = { smoke: 1.5, molotov: 1.5, flash: 1.2, he: 1.6 };
/** Round time at which a grenade pops (smoke blooms, flash/HE explode, molotov lands). */
export const popAt = (u: Pick<Utility, 'throwAt' | 'flight' | 'type'>) => u.throwAt + (u.flight ?? DEFAULT_FLIGHT[u.type]);

export const SMOKE_RADIUS_UNITS = 144;
export const SMOKE_DURATION = 18;
export const MOLLY_DURATION = 7;
export const UTIL_FLIGHT = 1.5;
/** How long a smoke or fire lasts once it pops (a demo knows the real value: cleared or extinguished early). */
export const lifeOf = (u: Pick<Utility, 'type' | 'duration'>) => u.duration ?? (u.type === 'smoke' ? SMOKE_DURATION : u.type === 'molotov' ? MOLLY_DURATION : 0);

/**
 * CS2's smokes are a volume an HE blast pushes away: a hole that stays open a moment, then fills back in. Seconds
 * (approximate, from watching the game): fully open for `open`, filling back over `refill`.
 */
export const SMOKE_CLEAR = { open: 1.2, refill: 1.8 };

/** The HE grenades that went off inside this smoke while it was up: when, and where (radar px). */
export function smokeBlasts(smoke: Utility, util: Utility[], unitsPerPx: number): { t: number; pos: Vec2 }[] {
  if (smoke.type !== 'smoke') return [];
  const from = popAt(smoke), to = from + lifeOf(smoke), r = SMOKE_RADIUS_UNITS / unitsPerPx;
  return util.filter(h => h.type === 'he' && popAt(h) >= from && popAt(h) <= to && Math.hypot(h.pos.x - smoke.pos.x, h.pos.y - smoke.pos.y) <= r * 1.1)
    .map(h => ({ t: popAt(h), pos: h.pos }));
}

/** How far a smoke is blown open at round time t (0 = whole, 1 = wide open), and by which blast. */
export function smokeOpenAt(smoke: Utility, util: Utility[], t: number, unitsPerPx: number): { open: number; at: Vec2 | null } {
  let best = { open: 0, at: null as Vec2 | null };
  for (const b of smokeBlasts(smoke, util, unitsPerPx)) {
    const s = t - b.t;
    const open = s < 0 ? 0 : s <= SMOKE_CLEAR.open ? 1 : Math.max(0, 1 - (s - SMOKE_CLEAR.open) / SMOKE_CLEAR.refill);
    if (open > best.open) best = { open, at: b.pos };
  }
  return best;
}

/** Smokes whose bloom is active at round time t (and not blown open by an HE right now: you can see through then). */
export function activeSmokes(util: Utility[], t: number, unitsPerPx: number): SmokeDisc[] {
  return util
    .filter(u => u.type === 'smoke' && t >= popAt(u) && t <= popAt(u) + lifeOf(u) && smokeOpenAt(u, util, t, unitsPerPx).open < 0.5)
    .map(u => ({ pos: u.pos, r: SMOKE_RADIUS_UNITS / unitsPerPx }));
}

function unpack(g: PackedGrid, n: number) {
  const bin = atob(g.bits);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

function insideShape(p: Vec2, s: FloorShape): boolean {
  switch (s.kind) {
    case 'rect': return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
    case 'poly': return pointInPoly(p, s.pts);
    case 'path':
      for (let i = 0; i < s.pts.length - 1; i++)
        if (distToSegment(p, s.pts[i], s.pts[i + 1]) <= s.w / 2) return true;
      return false;
  }
}

export function pointInPoly(p: Vec2, pts: Vec2[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function segmentHitsCircle(a: Vec2, b: Vec2, c: Vec2, r: number) {
  return distToSegment(c, a, b) < r;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    this.ids.push(id); this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.ids[0], this.keys[0]];
    const lastId = this.ids.pop()!, lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId; this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(i: number, j: number) {
    [this.ids[i], this.ids[j]] = [this.ids[j], this.ids[i]];
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
  }
}

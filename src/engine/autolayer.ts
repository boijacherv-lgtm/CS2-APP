import { CELL, MapGrid } from './grid';
import type { StrategyArchetype } from './strategies';
import type { Callout, Chokepoint, SiteId, Vec2 } from './types';

/**
 * Derives a tactical layer from map geometry alone: the distinct T lanes into each
 * bombsite, the chokepoint on each lane CTs can hold, T strategies built from those
 * lanes, and CT hold spots. Used for maps without a hand-authored layer.
 */

export interface Lane {
  site: SiteId;
  path: Vec2[];
  chokeId: string;
  tArrive: number; // T arrival at the choke (s)
}

export interface AutoLayer {
  chokepoints: Chokepoint[];
  lanes: Lane[];
  strats: StrategyArchetype[];
  holds: Record<string, Vec2>; // chokeId -> CT hold spot
  tPlays: Record<string, { at: [number, number]; via: [number, number][]; start?: number; mode?: 'run' | 'walk'; weapon?: import('./types').Weapon }[]>;
  presets: Record<string, [number, number][]>;
}

interface Inputs {
  grid: MapGrid;
  tSpawns: Vec2[];
  sites: Record<SiteId, Vec2>;
  tTime: Float64Array; // seconds, T rifle from spawn
  ctTime: Float64Array; // seconds, CT rifle from spawn
  names: Callout[]; // optional callout hints used to name chokes
  /** Sites that can't be analysed on this level (e.g. Nuke's B is on the lower radar). */
  skipSites?: SiteId[];
}

const MAX_LANES = 3;
const CORRIDOR_PX = 22; // half-width of the corridor blocked around a found lane
const MAX_DETOUR = 2.0; // a lane longer than this × the shortest one isn't a real option
const MERGE_PX = 34;
const MAX_HALF_PX = 45; // chokes closer than this are the same doorway

export function buildAutoLayer(inp: Inputs): AutoLayer {
  const { grid } = inp;
  const at = (f: Float64Array, p: Vec2) => grid.at(f, p);
  const lanes: Lane[] = [];
  const chokes: (Chokepoint & { at: Vec2 })[] = [];

  for (const site of ['A', 'B'] as SiteId[]) {
    if (inp.skipSites?.includes(site)) continue;
    const goal = inp.sites[site];
    const start = inp.tSpawns[0];
    if (!start || !goal) continue;
    const blocked = new Uint8Array(grid.w * grid.h);
    let firstLen = Infinity;
    const found: Vec2[][] = [];
    for (let k = 0; k < MAX_LANES; k++) {
      const path = grid.shortestPath(start, goal, blocked);
      if (!path) break;
      const dense = densify(path, CELL);
      const len = dense.length * CELL;
      if (k === 0) firstLen = len;
      else if (len > firstLen * MAX_DETOUR) break;
      if (found.some(f => overlap(f, dense) > 0.6)) break;
      found.push(dense);
      // block the middle of this lane so the next search must find another way in
      const n = dense.length;
      for (let i = Math.floor(n * 0.4); i < Math.floor(n * 0.92); i++) stamp(grid, blocked, dense[i], CORRIDOR_PX);
    }
    for (const dense of found) {
      const c = pickChoke(grid, dense, inp, goal);
      if (!c) continue;
      let choke = chokes.find(x => Math.hypot(x.at.x - c.at.x, x.at.y - c.at.y) < MERGE_PX);
      if (!choke) {
        choke = { id: `auto_${chokes.length}`, name: '', area: '', feeds: [], portal: c.portal, at: c.at };
        chokes.push(choke);
      }
      if (!choke.feeds.includes(site)) choke.feeds.push(site);
      lanes.push({ site, path: dense, chokeId: choke.id, tArrive: at(inp.tTime, c.at) });
    }
  }

  // Names: nearest callout hint, else "<site> lane N".
  const used = new Map<string, number>();
  for (const c of chokes) {
    const hint = nearest(inp.names, c.at, 90);
    const base = hint?.name ?? `${c.feeds.join('/')} lane`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    c.name = hint ? (n > 1 ? `${base} ${n}` : base) : `${base} ${n}`;
    c.area = c.feeds.length > 1 ? 'Mid' : c.name;
  }

  const holds: Record<string, Vec2> = {};
  for (const c of chokes) holds[c.id] = holdSpot(grid, c, inp) ?? c.at;

  const strats = buildStrats(chokes, lanes);
  const tPlays = buildTPlays(chokes, lanes, inp);
  const presets = buildPresets(chokes, holds, inp, grid);
  return { chokepoints: chokes.map(({ at: _at, ...c }) => c), lanes, strats, holds, tPlays, presets };
}

/** The narrowest point on a lane that CTs can reach before the Ts. */
function pickChoke(grid: MapGrid, path: Vec2[], inp: Inputs, goal: Vec2) {
  type Cand = { at: Vec2; portal: [Vec2, Vec2]; width: number };
  let best: Cand | null = null;
  let fallback: Cand | null = null;
  const n = path.length;
  for (let i = Math.floor(n * 0.25); i < n - 4; i += 2) {
    const p = path[i];
    if (Math.hypot(p.x - goal.x, p.y - goal.y) < 40) break; // that's the site itself
    const dir = Math.atan2(path[Math.min(n - 1, i + 3)].y - path[Math.max(0, i - 3)].y, path[Math.min(n - 1, i + 3)].x - path[Math.max(0, i - 3)].x);
    const portal = grid.fitPortalAt(p, dir + Math.PI / 2, MAX_HALF_PX);
    const width = Math.hypot(portal[1].x - portal[0].x, portal[1].y - portal[0].y);
    if (width < 10 || width >= MAX_HALF_PX * 2 - 2) continue; // open ground isn't a doorway
    const cand = { at: p, portal, width };
    if (i > n * 0.4 && (!fallback || width < fallback.width - 2)) fallback = cand;
    const ctFirst = grid.at(inp.ctTime, p) + 1 < grid.at(inp.tTime, p);
    if (ctFirst && (!best || width < best.width - 2)) best = cand;
  }
  return best ?? fallback;
}

/** A spot behind the choke with a clean sightline on it, reachable before the Ts arrive. */
function holdSpot(grid: MapGrid, c: Chokepoint & { at: Vec2 }, inp: Inputs): Vec2 | null {
  const tChoke = grid.at(inp.tTime, c.at);
  const samples = [0.15, 0.5, 0.85].map(f => ({ x: c.portal[0].x + (c.portal[1].x - c.portal[0].x) * f, y: c.portal[0].y + (c.portal[1].y - c.portal[0].y) * f }));
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (let r = 50; r <= 190; r += 20)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const p = { x: c.at.x + Math.cos(a) * r, y: c.at.y + Math.sin(a) * r };
      if (!grid.isWalkable(p)) continue;
      const ct = grid.at(inp.ctTime, p), t = grid.at(inp.tTime, p);
      // must be on the CT side of the doorway and set before the Ts get there
      if (!(ct + 1.5 < tChoke) || !(t > tChoke) || !(ct < grid.at(inp.ctTime, c.at))) continue;
      const seen = samples.filter(sp => grid.lineOfSight(p, sp)).length;
      if (seen < 2) continue;
      const score = seen * 2 + Math.min(r, 140) / 60 + (t - tChoke) * 0.2;
      if (score > bestScore) { bestScore = score; best = p; }
    }
  return best;
}

function buildStrats(chokes: (Chokepoint & { at: Vec2 })[], lanes: Lane[]): StrategyArchetype[] {
  const out: StrategyArchetype[] = [];
  const name = (id: string) => chokes.find(c => c.id === id)!.name;
  for (const site of ['A', 'B'] as SiteId[]) {
    const ls = lanes.filter(l => l.site === site).sort((a, b) => a.tArrive - b.tArrive);
    if (!ls.length) continue;
    const [l1, l2] = ls;
    out.push({
      id: `auto_rush_${site}`, label: `${site} rush via ${name(l1.chokeId)}`, kind: 'rush', target: site, basePrior: 0.7,
      groups: [{ route: [l1.chokeId], size: 5, delay: 0, util: ['flash'] }],
      counter: `Molotov ${name(l1.chokeId)} early and get a second player on ${site} fast.`,
    });
    if (l2 && l2.chokeId !== l1.chokeId) {
      out.push({
        id: `auto_exec_${site}`, label: `${site} execute (${name(l1.chokeId)} + ${name(l2.chokeId)})`, kind: 'execute', target: site, basePrior: 1,
        groups: [
          { route: [l1.chokeId], size: 3, delay: 6, util: ['smoke', 'flash'] },
          { route: [l2.chokeId], size: 2, delay: 6, util: ['smoke', 'flash'] },
        ],
        counter: `Crossfire both ${name(l1.chokeId)} and ${name(l2.chokeId)}; keep a molotov for the plant.`,
      });
      out.push({
        id: `auto_split_${site}`, label: `${site} split (${name(l2.chokeId)} first, then ${name(l1.chokeId)})`, kind: 'split', target: site, basePrior: 0.9,
        groups: [
          { route: [l2.chokeId], size: 2, delay: 2, util: ['flash'] },
          { route: [l1.chokeId], size: 3, delay: 5, util: ['smoke', 'flash'] },
        ],
        counter: `Don't over-rotate to the first contact; ${name(l1.chokeId)} is where the main push comes.`,
      });
    } else {
      out.push({
        id: `auto_exec_${site}`, label: `${site} execute via ${name(l1.chokeId)}`, kind: 'execute', target: site, basePrior: 1,
        groups: [{ route: [l1.chokeId], size: 5, delay: 8, util: ['smoke', 'flash'] }],
        counter: `Fall back from ${name(l1.chokeId)} into a retake crossfire instead of dying alone.`,
      });
    }
  }
  return out;
}

function buildTPlays(chokes: (Chokepoint & { at: Vec2 })[], lanes: Lane[], inp: Inputs): AutoLayer['tPlays'] {
  const spawn = inp.tSpawns;
  const pt = (p: Vec2): [number, number] => [Math.round(p.x), Math.round(p.y)];
  const choke = (id: string) => chokes.find(c => c.id === id)!;
  const plays: AutoLayer['tPlays'] = {};
  for (const site of ['A', 'B'] as SiteId[]) {
    const ls = lanes.filter(l => l.site === site).sort((a, b) => a.tArrive - b.tArrive);
    if (!ls.length || spawn.length < 5) continue;
    const goal = inp.sites[site];
    const plan = ls.length > 1 && ls[1].chokeId !== ls[0].chokeId ? [ls[0], ls[0], ls[0], ls[1], ls[1]] : [ls[0], ls[0], ls[0], ls[0], ls[0]];
    plays[`${site} rush`] = spawn.slice(0, 5).map((s, i) => ({ at: pt(s), via: [pt(choke(ls[0].chokeId).at), pt(offset(goal, i))], start: i * 0.3 }));
    plays[`${site} split`] = spawn.slice(0, 5).map((s, i) => ({ at: pt(s), via: [pt(choke(plan[i].chokeId).at), pt(offset(goal, i))], start: plan[i] === ls[0] ? 4 : 1 }));
  }
  return plays;
}

function buildPresets(chokes: (Chokepoint & { at: Vec2 })[], holds: Record<string, Vec2>, inp: Inputs, grid: MapGrid): AutoLayer['presets'] {
  // always land on walkable floor (site markers can sit on a wall edge)
  const pt = (p: Vec2): [number, number] => {
    const i = grid.snap(p);
    return i < 0 ? [Math.round(p.x), Math.round(p.y)] : [((i % grid.w) + 0.5) * CELL, (Math.floor(i / grid.w) + 0.5) * CELL];
  };
  const forSite = (s: SiteId) => chokes.filter(c => c.feeds.includes(s));
  const pick = (a: number, b: number) => {
    const out: [number, number][] = [];
    const take = (s: SiteId, n: number) => {
      const cs = forSite(s);
      for (let i = 0; i < n; i++) out.push(i < cs.length ? pt(holds[cs[i].id]) : pt(offset(inp.sites[s], i + 1)));
    };
    take('A', a);
    take('B', b);
    return out;
  };
  return { 'Balanced 3-2': pick(3, 2), 'Balanced 2-3': pick(2, 3), 'Stack A': pick(4, 1), 'Stack B': pick(1, 4) };
}

const offset = (p: Vec2, i: number) => ({ x: p.x + [0, 18, -18, 0, 0, 14][i % 6], y: p.y + [0, 0, 0, 18, -18, 14][i % 6] });

function densify(path: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  out.push(path[path.length - 1]);
  return out;
}

function overlap(a: Vec2[], b: Vec2[]) {
  let close = 0;
  for (const p of b) if (a.some(q => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < 14)) close++;
  return close / b.length;
}

function stamp(grid: MapGrid, out: Uint8Array, c: Vec2, r: number) {
  const rc = Math.ceil(r / CELL), cx = Math.floor(c.x / CELL), cy = Math.floor(c.y / CELL);
  for (let dy = -rc; dy <= rc; dy++)
    for (let dx = -rc; dx <= rc; dx++) {
      if (dx * dx + dy * dy > rc * rc) continue;
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < grid.w && y < grid.h) out[y * grid.w + x] = 1;
    }
}

function nearest(list: Callout[], p: Vec2, within: number) {
  let best: Callout | undefined, bd = within;
  for (const c of list) { const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y); if (d < bd) { bd = d; best = c; } }
  return best;
}

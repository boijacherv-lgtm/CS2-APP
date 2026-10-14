import type { Simulation } from './combat';
import { CELL } from './grid';
import { gunOf } from './guns';
import { duelWin, sweepFirstSight, tTracks, utilityTilt } from './killmap';
import type { TacticalEngine } from './predict';
import type { BoardState, Player, Vec2 } from './types';

/**
 * Spot finder: "where should this CT stand?". Scores every spot the player can reach before the
 * Ts get there, on three things that decide a hold:
 *   first duel — chance to win the first fight there (T not looking your way, range, guns, utility)
 *   trade      — if you lose it, can a teammate see where the killer stands and trade?
 *   exposure   — how many Ts show up at once (two angles at the same time is a bad spot)
 */

export interface Spot {
  pos: Vec2;
  score: number; // 0..100
  firstDuel: number; // 0..1
  trade: number; // 0..1
  angles: number; // Ts appearing within 1.5 s of the first
  firstContact: number; // s
  setBy: number; // s, when the player can be standing there
  tAware: boolean; // first T is already looking at this spot
  where: string; // nearest callout
  /** Why this spot falls short (only for the player's current spot). */
  note?: string;
}

export interface SpotMap {
  playerId: string;
  /** Score per cell (0..1), NaN where the player can't be in time or nothing shows up. */
  value: Float32Array;
  best: Spot[];
  current: Spot | null;
  currentRank: number; // 1-based among candidate cells, 0 = unknown
  candidates: number;
  source: 'players' | 'default paths';
  /** Entries the player is responsible for (kept covered by every suggested spot). */
  jobs: string[];
}

/** An entry the player is holding: the suggestion has to keep it covered. */
export interface Job { name: string; portal: [Vec2, Vec2] }

const REACH_SECONDS = 5; // how far around the player to look (walking time)
const SET_MARGIN = 1; // need to be standing there this long before the first T shows up
const TRADE_PER_MATE = 0.6;
const MIN_SPACING_PX = 60; // keep the top spots distinct

export function computeSpots(engine: TacticalEngine, board: BoardState, sim: Simulation | null, player: Player, jobs: Job[] = []): SpotMap {
  const g = engine.grid;
  const n = g.w * g.h;
  const scale = engine.map.radar.scale;
  const gun = gunOf(player);
  const { tracks, source } = tTracks(engine, board, sim);
  const { first, aware, distU, tPos } = sweepFirstSight(engine, board, tracks);
  const mates = board.players.filter(p => p.side === 'CT' && p.id !== player.id);
  const util = board.utility.filter(u => u.type !== 'smoke');

  // walking time from the player's spot, and when they could be anywhere from spawn
  const kWalk = (scale * engine.map.timingScale) / gun.speed;
  const fromPlayer = g.distanceField([player.pos]);
  const leave = engine.readyAt(player); // when they reach their current spot from spawn

  // a spot "does the job" if it still sees at least two of five points across each held entry
  const jobSamples = jobs.map(j => [0.1, 0.3, 0.5, 0.7, 0.9].map(f => ({ x: j.portal[0].x + (j.portal[1].x - j.portal[0].x) * f, y: j.portal[0].y + (j.portal[1].y - j.portal[0].y) * f })));
  const doesJob = (p: Vec2) => jobSamples.every(js => js.filter(q => Math.hypot(q.x - p.x, q.y - p.y) < 1000 && g.lineOfSight(p, q)).length >= 2);

  const value = new Float32Array(n).fill(NaN);
  const spots: (Spot & { i: number })[] = [];
  let earliest = Infinity;
  type Eval = (Spot & { i: number }) | { i: number; reject: string };
  const evaluate = (i: number): Eval | null => {
    if (!g.walk[i]) return null;
    const walk = fromPlayer[i] * kWalk;
    if (!(walk <= REACH_SECONDS)) return null;
    // earliest T sighting from here
    let k0 = -1, t0 = Infinity;
    for (let k = 0; k < tracks.length; k++) if (first[k][i] < t0) { t0 = first[k][i]; k0 = k; }
    if (k0 < 0) return { i, reject: 'No T ever comes into view from here.' };
    const pos = cellPos(g, i);
    const setBy = Math.min(engine.grid.at(engine.ctTime, pos), leave + walk);
    const tp = { x: tPos[k0][i * 2], y: tPos[k0][i * 2 + 1] };
    let w = duelWin(!!aware[k0][i], distU[k0][i], gun.cls, tracks[k0].weapon);
    if (util.length) w = utilityTilt(g, util, scale, t0, pos, tp, w);
    // default paths are alternative routes; placed Ts all come, so count their simultaneous angles
    const angles = source === 'players' ? tracks.filter((_, k) => first[k][i] - t0 <= 1.5).length : 1;
    const seers = mates.filter(m => Math.hypot(m.pos.x - tp.x, m.pos.y - tp.y) < 1100 && g.lineOfSight(m.pos, tp)).length;
    const trade = 1 - (1 - TRADE_PER_MATE) ** seers;
    const v = clamp01(w * (1 - 0.18 * (angles - 1)) + (1 - w) * trade * 0.45);
    const spot = { i, pos, score: Math.round(v * 100), firstDuel: w, trade, angles, firstContact: t0, setBy, tAware: !!aware[k0][i], where: nearestCallout(engine, pos) };
    if (setBy + SET_MARGIN > t0) return { ...spot, reject: `Can't be set in time: ready ${setBy.toFixed(1)}s, first T ${t0.toFixed(1)}s.` } as Eval;
    if (jobSamples.length && !doesJob(pos)) return { ...spot, reject: `Loses sight of ${jobs.map(j => j.name).join(' / ')}.` } as Eval;
    return spot;
  };

  for (let i = 0; i < n; i++) {
    const e = evaluate(i);
    if (!e || 'reject' in e) continue;
    earliest = Math.min(earliest, e.firstContact);
    spots.push(e);
  }

  // hiding deep gives Ts free ground: the later the first fight than it could be, the worse
  for (const sp of spots) {
    const late = Math.max(0, sp.firstContact - earliest - 2);
    const v = clamp01(sp.score / 100 - Math.min(0.3, 0.03 * late));
    sp.score = Math.round(v * 100);
    const ii = sp.i;
    value[ii] = v;
  }
  spots.sort((a, b) => b.score - a.score || a.firstContact - b.firstContact);
  const best: Spot[] = [];
  for (const s of spots) {
    if (best.length >= 3) break;
    if (best.some(b => Math.hypot(b.pos.x - s.pos.x, b.pos.y - s.pos.y) < MIN_SPACING_PX)) continue;
    best.push(strip(s));
  }
  // the player's own spot is always scored, with a note if it fails a requirement
  const ci = g.snap(player.pos);
  let current: Spot | null = null;
  const own = ci >= 0 ? spots.find(s => s.i === ci) ?? evaluate(ci) : null;
  if (own && 'score' in own) {
    const late = Math.max(0, own.firstContact - earliest - 2);
    const score = 'reject' in own ? Math.round(clamp01(own.score / 100 - Math.min(0.3, 0.03 * late)) * 100) : own.score;
    current = { ...strip(own as Spot & { i: number }), score, note: 'reject' in own ? (own as { reject: string }).reject : undefined };
  } else if (own && 'reject' in own) current = null;
  const currentRank = current ? 1 + spots.filter(sp => sp.score > current!.score).length : 0;
  return {
    playerId: player.id, value, best, current, currentRank,
    candidates: spots.length, source, jobs: jobs.map(j => j.name),
  };
}

const strip = ({ i: _i, ...s }: Spot & { i: number }): Spot => s;
const cellPos = (g: TacticalEngine['grid'], i: number) => ({ x: ((i % g.w) + 0.5) * CELL, y: (((i / g.w) | 0) + 0.5) * CELL });
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
function nearestCallout(engine: TacticalEngine, p: Vec2) {
  let best = '', bd = 130;
  for (const c of engine.map.callouts) { const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y); if (d < bd) { bd = d; best = c.name; } }
  return best;
}

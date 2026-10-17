// What every learner computes from one demo, in one place, plus a cache of read demos so a demo is read only once.
// The learners (train-coach, learn-spots, learn-positions, learn-analyst) and learn:all all use these, so a demo
// read by learn:all gives exactly what the learner would have computed itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseDemo } from './demo.mjs';
import { getEngine, MAPS } from '../src/map/catalog';
import { buildReplay, equipValue, evalState, reviewRound, type DemoData, type Role } from '../src/engine/recap';
import { buildMatchReport, summarizeRound, type RoundSummary } from '../src/engine/match';
import { coachFeatures, type Sample } from '../src/engine/coach';
import { worldToRadar } from '../src/engine/coords';
import { roundDecisions, type Hold, type Move } from '../src/engine/situations';
import { analyzeRound, type AnalystRound } from '../src/engine/analyst';
import { controlCounts, roundWinChance, tradePending, winFeatures } from '../src/engine/winprob';
import type { BoardState } from '../src/engine/types';

// ---- cache versions: bump when that learner's per-demo numbers are computed differently -----------------------
export const COACH_V = 3; // 3: impact leaves out positioning decisions
export const POSITIONS_V = 7; // + paths only the first 8 s after leaving a spot
export const ANALYST_V = 4; // + trade geometry: where teammates stood, where traders shot from
/** Bump when tools/demo-core.mjs reads demos differently (new fields), so saved reads are redone. */
export const PARSE_V = 4;

// ---- the demo folder -------------------------------------------------------------------------------------
/** Demos in a folder (and one level of subfolders), as paths relative to it. */
export function listDemos(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() && !d.name.startsWith('.') ? fs.readdirSync(path.join(folder, d.name)).map(f => path.join(d.name, f)) : [d.name])
    .filter(f => /\.dem(\.gz|\.zst)?$/i.test(f)).sort();
}
/** A demo's identity: its name (without the "(1)" of a second download) and size, so duplicates count once. */
export const keyOf = (folder: string, f: string) => `${f.replace(/ \(\d+\)(?=\.dem)/, '')}|${fs.statSync(path.join(folder, f)).size}`;

/**
 * A demo, read: from <folder>/.stratboard-parsed (gzipped JSON, ~0.3 s) when it was read before with this PARSE_V,
 * else with the parser (~10 s), and saved there. Reads .dem, .dem.gz and .dem.zst.
 */
export function loadDemo(folder: string, f: string): DemoData {
  const dir = path.join(folder, '.stratboard-parsed');
  const saved = path.join(dir, `v${PARSE_V}-${keyOf(folder, f).replace(/[^\w.-]+/g, '_')}.json.gz`);
  if (fs.existsSync(saved)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(saved)).toString('utf8'));
  const file = path.join(folder, f);
  let p = file, temp = false;
  if (!/\.dem$/i.test(file)) {
    const raw = fs.readFileSync(file);
    p = path.join(os.tmpdir(), `stratboard-read-${process.pid}-${Date.now()}.dem`);
    fs.writeFileSync(p, /\.zst$/i.test(file) ? zlib.zstdDecompressSync(raw) : zlib.gunzipSync(raw));
    temp = true;
  }
  try {
    const d: DemoData = parseDemo(p);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(saved, zlib.gzipSync(JSON.stringify(d)));
    return d;
  } finally { if (temp) fs.rmSync(p, { force: true }); }
}
const supported = (d: DemoData) => MAPS.some(m => m.id === d.map);

// ---- train:coach --------------------------------------------------------------------------------------------
export type CoachCached = { map: string | null; samples: (Sample & { rounds: number })[]; error?: string };
const CONTEXT: BoardState['context'] = { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } };
/** Every player with enough rounds as one coach sample: their numbers and their main role. */
export function coachFromDemo(d: DemoData, minRounds = 12): CoachCached {
  if (!supported(d)) return { map: d.map, samples: [], error: `map ${d.map} isn't supported` };
  const engine = getEngine(d.map, 0);
  const rounds: (RoundSummary | null)[] = d.rounds.map((_, i) => {
    try { const rep = buildReplay(engine, d, i, CONTEXT); return summarizeRound(rep, reviewRound(engine, rep)); } catch { return null; }
  });
  const report = buildMatchReport(d, rounds);
  return { map: d.map, samples: report.players.filter(pl => pl.played >= minRounds).map(pl => ({ features: coachFeatures(pl), role: (pl.roles[0]?.role ?? 'Rifler') as Role, rounds: pl.played })) };
}

// ---- learn:spots --------------------------------------------------------------------------------------------
export type Landing = { type: 'smoke' | 'molotov'; side: 'CT' | 'T'; x: number; y: number };
export type SpotsCached = { map: string | null; landings: Landing[]; error?: string };
/** Every smoke and molotov landing, with the thrower's side. */
export function spotsFromDemo(d: DemoData): SpotsCached {
  const landings: Landing[] = [];
  for (const r of d.rounds)
    for (const u of r.util) {
      const side = r.frames.players[u.thrower]?.side;
      if ((u.type === 'smoke' || u.type === 'molotov') && side) landings.push({ type: u.type, side, x: Math.round(u.x), y: Math.round(u.y) });
    }
  return { map: d.map, landings };
}

// ---- learn:positions ------------------------------------------------------------------------------------------
export type PositionsCached = { map: string | null; rounds: { winner: 'CT' | 'T' | null; holds: Hold[]; moves: Move[] }[]; error?: string };
/** Every round's holds and moves, each with the side's learned win chance when it was made. */
export function positionsFromDemo(d: DemoData): PositionsCached {
  if (!supported(d)) return { map: d.map, rounds: [], error: `map ${d.map} isn't supported` };
  const engine = getEngine(d.map, 0);
  return {
    map: d.map,
    rounds: d.rounds.map(r => {
      const dec = roundDecisions(engine, r);
      const p = roundWinChance(engine, r, id => equipValue(r.econ?.[id]), w => worldToRadar(w, engine.map.radar));
      const forSide = (side: 'CT' | 'T', t: number) => { const v = p(t); return v === null ? undefined : +(side === 'CT' ? v : 1 - v).toFixed(3); };
      for (const h of dec.holds) h.ev = forSide(h.side, h.from);
      for (const m of dec.moves) m.ev = forSide(m.side, m.t);
      return { winner: r.winner, ...dec };
    }),
  };
}

// ---- learn:analyst --------------------------------------------------------------------------------------------
export type AnalystCached = { map: string | null; rounds: AnalystRound[]; win?: { x: number[][]; y: number[]; base: number[] }; error?: string };
/** Every round's analyst facts, plus the win-chance training samples. */
export function analystFromDemo(d: DemoData): AnalystCached {
  if (!supported(d)) return { map: d.map, rounds: [], error: `map ${d.map} isn't supported` };
  const engine = getEngine(d.map, 0);
  return { map: d.map, rounds: d.rounds.map((r, i) => analyzeRound(engine, r, d.rounds.slice(0, i), d.rounds.length)), win: winSamples(engine, d) };
}

/** Win-chance training samples: the round's state every 2 s (features) and whether CT won it; `base` = the old formula. */
export function winSamples(engine: ReturnType<typeof getEngine>, d: DemoData) {
  const x: number[][] = [], y: number[] = [], base: number[] = [];
  for (const r of d.rounds) {
    if (!r.winner) continue;
    const ids = Object.keys(r.frames.players);
    const sideOf = (id: string) => r.frames.players[id]?.side;
    const ft = r.frames.t;
    const k = (t: number) => { let i = 0; while (i < ft.length - 1 && ft[i + 1] <= t) i++; return i; };
    const alive = (id: string, t: number) => { const f = r.frames.players[id]; return !!f && !!f.alive[k(t)] && !r.kills.some(q => q.victim === id && q.t <= t); };
    const where = (id: string, t: number) => { if (!alive(id, t)) return null; const f = r.frames.players[id], i = k(t); return worldToRadar({ x: f.x[i], y: f.y[i] }, engine.map.radar); };
    const areas = controlCounts(engine, ids, sideOf, where, Math.ceil(r.duration));
    const kills = r.kills.map(q => ({ t: q.t, killer: q.attacker, victim: q.victim }));
    for (let t = 0; t < r.duration; t += 2) {
      const live = ids.filter(id => alive(id, t));
      const ct = live.filter(id => sideOf(id) === 'CT'), tt = live.filter(id => sideOf(id) === 'T');
      if (!ct.length || !tt.length) continue;
      const hp = (xs: string[]) => xs.reduce((a, id) => a + (r.frames.players[id].hp[k(t)] ?? 100), 0);
      const eq = (xs: string[]) => { const v = xs.map(id => equipValue(r.econ?.[id])).filter((e): e is number => e !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const s = Math.min(areas.ct.length - 1, Math.floor(t));
      const tp = tradePending(kills, ids, sideOf, where, t, engine.map.radar.scale);
      const state = { ct: ct.length, t: tt.length, ctHp: hp(ct), tHp: hp(tt), ctEquip: eq(ct), tEquip: eq(tt), planted: r.plant !== null && t >= r.plant ? r.plant : null, time: t,
        ctAreas: areas.ct[s], tAreas: areas.t[s], tradeCT: tp.ct, tradeT: tp.t };
      x.push(winFeatures(state).map(v => +v.toFixed(3)));
      y.push(r.winner === 'CT' ? 1 : 0);
      base.push(+evalState({ ...state, ctMap: 0, tMap: 0, ctAreas: undefined }).toFixed(4));
    }
  }
  return { x, y, base };
}

// ---- the learners' caches ---------------------------------------------------------------------------------
export const CACHES = {
  coach: { file: '.stratboard-coach-cache.json', v: COACH_V },
  spots: { file: '.stratboard-spots-cache.json', v: null },
  positions: { file: '.stratboard-positions-cache.json', v: POSITIONS_V },
  analyst: { file: '.stratboard-analyst-cache.json', v: ANALYST_V },
} as const;
export type Learner = keyof typeof CACHES;
/** A learner's cache: { key: per-demo result } (empty when its version changed). */
export function readCache<T>(folder: string, l: Learner): Record<string, T> {
  const p = path.join(folder, CACHES[l].file);
  if (!fs.existsSync(p)) return {};
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const v = CACHES[l].v;
  return v === null ? j : j.v === v ? j.demos : {};
}
export function writeCache(folder: string, l: Learner, demos: Record<string, unknown>) {
  const v = CACHES[l].v;
  fs.writeFileSync(path.join(folder, CACHES[l].file), JSON.stringify(v === null ? demos : { v, demos }));
}
/** A cached result that should be redone: an error other than a broken file. */
export const retry = (c: { error?: string } | undefined) => !c || (!!c.error && !/MalformedMessage/.test(c.error));

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
import { roundMoments } from '../src/engine/playModel';

// ---- cache versions: bump when that learner's per-demo numbers are computed differently -----------------------
export const COACH_V = 3; // 3: impact leaves out positioning decisions
export const POSITIONS_V = 7; // + paths only the first 8 s after leaving a spot
export const ANALYST_V = 13; // play moments: where on the map (seconds from each spawn)
/** Bump when tools/demo-core.mjs reads demos differently (new fields), so saved reads are redone. */
export const PARSE_V = 6; // 6: gear over the round (inventory, armour, kit, money once a second)

// ---- the demo folder -------------------------------------------------------------------------------------
/** Demos in a folder (and one level of subfolders), as paths relative to it. */
export function listDemos(folder: string): string[] {
  // up to three folders deep, following links: a link to a folder on an external disk (one the Mac can only read,
  // e.g. NTFS) keeps the demos there while everything the learners save stays in this folder
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let names: string[];
    try { names = fs.readdirSync(path.join(folder, rel)); } catch { return; } // a disk that isn't plugged in
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const r = path.join(rel, n);
      let st: fs.Stats;
      try { st = fs.statSync(path.join(folder, r)); } catch { continue; }
      if (st.isDirectory()) { if (depth < 3) walk(r, depth + 1); } else if (/\.dem(\.gz|\.zst)?$/i.test(n)) out.push(r);
    }
  };
  walk('', 1);
  // the same FACEIT match under two names (a download kept and the same one downloaded again) counts once
  const matchId = (f: string) => path.basename(f).match(/1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase();
  const seen = new Set<string>();
  return out.sort().filter(f => { const id = matchId(f); if (!id) return true; if (seen.has(id)) return false; seen.add(id); return true; });
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
  if (fs.existsSync(saved)) {
    const d: DemoData = JSON.parse(zlib.gunzipSync(fs.readFileSync(saved)).toString('utf8'));
    // a read made before blind events were rebuilt for demos without them (tournament demos): read it again
    const noBlinds = d.rounds.every(r => !r.blind.length) && d.rounds.some(r => r.util.some(u => u.type === 'flash'));
    if (!noBlinds) return d;
  }
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
export type PlaySamples = { x: number[][]; a: number[]; wl: number[]; y: number[]; t: number[]; spot?: string[] };
export type AnalystCached = { map: string | null; rounds: AnalystRound[]; win?: { x: number[][]; y: number[]; base: number[] }; play?: PlaySamples; error?: string };
/** Every round's analyst facts, plus the win-chance training samples. */
export function analystFromDemo(d: DemoData): AnalystCached {
  if (!supported(d)) return { map: d.map, rounds: [], error: `map ${d.map} isn't supported` };
  const engine = getEngine(d.map, 0);
  return { map: d.map, rounds: d.rounds.map((r, i) => analyzeRound(engine, r, d.rounds.slice(0, i), d.rounds.length)), win: winSamples(engine, d), play: playSamples(engine, d) };
}

/** Play-model training samples: every player's situation every 3 s, what they did, the win log-odds, and whether their side won. */
export function playSamples(engine: ReturnType<typeof getEngine>, d: DemoData): PlaySamples {
  const out: PlaySamples = { x: [], a: [], wl: [], y: [], t: [], spot: [] };
  for (const r of d.rounds) {
    if (!r.winner) continue;
    for (const m of roundMoments(engine, r, 3)) {
      out.x.push(m.f.map(v => +v.toFixed(2))); out.a.push(m.a); out.wl.push(+m.wl.toFixed(2)); out.y.push(m.side === r.winner ? 1 : 0); out.t.push(m.t); out.spot!.push(m.spot ?? '');
    }
  }
  return out;
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
// One small gzipped file per demo and learner, in <folder>/.stratboard-cache/<learner>/ (one big JSON per learner
// stopped working past a few hundred demos: a string that size is more than Node can hold). A learner's folder has
// its version in version.json; when that changes, its old entries are dropped.
export const CACHES = {
  coach: { file: '.stratboard-coach-cache.json', v: COACH_V },
  spots: { file: '.stratboard-spots-cache.json', v: null },
  positions: { file: '.stratboard-positions-cache.json', v: POSITIONS_V },
  analyst: { file: '.stratboard-analyst-cache.json', v: ANALYST_V },
} as const;
export type Learner = keyof typeof CACHES;
const cacheDir = (folder: string, l: Learner) => path.join(folder, '.stratboard-cache', l);
// the file name is the demo's key, base64url-encoded (so the keys can be listed without reading the files)
const entryFile = (folder: string, l: Learner, key: string) => path.join(cacheDir(folder, l), `${Buffer.from(key).toString('base64url')}.json.gz`);
const keyOfEntry = (f: string) => Buffer.from(f.replace(/\.json\.gz$/, ''), 'base64url').toString('utf8');
/** Opens a learner's cache folder: drops it when its version changed, and moves an old single-file cache into it. */
function openCache(folder: string, l: Learner) {
  const dir = cacheDir(folder, l), vf = path.join(dir, 'version.json'), v = CACHES[l].v ?? 0;
  if (fs.existsSync(dir) && (!fs.existsSync(vf) || JSON.parse(fs.readFileSync(vf, 'utf8')).v !== v)) fs.rmSync(dir, { recursive: true, force: true });
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(vf, JSON.stringify({ v }));
    const old = path.join(folder, CACHES[l].file);
    if (fs.existsSync(old)) {
      try {
        const j = JSON.parse(fs.readFileSync(old, 'utf8'));
        const demos = CACHES[l].v === null ? j : j.v === CACHES[l].v ? j.demos : {};
        for (const [k, val] of Object.entries(demos)) writeCacheEntry(folder, l, k, val);
      } catch { /* an unreadable old cache is just read again */ }
      fs.rmSync(old, { force: true });
    }
  }
  return dir;
}
/** Every cached demo of a learner, one at a time (keeps memory low for big folders). */
export function* eachCached<T>(folder: string, l: Learner): Generator<[string, T]> {
  const dir = openCache(folder, l);
  // in demo-name order, so what's learned doesn't depend on how the disk lists files
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort((a, b) => (keyOfEntry(a) < keyOfEntry(b) ? -1 : 1));
  for (const f of names) {
    try { const e = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8')); yield [e.key, e.value]; } catch { /* skip a broken entry */ }
  }
}
/** A learner's cache: { key: per-demo result }. */
export function readCache<T>(folder: string, l: Learner): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of eachCached<T>(folder, l)) out[k] = v;
  return out;
}
/** Keys a learner has cached, without reading the entries. */
export function cachedKeys(folder: string, l: Learner): Set<string> {
  return new Set(fs.readdirSync(openCache(folder, l)).filter(f => f.endsWith('.json.gz')).map(keyOfEntry));
}
/** One demo's cached result for a learner (undefined when there's none). */
export function readCacheEntry<T>(folder: string, l: Learner, key: string): T | undefined {
  const f = entryFile(folder, l, key);
  if (!fs.existsSync(f)) return undefined;
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')).value; } catch { return undefined; }
}
export function writeCacheEntry(folder: string, l: Learner, key: string, value: unknown) {
  const f = entryFile(folder, l, key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ key, value })));
  // demos that failed, by key, so learn:all knows what to retry without opening every entry
  const ef = path.join(path.dirname(f), 'errors.json');
  const errors = readErrors(ef);
  const err = (value as { error?: string } | null)?.error;
  if (err) errors[key] = err; else if (!(key in errors)) return; else delete errors[key];
  // write-then-rename, so a worker never reads a half-written file
  const tmp = `${ef}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(errors));
  fs.renameSync(tmp, ef);
}
const readErrors = (ef: string): Record<string, string> => { try { return fs.existsSync(ef) ? JSON.parse(fs.readFileSync(ef, 'utf8')) : {}; } catch { return {}; } };
/** Whether a learner should (re)read a demo: never read, or failed for a reason other than a broken file. */
export function needsRead(folder: string, l: Learner): (key: string) => boolean {
  const keys = cachedKeys(folder, l);
  const ef = path.join(cacheDir(folder, l), 'errors.json');
  const errors = readErrors(ef);
  // demos the parser couldn't read are skipped from then on, unless asked to try them again (a newer parser):
  // --retry-broken on learn:all, or STRATBOARD_RETRY_BROKEN=1
  const retryBroken = process.argv.includes('--retry-broken') || process.env.STRATBOARD_RETRY_BROKEN === '1';
  return key => !keys.has(key) || (!!errors[key] && (retryBroken || !/MalformedMessage/.test(errors[key])));
}
export function writeCache(folder: string, l: Learner, demos: Record<string, unknown>) {
  openCache(folder, l);
  for (const [k, v] of Object.entries(demos)) writeCacheEntry(folder, l, k, v);
}
/** A cached result that should be redone: an error other than a broken file. */
export const retry = (c: { error?: string } | undefined) => !c || (!!c.error && !/MalformedMessage/.test(c.error));

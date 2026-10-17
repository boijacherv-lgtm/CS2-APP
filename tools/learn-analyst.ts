// Learns the analyst benchmarks from good players' demos (e.g. FACEIT level 10): trades and spacing, duels (peeking vs
// holding, first hit, range), opening duels, map control, rotations, round types and CT setups, team utility,
// economy and post-plants, per map and overall. Writes src/engine/models/analyst.json, which Match recap's Analyst
// report compares a match with.
//
//   npm run learn:analyst -- <folder>
//
// Each demo's facts are cached in <folder>/.stratboard-analyst-cache.json; adding demos later only reads the new ones.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { analystFromDemo, ANALYST_V, loadDemo } from './learn-lib';
import { getEngine, MAPS } from '../src/map/catalog';
import { equipValue, evalState, type DemoData } from '../src/engine/recap';
import { worldToRadar } from '../src/engine/coords';
import { controlCounts, fitWin, tradePending, winFeatures } from '../src/engine/winprob';
import { analyzeRound, type AnalystRound } from '../src/engine/analyst';
import { benchmarks } from '../src/engine/analystBench';

const args = process.argv.slice(2).filter(a => a !== '--');
const folder = args[0];
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run learn:analyst -- <folder with demos>'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, '../src/engine/models/analyst.json');
const WIN_OUT = path.resolve(import.meta.dirname, '../src/engine/models/winprob.json');
const CACHE = path.join(folder, '.stratboard-analyst-cache.json');
const CACHE_V = ANALYST_V;

type Cached = { map: string | null; rounds: AnalystRound[]; win?: { x: number[][]; y: number[]; base: number[] }; error?: string };
const stored = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const cache: Record<string, Cached> = stored.v === CACHE_V ? stored.demos : {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify({ v: CACHE_V, demos: cache }));

const files = fs.readdirSync(folder).filter(f => /\.dem(\.gz|\.zst)?$/i.test(f)).sort();
const keyOf = (f: string) => `${f.replace(/ \(\d+\)(?=\.dem)/, '')}|${fs.statSync(path.join(folder, f)).size}`;
const seen = new Set<string>();

const read = (f: string): Cached => analystFromDemo(loadDemo(folder, f));

const t0 = Date.now();
files.forEach((f, i) => {
  const key = keyOf(f);
  if (seen.has(key)) return;
  seen.add(key);
  if (cache[key] && !(cache[key].error && !/MalformedMessage/.test(cache[key].error!))) return;
  const t = Date.now();
  try { cache[key] = read(f); } catch (e) { cache[key] = { map: null, rounds: [], error: e instanceof Error ? e.message : String(e) }; }
  const c = cache[key];
  console.log(`[${i + 1}/${files.length}] ${f}  ${c.error ? `skipped: ${c.error}` : `${c.map}, ${c.rounds.length} rounds`}  ${((Date.now() - t) / 1000).toFixed(0)} s`);
  save();
});

const byMap: Record<string, AnalystRound[]> = {};
const demos: Record<string, number> = {};
for (const [k, c] of Object.entries(cache)) {
  if (!seen.has(k) || !c.map || !c.rounds.length) continue;
  (byMap[c.map] ??= []).push(...c.rounds);
  demos[c.map] = (demos[c.map] ?? 0) + 1;
}
const all = Object.values(byMap).flat();
const out = {
  version: 1, trainedAt: new Date().toISOString().slice(0, 10),
  overall: benchmarks(all, Object.values(demos).reduce((a, b) => a + b, 0)),
  maps: Object.fromEntries(Object.entries(byMap).map(([m, rs]) => [m, benchmarks(rs, demos[m])])),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

// the learned win chance
const wx: number[][] = [], wy: number[] = [], wb: number[] = [];
for (const [k, c] of Object.entries(cache)) if (seen.has(k) && c.win) { wx.push(...c.win.x); wy.push(...c.win.y); wb.push(...c.win.base); }
if (wx.length > 1000) {
  const model = fitWin(wx, wy);
  const baseline = wb.reduce((a, p, i) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return a - (wy[i] ? Math.log(q) : Math.log(1 - q)); }, 0) / wb.length;
  fs.writeFileSync(WIN_OUT, JSON.stringify({ ...model, baselineLogLoss: +baseline.toFixed(4) }, null, 1) + '\n');
  console.log(`Win chance: learned from ${model.samples} moments; log loss ${model.logLoss} (the hand-set formula: ${baseline.toFixed(4)}, lower is better).`);
  console.log(`  weights: ${model.features.map((f, i) => `${f} ${model.coef[i]}`).join(', ')}, bias ${model.bias}`);
}
const o = out.overall;
console.log(`\nLearned from ${o.rounds} rounds in ${o.demos} demos (${Object.entries(demos).map(([m, n]) => `${m.replace('de_', '')} ${n}`).join(', ')}).`);
console.log(`Trades: ${Math.round(o.trades.tradedRate * 100)}% of deaths traded, in ${o.trades.avgTradeTime.toFixed(1)} s; a teammate with sight trades ${Math.round(o.trades.chanceConversion * 100)}% of the time.`);
console.log(`Duels: peeking wins ${Math.round(o.duels.peekWin * 100)}%, first hit wins ${Math.round(o.duels.firstHitWin * 100)}%, ${Math.round(o.duels.flashedShare * 100)}% of kills are on blind players.`);
console.log(`Openings: T win the opening duel ${Math.round(o.openings.tWinShare * 100)}%; round won after an opening kill ${Math.round(o.openings.winAfter * 100)}%.`);
console.log(`Rotations: ${o.rotations.perRound.toFixed(2)} a round, ${o.rotations.avgTime.toFixed(1)} s, ${Math.round(o.rotations.lateRate * 100)}% late, ${Math.round(o.rotations.overRate * 100)}% over-rotations.`);
console.log(`\nSaved ${path.relative(process.cwd(), OUT)} in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

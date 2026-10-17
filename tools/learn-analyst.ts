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
import { controlCounts, fitLogistic, fitWin, tradePending, winFeatures } from '../src/engine/winprob';
import { ACTIONS, fitPolicy, judgeMoment, policy, type PlayModel } from '../src/engine/playModel';
import { DUEL_FEATURES, duelProfiles, duelSamples, type DuelModel } from '../src/engine/duelModel';
import { analyzeRound, type AnalystRound } from '../src/engine/analyst';
import { benchmarks } from '../src/engine/analystBench';

const args = process.argv.slice(2).filter(a => a !== '--');
const folder = args[0];
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run learn:analyst -- <folder with demos>'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, '../src/engine/models/analyst.json');
const WIN_OUT = path.resolve(import.meta.dirname, '../src/engine/models/winprob.json');
const PLAY_OUT = path.resolve(import.meta.dirname, '../src/engine/models/play.json');
const DUEL_OUT = path.resolve(import.meta.dirname, '../src/engine/models/duel.json');
const CACHE = path.join(folder, '.stratboard-analyst-cache.json');
const CACHE_V = ANALYST_V;

type Cached = { map: string | null; rounds: AnalystRound[]; win?: { x: number[][]; y: number[]; base: number[] }; play?: { x: number[][]; a: number[]; wl: number[]; y: number[]; t: number[] }; error?: string };
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
// the duel model: who wins a fight from first contact; checked on demos it didn't learn from (every 5th demo)
const dTrain: number[][] = [], yTrain: number[] = [], dTest: number[][] = [], yTest: number[] = [];
Object.entries(cache).filter(([k, c]) => seen.has(k) && c.rounds.length).forEach(([, c], i) => {
  const s = duelSamples(c.rounds.flatMap(r => r.duels));
  (i % 5 === 4 ? dTest : dTrain).push(...s.x); (i % 5 === 4 ? yTest : yTrain).push(...s.y);
});
let duelModel: DuelModel | null = null;
if (dTrain.length > 1000) {
  const check = fitLogistic(dTrain, yTrain, DUEL_FEATURES, 1500, 0.3);
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const pOf = (x: number[]) => sig(check.bias + x.reduce((a, v, j) => a + v * check.coef[j], 0));
  const testLoss = dTest.reduce((a, x, i) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, pOf(x))); return a - (yTest[i] ? Math.log(p) : Math.log(1 - p)); }, 0) / (dTest.length || 1);
  const testAcc = dTest.filter((x, i) => (pOf(x) > 0.5) === !!yTest[i]).length / (dTest.length || 1);
  const model = fitLogistic([...dTrain, ...dTest], [...yTrain, ...yTest], DUEL_FEATURES, 1500, 0.3);
  const prof = duelProfiles([...dTrain, ...dTest]);
  fs.writeFileSync(DUEL_OUT, JSON.stringify({ ...model, bias: 0, ...prof, testLogLoss: +testLoss.toFixed(4), testAccuracy: +testAcc.toFixed(3), baselineLogLoss: 0.6931 }, null, 1) + '\n');
  console.log(`Duel model: learned from ${model.samples / 2} fights; on unseen demos it calls ${Math.round(testAcc * 100)}% of fights right, log loss ${testLoss.toFixed(4)} (a coin flip: 0.6931).`);
  console.log(`  weights: ${model.features.map((f, i) => `${f} ${model.coef[i]}`).join(', ')}`);
  duelModel = { ...model, bias: 0, ...prof };
  console.log(`  peekers saw first ${prof.peek.sawFirst}, crosshair ${prof.peek.aim}; holders ${prof.hold.sawFirst}, ${prof.hold.aim}`);
}
const all = Object.values(byMap).flat();
const out = {
  version: 1, trainedAt: new Date().toISOString().slice(0, 10),
  overall: benchmarks(all, Object.values(demos).reduce((a, b) => a + b, 0), duelModel),
  maps: Object.fromEntries(Object.entries(byMap).map(([m, rs]) => [m, benchmarks(rs, demos[m], duelModel)])),
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
// the play model ("what would a level-10 player do now"): policy + value, checked on every 5th demo
{
  const tr = { x: [] as number[][], a: [] as number[], wl: [] as number[], y: [] as number[], t: [] as number[] }, te = { x: [] as number[][], a: [] as number[], wl: [] as number[], y: [] as number[], t: [] as number[] };
  Object.entries(cache).filter(([k, c]) => seen.has(k) && c.play).forEach(([, c], i) => {
    const to = i % 5 === 4 ? te : tr;
    to.x.push(...c.play!.x); to.a.push(...c.play!.a); to.wl.push(...c.play!.wl); to.y.push(...c.play!.y); to.t.push(...c.play!.t);
  });
  if (tr.x.length > 5000) {
    const t1 = Date.now();
    const w = fitPolicy(tr.x, tr.a);
    const freq = ACTIONS.map((_, c) => tr.a.filter(a => a === c).length / tr.a.length);
    const probe: PlayModel = { policy: { w, samples: tr.x.length, accuracy: 0, logLoss: 0, baseLogLoss: 0 }, bench: { usual: 0 } };
    let ll = 0, base = 0, hit = 0;
    te.x.forEach((x, i) => { const p = policy(x, probe); ll -= Math.log(Math.max(1e-6, p[te.a[i]])); base -= Math.log(Math.max(1e-6, freq[te.a[i]])); if (p.indexOf(Math.max(...p)) === te.a[i]) hit++; });
    const n = te.x.length || 1;
    const all = { x: [...tr.x, ...te.x], a: [...tr.a, ...te.a], wl: [...tr.wl, ...te.wl], y: [...tr.y, ...te.y], t: [...tr.t, ...te.t] };
    const model: PlayModel = { policy: { w: fitPolicy(all.x, all.a), samples: all.x.length, accuracy: +(hit / n).toFixed(3), logLoss: +(ll / n).toFixed(4), baseLogLoss: +(base / n).toFixed(4) }, bench: { usual: 0 } };
    // level-10 players judged by the same models (a sample of moments)
    const js = all.x.filter((_, i) => i % 7 === 0).map((x, j) => judgeMoment({ t: all.t[j * 7], player: '', side: x[5] ? 'T' : 'CT', f: x, a: all.a[j * 7], wl: all.wl[j * 7] }, model)).filter(v => v);
    model.bench = { usual: +(js.filter(v => v!.usual).length / js.length).toFixed(3) };
    fs.writeFileSync(PLAY_OUT, JSON.stringify(model) + '\n');
    console.log(`Play model: ${model.policy.samples} moments; on unseen demos it predicts the level-10 choice ${Math.round(model.policy.accuracy * 100)}% of the time, log loss ${model.policy.logLoss} (guessing by frequency: ${model.policy.baseLogLoss}).`);
    console.log(`  level-10 players make a usual choice ${Math.round(model.bench.usual * 100)}% of the time. ${((Date.now() - t1) / 1000).toFixed(0)} s`);
  }
}
const o = out.overall;
console.log(`\nLearned from ${o.rounds} rounds in ${o.demos} demos (${Object.entries(demos).map(([m, n]) => `${m.replace('de_', '')} ${n}`).join(', ')}).`);
console.log(`Trades: ${Math.round(o.trades.tradedRate * 100)}% of deaths traded, in ${o.trades.avgTradeTime.toFixed(1)} s; a teammate with sight trades ${Math.round(o.trades.chanceConversion * 100)}% of the time.`);
console.log(`Duels: peeking wins ${Math.round(o.duels.peekWin * 100)}%, first hit wins ${Math.round(o.duels.firstHitWin * 100)}%, ${Math.round(o.duels.flashedShare * 100)}% of kills are on blind players.`);
console.log(`Openings: T win the opening duel ${Math.round(o.openings.tWinShare * 100)}%; round won after an opening kill ${Math.round(o.openings.winAfter * 100)}%.`);
console.log(`Rotations: ${o.rotations.perRound.toFixed(2)} a round, ${o.rotations.avgTime.toFixed(1)} s, ${Math.round(o.rotations.lateRate * 100)}% late, ${Math.round(o.rotations.overRate * 100)}% over-rotations.`);
console.log(`\nSaved ${path.relative(process.cwd(), OUT)} in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

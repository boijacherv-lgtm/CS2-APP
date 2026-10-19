// Learns the analyst benchmarks from good players' demos (e.g. FACEIT level 10): trades and spacing, duels (peeking vs
// holding, first hit, range), opening duels, map control, rotations, round types and CT setups, team utility,
// economy and post-plants, per map and overall. Writes src/engine/models/analyst.json, which Match recap's Analyst
// report compares a match with.
//
//   npm run learn:analyst -- <folder>
//
// Each demo's facts are cached in <folder>/.stratboard-cache/analyst; adding demos later only reads the new ones.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { analystFromDemo, cachedKeys, eachCached, keyOf as keyOfDemo, listDemos, liveKeys, loadDemo, needsRead, writeCacheEntry } from './learn-lib';
import { getEngine, MAPS } from '../src/map/catalog';
import { equipValue, evalState, type DemoData } from '../src/engine/recap';
import { worldToRadar } from '../src/engine/coords';
import { controlCounts, fitLogistic, fitWin, tradePending, winFeatures } from '../src/engine/winprob';
import { ACTIONS, fitPolicy, judgeMoment, policy, type PlayModel } from '../src/engine/playModel';
import { trainMlp } from '../src/engine/mlp';
import { DUEL_FEATURES, duelProfiles, duelSamples, type DuelModel } from '../src/engine/duelModel';
import { analyzeRound, type AnalystRound } from '../src/engine/analyst';
import { benchmarks } from '../src/engine/analystBench';

const args = process.argv.slice(2).filter(a => a !== '--');
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
// --name pro: benchmarks for another level (models/analyst-pro.json, from pro demos); the duel, play and win models
// stay the level-10 ones
const NAME = (() => { const i = args.indexOf('--name'); return i >= 0 ? args[i + 1].replace(/[^\w-]/g, '') : ''; })();
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run learn:analyst -- <folder with demos>'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, `../src/engine/models/analyst${NAME ? `-${NAME}` : ''}.json`);
const WIN_OUT = path.resolve(import.meta.dirname, '../src/engine/models/winprob.json');
const PLAY_OUT = path.resolve(import.meta.dirname, '../src/engine/models/play.json');
const DUEL_OUT = path.resolve(import.meta.dirname, '../src/engine/models/duel.json');

type Cached = { map: string | null; rounds: AnalystRound[]; win?: { x: number[][]; y: number[]; base: number[] }; play?: { x: number[][]; a: number[]; wl: number[]; y: number[]; t: number[] }; error?: string };

// read the demos the cache doesn't have yet (learn:all normally did that already, in parallel)
const files = listDemos(folder);
const keys = new Map<string, string>();
for (const f of files) { const k = keyOfDemo(folder, f); if (!keys.has(k)) keys.set(k, f); }
const t0 = Date.now();
const need = needsRead(folder, 'analyst');
let i0 = 0;
for (const [key, f] of keys) {
  i0++;
  if (!need(key)) continue;
  const t = Date.now();
  let c: Cached;
  try { c = analystFromDemo(loadDemo(folder, f)); } catch (e) { c = { map: null, rounds: [], error: e instanceof Error ? e.message : String(e) }; }
  writeCacheEntry(folder, 'analyst', key, c);
  console.log(`[${i0}/${keys.size}] ${f}  ${c.error ? `skipped: ${c.error}` : `${c.map}, ${c.rounds.length} rounds`}  ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

// plus the demos imported from another computer's training pack (no file here, their results already cached)
for (const k of liveKeys(folder)) if (!keys.has(k)) keys.set(k, '');

// one pass over the cache, one demo at a time, keeping only what each model needs. Every 5th demo is held out to
// check the duel and play models on demos they didn't learn from. With many demos the play moments are thinned
// (every k-th) to about PLAY_CAP, which is plenty for a model this size and fits in memory.
const PLAY_CAP = 600_000;
const inFolder = [...cachedKeys(folder, 'analyst')].filter(k => keys.has(k)).length;
const stride = Math.max(1, Math.ceil((inFolder * 3300) / PLAY_CAP));
const byMap: Record<string, AnalystRound[]> = {};
const demos: Record<string, number> = {};
const dTrain: number[][] = [], yTrain: number[] = [], dTest: number[][] = [], yTest: number[] = [];
const wx: number[][] = [], wy: number[] = [], wb: number[] = [];
type Play = { x: number[][]; a: number[]; wl: number[]; y: number[]; t: number[]; spot: string[] };
const empty = (): Play => ({ x: [], a: [], wl: [], y: [], t: [], spot: [] });
const tr = empty(), te = empty();
let used = 0;
for (const [k, c] of eachCached<Cached>(folder, 'analyst')) {
  if (!keys.has(k) || !c.map || !c.rounds.length) continue;
  const test = used++ % 5 === 4;
  (byMap[c.map] ??= []).push(...c.rounds);
  demos[c.map] = (demos[c.map] ?? 0) + 1;
  const s = duelSamples(c.rounds.flatMap(r => r.duels));
  (test ? dTest : dTrain).push(...s.x); (test ? yTest : yTrain).push(...s.y);
  if (c.win) { wx.push(...c.win.x); wy.push(...c.win.y); wb.push(...c.win.base); }
  if (c.play) {
    const to = test ? te : tr, p = c.play;
    for (let i = 0; i < p.x.length; i += stride) { to.x.push(p.x[i]); to.a.push(p.a[i]); to.wl.push(p.wl[i]); to.y.push(p.y[i]); to.t.push(p.t[i]); to.spot.push(p.spot?.[i] ?? ''); }
  }
}
if (stride > 1) console.log(`${used} demos: play moments thinned to every ${stride}th.`);

let duelModel: DuelModel | null = null;
if (!NAME && dTrain.length > 1000) {
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
if (!NAME && wx.length > 1000) {
  const model = fitWin(wx, wy);
  const baseline = wb.reduce((a, p, i) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return a - (wy[i] ? Math.log(q) : Math.log(1 - q)); }, 0) / wb.length;
  fs.writeFileSync(WIN_OUT, JSON.stringify({ ...model, baselineLogLoss: +baseline.toFixed(4) }, null, 1) + '\n');
  console.log(`Win chance: learned from ${model.samples} moments; log loss ${model.logLoss} (the hand-set formula: ${baseline.toFixed(4)}, lower is better).`);
  console.log(`  weights: ${model.features.map((f, i) => `${f} ${model.coef[i]}`).join(', ')}, bias ${model.bias}`);
}
// the play model ("what would a level-10 player do now"): policy + value, checked on every 5th demo
{
  if (!NAME && tr.x.length > 5000) {
    const t1 = Date.now();
    const w = fitPolicy(tr.x, tr.a);
    const freq = ACTIONS.map((_, c) => tr.a.filter(a => a === c).length / tr.a.length);
    const probe: PlayModel = { policy: { w, samples: tr.x.length, accuracy: 0, logLoss: 0, baseLogLoss: 0 }, bench: { usual: 0 } };
    let ll = 0, base = 0, hit = 0;
    te.x.forEach((x, i) => { const p = policy(x, probe); ll -= Math.log(Math.max(1e-6, p[te.a[i]])); base -= Math.log(Math.max(1e-6, freq[te.a[i]])); if (p.indexOf(Math.max(...p)) === te.a[i]) hit++; });
    const n = te.x.length || 1;
    const all = { x: [...tr.x, ...te.x], a: [...tr.a, ...te.a], wl: [...tr.wl, ...te.wl], y: [...tr.y, ...te.y], t: [...tr.t, ...te.t], spot: [...tr.spot, ...te.spot] };
    const model: PlayModel = { policy: { w: fitPolicy(all.x, all.a), samples: all.x.length, accuracy: +(hit / n).toFixed(3), logLoss: +(ll / n).toFixed(4), baseLogLoss: +(base / n).toFixed(4) }, bench: { usual: 0 } };
    // level-10 players judged by the same models (a sample of moments)
    const js = all.x.filter((_, i) => i % 7 === 0).map((x, j) => judgeMoment({ t: all.t[j * 7], player: '', side: x[5] ? 'T' : 'CT', f: x, a: all.a[j * 7], wl: all.wl[j * 7] }, model)).filter(v => v);
    // the bigger model: a small neural network with each map spot learned (mlp.ts), checked on the same unseen demos;
    // used only when it beats the linear one there
    if (!process.argv.includes('--no-mlp') && tr.spot.some(Boolean) && te.x.length >= 1000) {
      const t2 = Date.now();
      console.log('  training the network with map spots…');
      const { net, testLoss, testAcc } = trainMlp({ x: tr.x, spot: tr.spot, y: tr.a }, { x: te.x, spot: te.spot, y: te.a },
        { classes: ACTIONS.length, epochs: Number(process.env.MLP_EPOCHS ?? 25), h1: Number(process.env.MLP_H1 ?? 96), h2: Number(process.env.MLP_H2 ?? 48), embDim: Number(process.env.MLP_EMB ?? 12), log: l => console.log(l) });
      console.log(`  network: unseen demos ${Math.round(testAcc * 100)}% right, log loss ${testLoss} (linear: ${Math.round(model.policy.accuracy * 100)}%, ${model.policy.logLoss}), ${Object.keys(net.vocab).length} spots, ${((Date.now() - t2) / 60000).toFixed(1)} min`);
      if (testLoss < model.policy.logLoss) model.mlp = { ...net, accuracy: testAcc, logLoss: testLoss };
      else console.log('  kept the linear model (the network wasn\'t better on unseen demos)');
    }
    // level-10 players judged by the final model
    const js2 = all.x.filter((_, i) => i % 7 === 0).map((x, j) => judgeMoment({ t: all.t[j * 7], player: '', side: x[5] ? 'T' : 'CT', f: x, a: all.a[j * 7], wl: all.wl[j * 7], spot: all.spot[j * 7] }, model)).filter(v => v);
    model.bench = { usual: +(js2.filter(v => v!.usual).length / js2.length).toFixed(3) };
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

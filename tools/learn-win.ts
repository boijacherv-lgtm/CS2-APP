// Trains the win chance as boosted trees and tests it honestly: on matches it never learned from.
//   1. every read match in the folders (<folder>/.stratboard-parsed, newest read of each) → the round's state every
//      2 s and whether CT won it (winSamples), cached per match in <folder>/.stratboard-cache/win2
//   2. a fixed 20% of the matches is held out (isTest: by a hash of the match, so it never changes between runs);
//      of the rest, a tenth decides when the trees stop growing
//   3. on the held-out matches: the hand-set formula, the logistic model (models/winprob.json) and the trees, by
//      log loss (lower = better), Brier score and calibration ("said 70% → won 68%")
//   4. the trees are kept (models/winprob-gbm.json) only when they beat the logistic model there; the numbers go to
//      models/eval.json either way
//
//   npm run learn:win -- <folder> [<folder>…]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getEngine, MAPS } from '../src/map/catalog';
import type { DemoData } from '../src/engine/recap';
import { WIN2_FEATURES, WIN_MODEL } from '../src/engine/winprob';
import { fitGbm, gbmLogit, logLoss } from '../src/engine/gbm';
import { winSamples } from './learn-lib';
import { isTest } from '../src/engine/split';

const folders = process.argv.slice(2).filter(a => a !== '--');
if (!folders.length) { console.error('Usage: npm run learn:win -- <folder with read demos> [<folder>…]'); process.exit(1); }
const MODELS = path.resolve(import.meta.dirname, '../src/engine/models');
const WIN2_V = 1; // bump when winFeatures2 or winSamples change: the cached samples are made again

type Samples = { v: number; map: string; x: number[][]; x2: number[][]; y: number[]; base: number[] };
const train: Samples[] = [], valid: Samples[] = [], test: Samples[] = [];
let made = 0, cached = 0;
const t0 = Date.now();
for (const folder of folders) {
  const dir = path.join(folder, '.stratboard-parsed');
  if (!fs.existsSync(dir)) { console.log(`${folder}: no read matches (run learn:all first)`); continue; }
  const cacheDir = path.join(folder, '.stratboard-cache', 'win2');
  fs.mkdirSync(cacheDir, { recursive: true });
  // the newest read of each match
  const newest = new Map<string, { v: number; file: string }>();
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^v(\d+)-(.+)\.json\.gz$/);
    if (!m) continue;
    const was = newest.get(m[2]);
    if (!was || Number(m[1]) > was.v) newest.set(m[2], { v: Number(m[1]), file: f });
  }
  let i = 0;
  for (const [id, { v, file }] of newest) {
    i++;
    const cacheFile = path.join(cacheDir, `${id}.json.gz`);
    let s: Samples | null = null;
    try { const c = JSON.parse(zlib.gunzipSync(fs.readFileSync(cacheFile)).toString()) as Samples & { read?: number }; if (c.v === WIN2_V && c.read === v) { s = c; cached++; } } catch { /* not made yet */ }
    if (!s) {
      let d: DemoData;
      try { d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString('utf8')); } catch { continue; }
      if (!MAPS.some(m => m.id === d.map)) continue;
      const w = winSamples(getEngine(d.map, 0), d);
      s = { v: WIN2_V, map: d.map, x: w.x, x2: w.x2, y: w.y, base: w.base };
      fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify({ ...s, read: v })));
      made++;
      if (made % 25 === 0) console.log(`  ${made} matches sampled (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
    }
    // held out for the test by the match itself (stable); a tenth of the rest checks when to stop
    (isTest(id) ? test : isTest(id, 10, 1) ? valid : train).push(s);
  }
  console.log(`${folder}: ${newest.size} read matches`);
}
const rows = (ss: Samples[], f: 'x' | 'x2') => ss.flatMap(s => s[f]);
const ys = (ss: Samples[]) => ss.flatMap(s => s.y);
console.log(`Samples: ${made} matches sampled now, ${cached} from the cache. Train ${train.length} matches, check ${valid.length}, test ${test.length}.`);

// fit the trees on the training matches, stopping when the check matches stop improving
const t1 = Date.now();
const model = fitGbm(rows(train, 'x2'), ys(train), WIN2_FEATURES, {
  trees: 600, depth: 4, rate: 0.06, minLeaf: 400, lambda: 8, bins: 48, sample: 0.6, patience: 40,
  valid: { x: rows(valid, 'x2'), y: ys(valid) }, log: s => console.log(s),
});
console.log(`Trees: ${model.trees.length} in ${((Date.now() - t1) / 60000).toFixed(1)} min.`);

// the honest test: matches none of the models learned from (the logistic model's own fit saw all of them, so its
// score here is if anything a little flattering)
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const tx = rows(test, 'x'), tx2 = rows(test, 'x2'), ty = ys(test), tb = test.flatMap(s => s.base);
const logistic = (x: number[]) => (WIN_MODEL ? sig(WIN_MODEL.bias + x.reduce((a, v, j) => a + v * WIN_MODEL!.coef[j], 0)) : 0.5);
const score = (p: number[]) => ({
  logLoss: +(p.reduce((a, q, i) => a + logLoss(q, ty[i]), 0) / p.length).toFixed(4),
  brier: +(p.reduce((a, q, i) => a + (q - ty[i]) ** 2, 0) / p.length).toFixed(4),
  calibration: Array.from({ length: 10 }, (_, b) => {
    const idx = p.map((q, i) => [q, i] as const).filter(([q]) => q >= b / 10 && (q < (b + 1) / 10 || b === 9));
    return { said: +((b + 0.5) / 10).toFixed(2), won: idx.length ? +(idx.reduce((a, [, i]) => a + ty[i], 0) / idx.length).toFixed(3) : null, n: idx.length };
  }),
});
const formula = score(tb), lin = score(tx.map(logistic)), trees = score(tx2.map(x => sig(gbmLogit(model, x))));
const ship = trees.logLoss < lin.logLoss;
console.log(`\nOn ${test.length} matches the models never learned from (${ty.length} moments), lower is better:`);
console.log(`  hand-set formula   log loss ${formula.logLoss}  Brier ${formula.brier}`);
console.log(`  logistic (today)   log loss ${lin.logLoss}  Brier ${lin.brier}`);
console.log(`  boosted trees      log loss ${trees.logLoss}  Brier ${trees.brier}  ${ship ? '← better: kept' : '← not better: the logistic model stays'}`);
console.log(`  calibration (trees): ${trees.calibration.filter(c => c.n).map(c => `${Math.round(c.said * 100)}%→${Math.round((c.won ?? 0) * 100)}%`).join('  ')}`);

fs.writeFileSync(path.join(MODELS, 'winprob-gbm.json'), JSON.stringify(ship ? { ...model, trainedAt: new Date().toISOString().slice(0, 10), matches: train.length + valid.length } : {}));
const evalFile = path.join(MODELS, 'eval.json');
const prev = fs.existsSync(evalFile) ? JSON.parse(fs.readFileSync(evalFile, 'utf8')) : {};
fs.writeFileSync(evalFile, JSON.stringify({
  ...prev,
  winChance: { at: new Date().toISOString().slice(0, 10), testMatches: test.length, testMoments: ty.length, trainMatches: train.length + valid.length, shipped: ship ? 'trees' : 'logistic', formula, logistic: lin, trees },
}, null, 1) + '\n');
console.log(`\nWrote ${ship ? 'models/winprob-gbm.json and ' : ''}models/eval.json.`);

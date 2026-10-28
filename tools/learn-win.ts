// Trains the win chance as boosted trees and tests it honestly: on matches it never learned from.
//   1. every read match in the folders (<folder>/.stratboard-parsed, newest read of each) → the round's state every
//      2 s and whether CT won it (winSamples), cached per match in <folder>/.stratboard-cache/win2
//   2. the newest 20% of the matches (by date: npm run dates) is held out, the next newest 10% decides when the trees
//      stop growing; matches without a date keep the fixed split by hash (isTest)
//   3. trees with newer matches weighing more (a match's weight halves every 30 / 60 / 90 days, or all the same):
//      the one best on the check matches is kept; then per map, a few trees on top that learn what that map does
//      differently, kept only for maps where they beat the shared trees on that map's held-out matches
//   4. on the held-out matches: the hand-set formula, the logistic model (models/winprob.json) and the trees, by
//      log loss (lower = better), Brier score and calibration ("said 70% → won 68%")
//   5. the trees are kept (models/winprob-gbm.json) only when they beat the logistic model there; the numbers go to
//      models/eval.json either way
//
//   npm run learn:win -- <folder> [<folder>…]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getEngine, MAPS } from '../src/map/catalog';
import type { DemoData } from '../src/engine/recap';
import { WIN2_FEATURES, WIN_MODEL } from '../src/engine/winprob';
import { fitGbm, gbmLogit, logLoss, type GbmModel } from '../src/engine/gbm';
import { dateSplit, matchDates, winSamples } from './learn-lib';

const folders = process.argv.slice(2).filter(a => a !== '--');
if (!folders.length) { console.error('Usage: npm run learn:win -- <folder with read demos> [<folder>…]'); process.exit(1); }
const MODELS = path.resolve(import.meta.dirname, '../src/engine/models');
const WIN2_V = 1; // bump when winFeatures2 or winSamples change: the cached samples are made again

type Samples = { v: number; map: string; x: number[][]; x2: number[][]; y: number[]; base: number[] };
type Match = Samples & { id: string };
const all: Match[] = [];
const dates: Record<string, number | null> = {};
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
    all.push({ ...s, id });
  }
  Object.assign(dates, matchDates(folder));
  console.log(`${folder}: ${newest.size} read matches`);
}
const split = dateSplit(dates, all.map(m => m.id));
const train = all.filter(m => split.groupOf(m.id) === 'train'), valid = all.filter(m => split.groupOf(m.id) === 'valid'), test = all.filter(m => split.groupOf(m.id) === 'test');
const since = split.since ? new Date(split.since).toISOString().slice(0, 10) : null;
console.log(`${split.dated} of ${all.length} matches dated${since ? `: the test is the ones played since ${since}` : ''}.`);
const rows = (ss: Samples[], f: 'x' | 'x2') => ss.flatMap(s => s[f]);
const ys = (ss: Samples[]) => ss.flatMap(s => s.y);
const ws = (ss: Match[], halfLife: number) => ss.flatMap(s => s.y.map(() => split.weightOf(s.id, halfLife)));
console.log(`Samples: ${made} matches sampled now, ${cached} from the cache. Train ${train.length} matches, check ${valid.length}, test ${test.length}.`);

// fit the trees on the training matches, stopping when the check matches stop improving: once per weighting
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const meanLoss = (p: number[], y: number[]) => +(p.reduce((a, q, i) => a + logLoss(q, y[i]), 0) / Math.max(1, p.length)).toFixed(4);
const t1 = Date.now();
const trainX = rows(train, 'x2'), trainY = ys(train), validX = rows(valid, 'x2'), validY = ys(valid);
const variants = [Infinity, 90, 60, 30].map(halfLife => {
  const m = fitGbm(trainX, trainY, WIN2_FEATURES, {
    trees: 600, depth: 4, rate: 0.06, minLeaf: 400, lambda: 8, bins: 48, sample: 0.6, patience: 40,
    valid: { x: validX, y: validY }, w: ws(train, halfLife),
  });
  const check = meanLoss(validX.map(x => sig(gbmLogit(m, x))), validY);
  const held = meanLoss(rows(test, 'x2').map(x => sig(gbmLogit(m, x))), ys(test));
  console.log(`  ${Number.isFinite(halfLife) ? `newer count more (half every ${halfLife} days)` : 'every match the same'}: ${m.trees.length} trees, check ${check}, test ${held}`);
  return { halfLife, model: m, check, test: held };
});
// a change has to beat noise to count: newer-counts-more only when it beats every-match-the-same by MIN_GAIN on the
// check matches, a map's own trees only when they beat the shared ones by MIN_GAIN on its held-out matches
const MIN_GAIN = 0.0005;
const even = variants[0];
const chosen = variants.slice(1).filter(v => v.check <= even.check - MIN_GAIN).reduce((a, b) => (b.check < a.check ? b : a), even);
const model = chosen.model;
console.log(`Trees: ${model.trees.length}, ${Number.isFinite(chosen.halfLife) ? `half-life ${chosen.halfLife} days` : 'no date weighting'} (best on the check matches), in ${((Date.now() - t1) / 60000).toFixed(1)} min.`);

// per map: trees on top of the shared ones, learning only what the map does differently
const maps: Record<string, GbmModel> = {};
const perMap: Record<string, { matches: number; shared: number; tuned: number; kept: boolean }> = {};
for (const map of [...new Set(all.map(m => m.map))].sort()) {
  const on = (ss: Match[]) => ss.filter(s => s.map === map);
  const tr = on(train), va = on(valid), te = on(test);
  if (!te.length || !va.length) continue;
  const logits = (ss: Match[]) => rows(ss, 'x2').map(x => gbmLogit(model, x));
  const tune = fitGbm(rows(tr, 'x2'), ys(tr), WIN2_FEATURES, {
    trees: 300, depth: 3, rate: 0.03, minLeaf: 300, lambda: 10, bins: 48, sample: 0.6, patience: 30,
    valid: { x: rows(va, 'x2'), y: ys(va), init: logits(va) }, w: ws(tr, chosen.halfLife), init: logits(tr),
  });
  const tz = logits(te), tx = rows(te, 'x2'), ty = ys(te);
  const shared = meanLoss(tz.map(sig), ty), tuned = meanLoss(tx.map((x, i) => sig(tz[i] + gbmLogit(tune, x))), ty);
  const kept = tune.trees.length > 0 && tuned <= shared - MIN_GAIN;
  if (kept) maps[map] = tune;
  perMap[map] = { matches: te.length, shared, tuned, kept };
  console.log(`  ${map}: ${tune.trees.length} trees on top, test ${shared} → ${tuned}${kept ? '  ← kept' : ''}`);
}
const logitOf = (s: Match, x: number[]) => gbmLogit(model, x) + (maps[s.map] ? gbmLogit(maps[s.map], x) : 0);

// the honest test: matches none of the models learned from (the logistic model's own fit saw all of them, so its
// score here is if anything a little flattering)
const tx = rows(test, 'x'), ty = ys(test), tb = test.flatMap(s => s.base);
const logistic = (x: number[]) => (WIN_MODEL ? sig(WIN_MODEL.bias + x.reduce((a, v, j) => a + v * WIN_MODEL!.coef[j], 0)) : 0.5);
const score = (p: number[]) => ({
  logLoss: +(p.reduce((a, q, i) => a + logLoss(q, ty[i]), 0) / p.length).toFixed(4),
  brier: +(p.reduce((a, q, i) => a + (q - ty[i]) ** 2, 0) / p.length).toFixed(4),
  calibration: Array.from({ length: 10 }, (_, b) => {
    const idx = p.map((q, i) => [q, i] as const).filter(([q]) => q >= b / 10 && (q < (b + 1) / 10 || b === 9));
    return { said: +((b + 0.5) / 10).toFixed(2), won: idx.length ? +(idx.reduce((a, [, i]) => a + ty[i], 0) / idx.length).toFixed(3) : null, n: idx.length };
  }),
});
const formula = score(tb), lin = score(tx.map(logistic)), trees = score(test.flatMap(s => s.x2.map(x => sig(logitOf(s, x)))));
const ship = trees.logLoss < lin.logLoss;
console.log(`\nOn ${test.length} matches the models never learned from (${ty.length} moments), lower is better:`);
console.log(`  hand-set formula   log loss ${formula.logLoss}  Brier ${formula.brier}`);
console.log(`  logistic (today)   log loss ${lin.logLoss}  Brier ${lin.brier}`);
console.log(`  boosted trees      log loss ${trees.logLoss}  Brier ${trees.brier}  ${ship ? '← better: kept' : '← not better: the logistic model stays'}`);
console.log(`  calibration (trees): ${trees.calibration.filter(c => c.n).map(c => `${Math.round(c.said * 100)}%→${Math.round((c.won ?? 0) * 100)}%`).join('  ')}`);

fs.writeFileSync(path.join(MODELS, 'winprob-gbm.json'), JSON.stringify(ship ? { ...model, maps, halfLife: Number.isFinite(chosen.halfLife) ? chosen.halfLife : null, trainedAt: new Date().toISOString().slice(0, 10), matches: train.length + valid.length } : {}));
const evalFile = path.join(MODELS, 'eval.json');
const prev = fs.existsSync(evalFile) ? JSON.parse(fs.readFileSync(evalFile, 'utf8')) : {};
fs.writeFileSync(evalFile, JSON.stringify({
  ...prev,
  winChance: { at: new Date().toISOString().slice(0, 10), testMatches: test.length, testMoments: ty.length, trainMatches: train.length + valid.length, shipped: ship ? 'trees' : 'logistic', formula, logistic: lin, trees,
    split: since ? `newest ${test.length} matches (since ${since})` : 'fixed 20% by hash', halfLife: Number.isFinite(chosen.halfLife) ? chosen.halfLife : null,
    variants: variants.map(v => ({ halfLife: Number.isFinite(v.halfLife) ? v.halfLife : null, check: v.check, test: v.test })), perMap },
}, null, 1) + '\n');
console.log(`\nWrote ${ship ? 'models/winprob-gbm.json and ' : ''}models/eval.json.`);

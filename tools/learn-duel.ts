// Trains who wins a duel as boosted trees and tests it honestly: on matches it never learned from.
//   1. every fight in the analyst cache (<folder>/.stratboard-cache/analyst, made by learn:all), from both sides
//   2. the same split as learn:win: the newest 20% of matches (by date) held out, the next newest 10% decides when
//      to stop; newer matches can weigh more (half every 30 / 60 / 90 days, or all the same: best on the check
//      matches), and per map a few trees on top, kept for maps where they beat the shared trees
//   3. on the held-out matches: the logistic duel model (models/duel.json) and the trees (made fair both ways), by
//      log loss and how often they call the winner
//   4. the trees are kept (models/duel-gbm.json) only when they beat the logistic model there; models/eval.json
//      gets the numbers either way
//
//   npm run learn:duel -- <folder> [<folder>…]
import fs from 'node:fs';
import path from 'node:path';
import type { AnalystRound } from '../src/engine/analyst';
import { DUEL2_FEATURES, DUEL_MODEL, duelSamples } from '../src/engine/duelModel';
import { fitGbm, gbmLogit, logLoss } from '../src/engine/gbm';
import { dateSplit, eachCached, matchDates } from './learn-lib';
import type { GbmModel } from '../src/engine/gbm';

const folders = process.argv.slice(2).filter(a => a !== '--');
if (!folders.length) { console.error('Usage: npm run learn:duel -- <folder> [<folder>…]'); process.exit(1); }
const MODELS = path.resolve(import.meta.dirname, '../src/engine/models');

type Set_ = { x: number[][]; x2: number[][]; y: number[]; id: string[]; map: string[] };
const empty = (): Set_ => ({ x: [], x2: [], y: [], id: [], map: [] });
const train = empty(), valid = empty(), test = empty();
const found: { id: string; map: string; s: ReturnType<typeof duelSamples> }[] = [];
const dates: Record<string, number | null> = {};
for (const folder of folders) {
  for (const [key, c] of eachCached<{ map: string | null; rounds: AnalystRound[] }>(folder, 'analyst')) {
    if (!c.map || !c.rounds?.length) continue;
    // the parsed-read id learn:win uses is the key with its non-word characters replaced: same match, same group
    found.push({ id: key.replace(/[^\w.-]+/g, '_'), map: c.map, s: duelSamples(c.rounds.flatMap(r => r.duels ?? [])) });
  }
  Object.assign(dates, matchDates(folder));
}
const matches = found.length;
const split = dateSplit(dates, found.map(f => f.id));
for (const { id, map, s } of found) {
  const g = split.groupOf(id), to = g === 'test' ? test : g === 'valid' ? valid : train;
  to.x.push(...s.x); to.x2.push(...s.x2); to.y.push(...s.y); for (const _ of s.y) { to.id.push(id); to.map.push(map); }
}
console.log(`${matches} matches: ${train.y.length / 2} fights to learn from, ${valid.y.length / 2} to decide when to stop, ${test.y.length / 2} held out.`);

// fair both ways: each fight is in the set from both sides (rows 2i and 2i+1 are the same fight, swapped)
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const fair = (z: (i: number) => number, n: number) => { const p: number[] = []; for (let i = 0; i + 1 < n; i += 2) { const za = z(i), zb = z(i + 1); p.push(sig((za - zb) / 2), sig((zb - za) / 2)); } return p; };
const meanLoss = (p: number[], y: number[]) => +(p.reduce((a, q, i) => a + logLoss(q, y[i]), 0) / Math.max(1, p.length)).toFixed(4);
const t0 = Date.now();
const variants = [Infinity, 90, 60, 30].map(halfLife => {
  const m = fitGbm(train.x2, train.y, DUEL2_FEATURES, {
    trees: 1500, depth: 4, rate: 0.06, minLeaf: 300, lambda: 8, bins: 48, sample: 0.6, patience: 40,
    valid: { x: valid.x2, y: valid.y }, w: train.id.map(id => split.weightOf(id, halfLife)),
  });
  const check = meanLoss(fair(i => gbmLogit(m, valid.x2[i]), valid.y.length), valid.y);
  const held = meanLoss(fair(i => gbmLogit(m, test.x2[i]), test.y.length), test.y);
  console.log(`  ${Number.isFinite(halfLife) ? `newer count more (half every ${halfLife} days)` : 'every match the same'}: ${m.trees.length} trees, check ${check}, test ${held}`);
  return { halfLife, model: m, check, test: held };
});
// a change has to beat noise to count: newer-counts-more only when it beats every-match-the-same by MIN_GAIN on the
// check matches, a map's own trees only when they beat the shared ones by MIN_GAIN on its held-out matches
const MIN_GAIN = 0.0005;
const even = variants[0];
const chosen = variants.slice(1).filter(v => v.check <= even.check - MIN_GAIN).reduce((a, b) => (b.check < a.check ? b : a), even);
const model = chosen.model;
console.log(`Trees: ${model.trees.length}, ${Number.isFinite(chosen.halfLife) ? `half-life ${chosen.halfLife} days` : 'no date weighting'} (best on the check matches), in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

// per map: trees on top of the shared ones (rows stay in fight pairs: a map's rows are whole fights)
const maps: Record<string, GbmModel> = {};
const perMap: Record<string, { fights: number; shared: number; tuned: number; kept: boolean }> = {};
const pick = (st: Set_, map: string) => { const idx = st.map.map((m, i) => (m === map ? i : -1)).filter(i => i >= 0); return { x2: idx.map(i => st.x2[i]), y: idx.map(i => st.y[i]), id: idx.map(i => st.id[i]) }; };
for (const map of [...new Set(found.map(f => f.map))].sort()) {
  const tr = pick(train, map), va = pick(valid, map), te = pick(test, map);
  if (!te.y.length || !va.y.length) continue;
  const tune = fitGbm(tr.x2, tr.y, DUEL2_FEATURES, {
    trees: 400, depth: 3, rate: 0.03, minLeaf: 200, lambda: 10, bins: 48, sample: 0.6, patience: 30,
    valid: { x: va.x2, y: va.y, init: va.x2.map(x => gbmLogit(model, x)) }, w: tr.id.map(id => split.weightOf(id, chosen.halfLife)), init: tr.x2.map(x => gbmLogit(model, x)),
  });
  const shared = meanLoss(fair(i => gbmLogit(model, te.x2[i]), te.y.length), te.y);
  const tuned = meanLoss(fair(i => gbmLogit(model, te.x2[i]) + gbmLogit(tune, te.x2[i]), te.y.length), te.y);
  const kept = tune.trees.length > 0 && tuned <= shared - MIN_GAIN;
  if (kept) maps[map] = tune;
  perMap[map] = { fights: te.y.length / 2, shared, tuned, kept };
  console.log(`  ${map}: ${tune.trees.length} trees on top, test ${shared} → ${tuned}${kept ? '  ← kept' : ''}`);
}

const pTrees = fair(i => gbmLogit(model, test.x2[i]) + (maps[test.map[i]] ? gbmLogit(maps[test.map[i]], test.x2[i]) : 0), test.y.length), pLin: number[] = [];
for (let i = 0; i + 1 < test.y.length; i += 2) {
  const lin = (x: number[]) => sig((DUEL_MODEL?.bias ?? 0) + x.reduce((a, v, j) => a + v * (DUEL_MODEL?.coef[j] ?? 0), 0));
  pLin.push(lin(test.x[i]), lin(test.x[i + 1]));
}
const score = (p: number[]) => ({
  logLoss: +(p.reduce((a, q, i) => a + logLoss(q, test.y[i]), 0) / p.length).toFixed(4),
  accuracy: +(p.filter((q, i) => (q > 0.5) === (test.y[i] === 1)).length / p.length).toFixed(3),
});
const lin = score(pLin), trees = score(pTrees);
const ship = trees.logLoss < lin.logLoss;
console.log(`\nOn ${test.y.length / 2} fights from matches neither learned from:`);
console.log(`  logistic (today)  log loss ${lin.logLoss}  right ${Math.round(lin.accuracy * 1000) / 10}%`);
console.log(`  boosted trees     log loss ${trees.logLoss}  right ${Math.round(trees.accuracy * 1000) / 10}%  ${ship ? '← better: kept' : '← not better: the logistic model stays'}`);

fs.writeFileSync(path.join(MODELS, 'duel-gbm.json'), JSON.stringify(ship ? { ...model, maps, halfLife: Number.isFinite(chosen.halfLife) ? chosen.halfLife : null, trainedAt: new Date().toISOString().slice(0, 10) } : {}));
const evalFile = path.join(MODELS, 'eval.json');
const prev = fs.existsSync(evalFile) ? JSON.parse(fs.readFileSync(evalFile, 'utf8')) : {};
fs.writeFileSync(evalFile, JSON.stringify({ ...prev, duels: { at: new Date().toISOString().slice(0, 10), testFights: test.y.length / 2, trainFights: (train.y.length + valid.y.length) / 2, shipped: ship ? 'trees' : 'logistic', logistic: lin, trees,
  halfLife: Number.isFinite(chosen.halfLife) ? chosen.halfLife : null, variants: variants.map(v => ({ halfLife: Number.isFinite(v.halfLife) ? v.halfLife : null, check: v.check, test: v.test })), perMap } }, null, 1) + '\n');
console.log(`Wrote ${ship ? 'models/duel-gbm.json and ' : ''}models/eval.json.`);

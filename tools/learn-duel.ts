// Trains who wins a duel as boosted trees and tests it honestly: on matches it never learned from.
//   1. every fight in the analyst cache (<folder>/.stratboard-cache/analyst, made by learn:all), from both sides
//   2. the same fixed 20% of matches as learn:win is held out (isTest); of the rest, a tenth decides when to stop
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
import { isTest } from '../src/engine/split';
import { eachCached } from './learn-lib';

const folders = process.argv.slice(2).filter(a => a !== '--');
if (!folders.length) { console.error('Usage: npm run learn:duel -- <folder> [<folder>…]'); process.exit(1); }
const MODELS = path.resolve(import.meta.dirname, '../src/engine/models');

type Set_ = { x: number[][]; x2: number[][]; y: number[] };
const empty = (): Set_ => ({ x: [], x2: [], y: [] });
const train = empty(), valid = empty(), test = empty();
let matches = 0;
for (const folder of folders) {
  for (const [key, c] of eachCached<{ map: string | null; rounds: AnalystRound[] }>(folder, 'analyst')) {
    if (!c.map || !c.rounds?.length) continue;
    matches++;
    const s = duelSamples(c.rounds.flatMap(r => r.duels ?? []));
    // the parsed-read id learn:win uses is the key with its non-word characters replaced: same match, same group
    const id = key.replace(/[^\w.-]+/g, '_');
    const to = isTest(id) ? test : isTest(id, 10, 1) ? valid : train;
    to.x.push(...s.x); to.x2.push(...s.x2); to.y.push(...s.y);
  }
}
console.log(`${matches} matches: ${train.y.length / 2} fights to learn from, ${valid.y.length / 2} to decide when to stop, ${test.y.length / 2} held out.`);

const t0 = Date.now();
const model = fitGbm(train.x2, train.y, DUEL2_FEATURES, {
  trees: 1500, depth: 4, rate: 0.06, minLeaf: 300, lambda: 8, bins: 48, sample: 0.6, patience: 40,
  valid: { x: valid.x2, y: valid.y }, log: s => console.log(s),
});
console.log(`Trees: ${model.trees.length} in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

// fair both ways: each fight is in the set from both sides (rows 2i and 2i+1 are the same fight, swapped)
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const pTrees: number[] = [], pLin: number[] = [];
for (let i = 0; i + 1 < test.y.length; i += 2) {
  const za = gbmLogit(model, test.x2[i]), zb = gbmLogit(model, test.x2[i + 1]);
  pTrees.push(sig((za - zb) / 2), sig((zb - za) / 2));
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

fs.writeFileSync(path.join(MODELS, 'duel-gbm.json'), JSON.stringify(ship ? { ...model, trainedAt: new Date().toISOString().slice(0, 10) } : {}));
const evalFile = path.join(MODELS, 'eval.json');
const prev = fs.existsSync(evalFile) ? JSON.parse(fs.readFileSync(evalFile, 'utf8')) : {};
fs.writeFileSync(evalFile, JSON.stringify({ ...prev, duels: { at: new Date().toISOString().slice(0, 10), testFights: test.y.length / 2, trainFights: (train.y.length + valid.y.length) / 2, shipped: ship ? 'trees' : 'logistic', logistic: lin, trees } }, null, 1) + '\n');
console.log(`Wrote ${ship ? 'models/duel-gbm.json and ' : ''}models/eval.json.`);

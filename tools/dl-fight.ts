// Trains the Deadlock fight model (src/deadlock/fightModel.ts): who wins a fight, from the moment just before it. Reads
// the matches dl:play keeps in tools/.cache/dl-matches (run that first), finds every fight in them, and trains two
// models on each fight both ways round: logistic regression and a small neural network. A fifth of the matches test
// them against "the side with more heroes wins"; the better of the two ships. Then the same again with each side's
// ultimates ready, on the matches dl:ults read the demo of: it ships only if it beats the model without them on the same
// fights (a small correction on top of the model without them). Writes src/deadlock/generated/fightmodel.json.
//
//   npm run dl:fight
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { matchFromMetadata } from '../src/deadlock/match';
import { FIGHT_FEATURES, fightChance, fightFeatures, fightsIn, ULT_STACK_KINDS, ultStackFeatures, type Fight, type FightModel } from '../src/deadlock/fightModel';
import type { DlDemo } from '../src/deadlock/demo';
import { trainMlp, type TrainSet } from '../src/engine/mlp';

const CACHE = path.resolve(import.meta.dirname, '.cache/dl-matches');
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/fightmodel.json');
const ULTS = path.resolve(import.meta.dirname, '.cache/dl-ults');
/** A match's ultimates, when dl:ults read its demo. */
const ultsOf = (id: number): DlDemo['ults'] | null => { try { return JSON.parse(fs.readFileSync(path.join(ULTS, `${id}.json`), 'utf8')).ults ?? null; } catch { return null; } };
if (!fs.existsSync(CACHE)) { console.error('No matches kept yet: run npm run dl:play first.'); process.exit(1); }

// ---- fights ----------------------------------------------------------------------------------------------------------
type Row = { f: Fight; y: number; match: number; ults: boolean };
const rows: Row[] = [];
let matches = 0, even = 0;
for (const file of fs.readdirSync(CACHE).filter(f => f.endsWith('.json.gz'))) {
  const m = matchFromMetadata(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CACHE, file))).toString()));
  if (m.players.length !== 12) continue;
  matches++;
  const ults = ultsOf(m.id);
  for (const f of fightsIn(m, ults)) {
    if (f.deaths[0] === f.deaths[1]) { even++; continue; }
    rows.push({ f, y: f.deaths[0] < f.deaths[1] ? 1 : 0, match: m.id, ults: !!ults });
  }
}
const isTest = (id: number) => id % 5 === 0, isVal = (id: number) => !isTest(id) && id % 10 === 1;
const test = rows.filter(r => isTest(r.match)), val = rows.filter(r => isVal(r.match)), train = rows.filter(r => !isTest(r.match) && !isVal(r.match));
console.log(`${matches} matches: ${rows.length} fights with a winner (${even} even trades left out); ${train.length} to learn from, ${val.length} to stop on, ${test.length} to test`);

// each fight both ways round: A against B, and B against A with the result flipped
const both = (rs: Row[]) => rs.flatMap(r => [{ x: fightFeatures(r.f.t, r.f.sides[0], r.f.sides[1]), y: r.y }, { x: fightFeatures(r.f.t, r.f.sides[1], r.f.sides[0]), y: 1 - r.y }]);

// ---- logistic regression (Newton's method, a little L2) ---------------------------------------------------------------
function logistic(data: { x: number[]; y: number }[]): number[] {
  const d = data[0].x.length + 1, sig = (z: number) => 1 / (1 + Math.exp(-z));
  let w = new Array(d).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const r of data) {
      const x = [1, ...r.x], p = sig(x.reduce((a, v, i) => a + v * w[i], 0)), e = p - r.y, s = p * (1 - p);
      for (let i = 0; i < d; i++) { g[i] += e * x[i]; for (let j = 0; j < d; j++) H[i][j] += s * x[i] * x[j]; }
    }
    for (let i = 1; i < d; i++) { g[i] += 1e-3 * w[i] * data.length; H[i][i] += 1e-3 * data.length; }
    const A = H.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < d; c++) {
      const piv = A.reduce((b, row, i) => (i >= c && Math.abs(row[c]) > Math.abs(A[b][c]) ? i : b), c);
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let i = 0; i < d; i++) if (i !== c) { const f = A[i][c] / A[c][c]; for (let j = c; j <= d; j++) A[i][j] -= f * A[c][j]; }
    }
    const step = A.map((row, i) => row[d] / row[i]);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return w;
}
// the bar to beat: only how many heroes each side has (a model of its own on just that difference)
const nIdx = [FIGHT_FEATURES.indexOf('nA'), FIGHT_FEATURES.indexOf('nB')];
const wNum = logistic(both([...train, ...val]).map(r => ({ x: [r.x[nIdx[0]] - r.x[nIdx[1]]], y: r.y })));
const numbers = (r: Row) => 1 / (1 + Math.exp(-(wNum[0] + wNum[1] * (r.f.sides[0].n - r.f.sides[1].n))));
const logisticModel: FightModel = { kind: 'logistic', weights: logistic(both([...train, ...val])).map(v => +v.toFixed(5)) };

// ---- the network ------------------------------------------------------------------------------------------------------
const set = (rs: Row[]): TrainSet => { const b = both(rs); return { x: b.map(r => r.x), spot: b.map(() => ''), y: b.map(r => r.y) }; };
const { net } = trainMlp(set(train), set(val), { classes: 2, embDim: 1, h1: 24, h2: 12, epochs: 30, batch: 128, lr: 0.002, l2: 1e-4, minSpot: Infinity, seed: 3, log: s => console.log(s) });
const networkModel: FightModel = { kind: 'network', weights: logisticModel.weights, net };

// ---- test --------------------------------------------------------------------------------------------------------------
const score = (pred: (r: Row) => number) => {
  const loss = -test.reduce((a, r) => { const p = Math.min(1 - 1e-9, Math.max(1e-9, pred(r))); return a + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / test.length;
  const acc = test.filter(r => (pred(r) >= 0.5) === (r.y === 1)).length / test.length;
  // fights where the numbers were even: the hard ones, where everything else decides
  const evenN = test.filter(r => r.f.sides[0].n === r.f.sides[1].n);
  const accEven = evenN.length ? evenN.filter(r => (pred(r) >= 0.5) === (r.y === 1)).length / evenN.length : null;
  const calibration = Array.from({ length: 10 }, (_, b) => { const rs = test.filter(r => Math.min(9, Math.floor(pred(r) * 10)) === b); return { bin: b / 10, n: rs.length, won: rs.length ? +(rs.filter(r => r.y).length / rs.length).toFixed(3) : null }; });
  return { logloss: +loss.toFixed(4), accuracy: +acc.toFixed(3), evenNumbers: accEven === null ? null : { n: evenN.length, accuracy: +accEven.toFixed(3) }, calibration };
};
const sNum = score(numbers), sLog = score(r => fightChance(logisticModel, r.f.t, r.f.sides[0], r.f.sides[1])), sNet = score(r => fightChance(networkModel, r.f.t, r.f.sides[0], r.f.sides[1]));
const best = sNet.logloss < sLog.logloss ? networkModel : logisticModel;
// ---- with ultimates: a correction on top of the model above, from the fights whose match had its demo read --------------
// (a model learned from scratch on these alone lost to the one above: it had less than half the fights to learn from)
const uTrain = [...train, ...val].filter(r => r.ults), uTest = test.filter(r => r.ults);
let ults: FightModel['ults'] = null, ultCompare: Record<string, unknown> | null = null;
if (uTrain.length >= 1500 && uTest.length >= 300) {
  const base = (r: Row) => { const strip = (x: Fight['sides'][0]) => ({ ...x, ults: undefined }); return fightChance(best, r.f.t, strip(r.f.sides[0]), strip(r.f.sides[1])); };
  // both ways round, no intercept: the correction is the same from either side
  const data = uTrain.flatMap(r => [{ x: ultStackFeatures(base(r), r.f.sides[0], r.f.sides[1]), y: r.y }, { x: ultStackFeatures(1 - base(r), r.f.sides[1], r.f.sides[0]), y: 1 - r.y }]);
  const fitStack = (cols: number[]) => {
    let w = cols.map(() => 0);
    for (let it = 0; it < 40; it++) {
      const d = cols.length, g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
      for (const r of data) {
        const x = cols.map(c => r.x[c]), p = 1 / (1 + Math.exp(-x.reduce((s, v, i) => s + v * w[i], 0))), e = p - r.y, s2 = p * (1 - p);
        for (let i = 0; i < d; i++) { g[i] += e * x[i]; for (let j = 0; j < d; j++) H[i][j] += s2 * x[i] * x[j]; }
      }
      for (let i = 0; i < d; i++) H[i][i] += 1e-3 * data.length;
      const A = H.map((row, i) => [...row, g[i]]);
      for (let c = 0; c < d; c++) {
        const piv = A.reduce((bb, row, i) => (i >= c && Math.abs(row[c]) > Math.abs(A[bb][c]) ? i : bb), c);
        [A[c], A[piv]] = [A[piv], A[c]];
        for (let i = 0; i < d; i++) if (i !== c) { const f = A[i][c] / A[c][c]; for (let j = c; j <= d; j++) A[i][j] -= f * A[c][j]; }
      }
      w = w.map((v, i) => v - A[i][d] / A[i][i]);
    }
    // back to the full layout (zeros for the columns left out)
    const full = new Array(2 + ULT_STACK_KINDS.length).fill(0);
    cols.forEach((c, i) => { full[c] = +w[i].toFixed(5); });
    return full;
  };
  const on = (pred: (r: Row) => number) => {
    const loss = -uTest.reduce((a2, r) => { const p = Math.min(1 - 1e-9, Math.max(1e-9, pred(r))); return a2 + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / uTest.length;
    return { logloss: +loss.toFixed(4), accuracy: +(uTest.filter(r => (pred(r) >= 0.5) === (r.y === 1)).length / uTest.length).toFixed(3) };
  };
  const withStack = (w: number[]) => (r: Row) => fightChance({ ...best, ults: { kind: 'stack', weights: w } }, r.f.t, r.f.sides[0], r.f.sides[1]);
  const wCount = fitStack([0, 1]), wKinds = fitStack([0, 1, 2, 3, 4]);
  const sNo = on(base), sCount = on(withStack(wCount)), sKinds = on(withStack(wKinds));
  const bestU = sKinds.logloss < sCount.logloss ? { w: wKinds, s: sKinds, name: 'count and kinds' } : { w: wCount, s: sCount, name: 'count' };
  if (bestU.s.logloss < sNo.logloss) ults = { kind: 'stack', weights: bestU.w };
  ultCompare = { fights: uTest.length, matches: new Set(rows.filter(r => r.ults).map(r => r.match)).size, without: sNo, count: sCount, kinds: sKinds, shipped: ults ? bestU.name : null,
    weights: { logOdds: bestU.w[0], ultsReady: bestU.w[1], ...Object.fromEntries(ULT_STACK_KINDS.map((k, i) => [k, bestU.w[2 + i]])) } };
  console.log(`with ultimates (${uTest.length} test fights): without ${sNo.accuracy} (${sNo.logloss}) · + count ${sCount.accuracy} (${sCount.logloss}) · + kinds ${sKinds.accuracy} (${sKinds.logloss}) → ${ults ? `ships ${bestU.name}` : 'not shipped'}`);
  console.log(`  weights: ${JSON.stringify(ultCompare.weights)}`);
} else console.log(`with ultimates: only ${uTrain.length} fights to learn from and ${uTest.length} to test (run npm run dl:ults): not trained`);

const out = {
  at: new Date().toISOString().slice(0, 10), matches, fights: rows.length, evenTrades: even, features: FIGHT_FEATURES,
  ...best, net: best.kind === 'network' ? net : null, ults, ultCompare,
  test: { fights: test.length, ...(best.kind === 'network' ? sNet : sLog) },
  compare: { numbers: { logloss: sNum.logloss, accuracy: sNum.accuracy, evenNumbers: sNum.evenNumbers }, logistic: { logloss: sLog.logloss, accuracy: sLog.accuracy, evenNumbers: sLog.evenNumbers }, network: { logloss: sNet.logloss, accuracy: sNet.accuracy, evenNumbers: sNet.evenNumbers } },
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify(out.compare, null, 1));
console.log(`shipped: ${best.kind} → ${path.relative(process.cwd(), OUT)}`);
console.log(`weights: ${FIGHT_FEATURES.map((f, i) => `${f} ${logisticModel.weights[i + 1].toFixed(3)}`).join(', ')}`);

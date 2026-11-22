// Trains Dota 2's win chance (the coach's "evaluation", like a chess engine's) on recent pro matches: OpenDota's explorer
// gives each match's gold and experience leads by minute and its objectives (buildings, Roshan) in a few big pages, so
// no replay is downloaded. Every minute of every match is read as a moment (winmodel.ts's features, the same code the
// site runs) and two models learn who goes on to win:
//   simple    logistic regression on the differences between the teams
//   network   a small neural network on the same differences (engine/mlp.ts)
// A fifth of the matches are kept back to test both; the better one there (log loss) ships. Writes
// src/dota2/generated/winmodel.json. The matches are cached in tools/.cache, so --again trains without downloading.
//
//   npx vite-node tools/dota-win.ts [-- --days 240 --again]
import fs from 'node:fs';
import path from 'node:path';
import { buildingDowns, type RawMatch } from '../src/dota2/match';
import { FEATURES, features, radiantChance, simpleChance, type WinInput, type WinModel } from '../src/dota2/winmodel';
import { trainMlp, type TrainSet } from '../src/engine/mlp';

const API = 'https://api.opendota.com/api/explorer?sql=';
const args = process.argv.slice(2).filter(a => a !== '--');
const arg = (k: string, d: number) => Number(args[args.indexOf(k) + 1]) || d;
const DAYS = arg('--days', 240), PAGE = 500, AGAIN = args.includes('--again');
const OUT = path.resolve(import.meta.dirname, '../src/dota2/generated/winmodel.json');
const CACHE = path.resolve(import.meta.dirname, '.cache/dota-win-matches.json');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Row = { match_id: number; start_time: number; duration: number; radiant_win: boolean; radiant_gold_adv: number[]; radiant_xp_adv: number[]; objectives: NonNullable<RawMatch['objectives']> };
async function page(before: number | null): Promise<Row[]> {
  const sql = `SELECT match_id, start_time, duration, radiant_win, radiant_gold_adv, radiant_xp_adv, objectives FROM matches
    WHERE radiant_gold_adv IS NOT NULL AND objectives IS NOT NULL AND start_time > extract(epoch from now() - interval '${DAYS} days')
    ${before ? `AND match_id < ${before}` : ''} ORDER BY match_id DESC LIMIT ${PAGE}`;
  for (let i = 0; ; i++) {
    const res = await fetch(API + encodeURIComponent(sql)).catch(() => null);
    const body = res?.ok ? await res.json() as { rows?: Row[]; err?: string | null } : null;
    if (body?.rows && !body.err) return body.rows;
    if (i < 5) { await sleep(5000 * (i + 1)); continue; }
    throw new Error(`OpenDota explorer: ${res?.status} ${body?.err ?? ''}`);
  }
}

let rows: Row[] = [];
if (AGAIN && fs.existsSync(CACHE)) rows = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
else {
  for (let before: number | null = null; ;) {
    const got = await page(before);
    rows.push(...got);
    console.log(`${rows.length} matches`);
    if (got.length < PAGE) break;
    before = got[got.length - 1].match_id;
    await sleep(1200);
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(rows));
}
// matches long enough to have a game in them
rows = rows.filter(r => r.duration >= 15 * 60 && r.radiant_gold_adv?.length > 5);

const inputOf = (r: Row): WinInput => ({
  goldAdv: r.radiant_gold_adv, xpAdv: r.radiant_xp_adv ?? [],
  downs: buildingDowns(r.objectives, r.duration, r.radiant_win ? 0 : 1),
  roshan: r.objectives.filter(o => o.type === 'CHAT_MESSAGE_ROSHAN_KILL').map(o => ({ t: o.time, team: o.team === 2 ? 0 : 1 })),
});
/** Every minute of a match, up to its last. */
const minutesOf = (r: Row) => Array.from({ length: Math.floor(r.duration / 60) }, (_, i) => (i + 1) * 60);
const isTest = (r: Row) => r.match_id % 5 === 0;
const set = (list: Row[]): TrainSet & { t: number[]; input: WinInput[] } => {
  const out = { x: [] as number[][], spot: [] as string[], y: [] as number[], t: [] as number[], input: [] as WinInput[] };
  for (const r of list) {
    const input = inputOf(r);
    for (const t of minutesOf(r)) { out.x.push(features(input, t)); out.spot.push(''); out.y.push(r.radiant_win ? 1 : 0); out.t.push(t); out.input.push(input); }
  }
  return out;
};
const trainRows = rows.filter(r => !isTest(r)), testRows = rows.filter(isTest);
const train = set(trainRows), test = set(testRows);
console.log(`${trainRows.length} matches to learn from (${train.x.length} moments), ${testRows.length} to test on (${test.x.length})`);

// ---- simple: logistic regression by Newton's method, a little L2 so rare features stay small
function logistic(x: number[][], y: number[], l2 = 1e-3, rounds = 25): number[] {
  const D = x[0].length + 1;
  let w = new Array(D).fill(0);
  for (let round = 0; round < rounds; round++) {
    const g = new Array(D).fill(0), H = Array.from({ length: D }, () => new Array(D).fill(0));
    for (let n = 0; n < x.length; n++) {
      const xi = [1, ...x[n]], p = simpleChance(w, x[n]), r = p * (1 - p);
      for (let i = 0; i < D; i++) { g[i] += (p - y[n]) * xi[i]; for (let j = 0; j <= i; j++) H[i][j] += r * xi[i] * xi[j]; }
    }
    for (let i = 0; i < D; i++) { for (let j = 0; j < i; j++) H[j][i] = H[i][j]; if (i) { H[i][i] += l2 * x.length; g[i] += l2 * x.length * w[i]; } }
    const step = solve(H, g);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return w;
}
/** Solves A s = b (Gaussian elimination with pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !M[c][c]) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1));
}

/** How a model does on the test matches: log loss, share called right, and that at a few minutes. */
function score(chanceOf: (i: number) => number) {
  let loss = 0, right = 0;
  const at: Record<string, [number, number]> = {};
  for (let i = 0; i < test.x.length; i++) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, chanceOf(i))), y = test.y[i];
    loss -= y ? Math.log(p) : Math.log(1 - p);
    const ok = (p >= 0.5) === (y === 1);
    if (ok) right++;
    const m = test.t[i] / 60;
    if ([10, 20, 30, 40].includes(m)) { const k = `${m}`; at[k] = at[k] ?? [0, 0]; at[k][0] += ok ? 1 : 0; at[k][1]++; }
  }
  return { logLoss: loss / test.x.length, accuracy: right / test.x.length, byMinute: Object.fromEntries(Object.entries(at).map(([k, [a, b]]) => [k, Math.round((a / b) * 1000) / 1000])) };
}

const weights = logistic(train.x, train.y);
const simple = score(i => simpleChance(weights, test.x[i]));
console.log('simple ', simple, Object.fromEntries(FEATURES.map((f, i) => [f, Math.round(weights[i + 1] * 1000) / 1000])));

const { net } = trainMlp(train, test, { classes: 2, embDim: 1, h1: 32, h2: 16, epochs: 10, batch: 512, lr: 0.002, minSpot: Infinity, log: s => console.log(s) });
const base: WinModel = { since: '', matches: 0, moments: 0, kind: 'network', weights, net, test: { matches: 0, accuracy: 0, logLoss: 0, byMinute: {} } };
const network = score(i => radiantChance(test.input[i], test.t[i], base));
console.log('network', network);

const kind = network.logLoss < simple.logLoss ? 'network' : 'simple', result = kind === 'network' ? network : simple;
const model: WinModel = {
  since: new Date(Math.min(...rows.map(r => r.start_time)) * 1000).toISOString(), matches: rows.length, moments: train.x.length + test.x.length,
  kind, weights: weights.map(w => Math.round(w * 1e5) / 1e5), ...(kind === 'network' ? { net } : {}),
  test: { matches: testRows.length, accuracy: Math.round(result.accuracy * 1000) / 1000, logLoss: Math.round(result.logLoss * 1000) / 1000, byMinute: result.byMinute },
};
fs.writeFileSync(OUT, `${JSON.stringify(model)}\n`);
console.log(`shipped the ${kind} model: ${(result.accuracy * 100).toFixed(1)}% of test moments called right, log loss ${result.logLoss.toFixed(3)}`);

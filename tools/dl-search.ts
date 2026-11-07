// Teaches and calibrates the Deadlock engine's 2-step search (src/deadlock/search.ts) on Phantom-and-up players' own
// moments (the matches dl:play keeps in tools/.cache/dl-matches), and checks that it means something:
//   effects   what each move does to the team's win chance over the next 20 s from a moment like it: for every moment,
//             the value network's chance 20 s on minus now, against what the player did; a ridge regression per move
//             on the play network's inputs (shipped: learned on every match)
//   classes   among good players' moves that weren't the best option, Excellent / Good / Inaccuracy / Mistake end at the
//             30th / 55th / 80th / 93rd percentile of what they gave up (with only 3–4 options a moment, most moves are the
//             best one, so percentiles over all moves would put every class at the floor)
//   replies   how the enemy answers (search.ts Replies): each way is checked below and the best one ships (the worst reply
//             for you, chess-style, came out backwards on 4 Nov: good players don't punish everything)
//   check     does a team that plays closer to the engine's best options win more than the win chance expected at 10
//             minutes? (correlation between the teams' difference in average loss and the surprise in the result.
//             Five folds: each match is searched with effects learned on the other four fifths, so none of it is
//             graded by a model that saw it)
// Writes src/deadlock/generated/dlsearch.json.
//
//   npm run dl:search [-- --step 40]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { matchFromMetadata } from '../src/deadlock/match';
import { effectOf, searchAt, type Effects, type Replies } from '../src/deadlock/search';
import { ACTIONS, actionAt, playInput, WINDOW, type Action } from '../src/deadlock/playNet';
import { winChance } from '../src/deadlock/winChance';
import type { DlMatch } from '../src/deadlock/match';

const args = process.argv.slice(2).filter(a => a !== '--');
const STEP = Number(args[args.indexOf('--step') + 1]) || 40;
const MODES: Replies[] = args.includes('--replies') ? [args[args.indexOf('--replies') + 1] as Replies] : ['worst', 'likely', 'none'];
const CACHE = path.resolve(import.meta.dirname, '.cache/dl-matches');
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/dlsearch.json');
if (!fs.existsSync(CACHE)) { console.error('No matches kept yet: run npm run dl:play first.'); process.exit(1); }

const all: DlMatch[] = [];
for (const file of fs.readdirSync(CACHE).filter(f => f.endsWith('.json.gz'))) {
  const m = matchFromMetadata(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CACHE, file))).toString()));
  if (m.players.length === 12) all.push(m);
}
const fold = (id: number) => id % 5;

// ---- effects: what each move did to the win chance over 20 s --------------------------------------------------------
type Ex = { f: number[]; a: Action; dv: number; fold: number };
const ex: Ex[] = [];
for (const m of all) {
  for (let t = 60; t + WINDOW < m.duration; t += 20) {
    const v0 = winChance(m, null, t, 0), v1 = winChance(m, null, t + WINDOW, 0);
    for (const p of m.players) {
      const x = playInput(m, p.slot, t), a = x ? actionAt(m, p.slot, t) : null;
      if (x && a) ex.push({ f: x.f, a, dv: p.team === 0 ? v1 - v0 : v0 - v1, fold: fold(m.id) });
    }
  }
}
const D = ex[0].f.length;
/** Ridge regression: (XᵀX + λI) w = Xᵀy, with the intercept not shrunk. */
function ridge(rows: Ex[], mu: number[], sd: number[], lambda = 50): number[] {
  const d = D + 1, A = Array.from({ length: d }, () => new Array(d + 1).fill(0));
  for (const r of rows) {
    const x = [1, ...r.f.map((v, i) => (v - mu[i]) / sd[i])];
    for (let i = 0; i < d; i++) { A[i][d] += x[i] * r.dv; for (let j = 0; j < d; j++) A[i][j] += x[i] * x[j]; }
  }
  for (let i = 1; i < d; i++) A[i][i] += lambda;
  for (let c = 0; c < d; c++) {
    const piv = A.reduce((b, row, i) => (i >= c && Math.abs(row[c]) > Math.abs(A[b][c]) ? i : b), c);
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let i = 0; i < d; i++) if (i !== c && A[c][c]) { const f = A[i][c] / A[c][c]; for (let j = c; j <= d; j++) A[i][j] -= f * A[c][j]; }
  }
  return A.map((row, i) => +(row[d] / (row[i] || 1)).toFixed(6));
}
function fit(learn: Ex[]): Effects {
  const mu = Array.from({ length: D }, (_, i) => learn.reduce((a, e) => a + e.f[i], 0) / learn.length);
  const sd = Array.from({ length: D }, (_, i) => Math.sqrt(learn.reduce((a, e) => a + (e.f[i] - mu[i]) ** 2, 0) / learn.length) || 1);
  return { mu: mu.map(v => +v.toFixed(5)), sd: sd.map(v => +v.toFixed(5)), w: Object.fromEntries(ACTIONS.map(a => [a, ridge(learn.filter(e => e.a === a), mu, sd)])) as Record<Action, number[]> };
}
const effects = fit(ex);
const byFold = [0, 1, 2, 3, 4].map(k => fit(ex.filter(e => e.fold !== k)));
// how much of the 20-s change it explains on matches it didn't learn from, against each move's plain average
let seModel = 0, seMean = 0, seAll = 0;
const avgAll = ex.reduce((s, e) => s + e.dv, 0) / ex.length;
for (let k = 0; k < 5; k++) {
  const learn = ex.filter(e => e.fold !== k), held = ex.filter(e => e.fold === k);
  const meanOf = Object.fromEntries(ACTIONS.map(a => { const r = learn.filter(e => e.a === a); return [a, r.reduce((s, e) => s + e.dv, 0) / Math.max(1, r.length)]; }));
  for (const e of held) { seModel += (effectOf(byFold[k], e.f, e.a) - e.dv) ** 2; seMean += (meanOf[e.a] - e.dv) ** 2; seAll += (avgAll - e.dv) ** 2; }
}
const effectFit = { moments: ex.length, r2Mean: +(1 - seMean / seAll).toFixed(4), r2Model: +(1 - seModel / seAll).toFixed(4) };
console.log(`effects: ${ex.length} moments; explains ${(effectFit.r2Model * 100).toFixed(1)}% of the 20-s change on unseen matches (each move's average alone: ${(effectFit.r2Mean * 100).toFixed(1)}%)`);

// ---- every reply mode: grade every match (out of fold), check against results, class edges -------------------------------
function run(mode: Replies) {
  const losses: number[] = [], players: number[] = [];
  const teams: { lossDiff: number; surprise: number }[] = [];
  let best = 0;
  const t0 = Date.now();
  for (const m of all) {
    const byTeam: number[][] = [[], []], bySlot = new Map<number, number[]>();
    for (let t = 120; t < m.duration; t += STEP) {
      for (const p of m.players) {
        const s = searchAt(m, null, p.slot, t, byFold[fold(m.id)], mode);
        if (!s?.played) continue;
        byTeam[p.team].push(s.loss);
        bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), s.loss]);
        losses.push(s.loss);
        if (s.loss <= 0.002) best++;
      }
    }
    const avg = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / Math.max(1, xs.length);
    for (const xs of bySlot.values()) if (xs.length >= 20) players.push(avg(xs));
    // team 0's side: how much less it gave up than team 1, against how much better it did than expected at 10 min
    if (m.duration > 900) teams.push({ lossDiff: avg(byTeam[1]) - avg(byTeam[0]), surprise: (m.winner === 0 ? 1 : 0) - winChance(m, null, 600, 0) });
  }
  const n = teams.length, mx = teams.reduce((a, r) => a + r.lossDiff, 0) / n, my = teams.reduce((a, r) => a + r.surprise, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const r of teams) { sxy += (r.lossDiff - mx) * (r.surprise - my); sxx += (r.lossDiff - mx) ** 2; syy += (r.surprise - my) ** 2; }
  const corr = sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : 0;
  console.log(`  replies '${mode}': check ${corr} on ${n} matches, ${Math.round((best / losses.length) * 100)}% of moves the best (${Math.round((Date.now() - t0) / 1000)} s)`);
  return { mode, losses, best, corr, teams: n, players };
}
const runs = MODES.map(run);
const chosen = runs.reduce((a, b) => (b.corr > a.corr ? b : a));
const { losses, best } = chosen;
// accuracy (chess.com's curve on the average win chance given up, in points): a typical good player's game scores 90
const ps = [...chosen.players].sort((a, b) => a - b), med = ps[ps.length >> 1] * 100;
const accuracyScale = +((-Math.log(93.1669 / 103.1668) / 0.04354) / Math.max(1e-6, med)).toFixed(4);
const matches = all.length;
const sorted = losses.filter(l => l > 0.002).sort((a, b) => a - b);
const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const thresholds: number[] = [];
// fixed cut-offs (src/deadlock/search.ts): a Mistake 3+ points, a Blunder 8+
thresholds.push(0.005, 0.012, 0.03, 0.08);
const cls = (l: number) => (l <= 0.002 ? 'Best' : l <= thresholds[0] ? 'Excellent' : l <= thresholds[1] ? 'Good' : l <= thresholds[2] ? 'Inaccuracy' : l <= thresholds[3] ? 'Mistake' : 'Blunder');
const classes: Record<string, number> = {};
for (const l of losses) classes[cls(l)] = (classes[cls(l)] ?? 0) + 1;
const out = {
  thresholds, replies: chosen.mode, accuracyScale, playerLoss: { median: +(med / 100).toFixed(5), p25: +ps[Math.floor(ps.length * 0.25)].toFixed(5), p75: +ps[Math.floor(ps.length * 0.75)].toFixed(5) }, moments: losses.length, matches, step: STEP, calibratedAt: new Date().toISOString().slice(0, 10), effects, effectFit,
  bestShare: +(best / losses.length).toFixed(3), classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, +(v / losses.length).toFixed(3)])),
  check: { corr: chosen.corr, teams: chosen.teams, byReplies: Object.fromEntries(runs.map(r => [r.mode, r.corr])) },
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify({ ...out, effects: undefined }, null, 1));
console.log(`→ ${path.relative(process.cwd(), OUT)}`);

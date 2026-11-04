// Trains the Deadlock coach's win-chance model on high-rank public matches since the current patch (deadlock-api's
// bulk match data: every player's numbers every few minutes, objectives, Mid Boss). At each snapshot of each match the
// game state is read (souls lead, kills, objectives, Mid Bosses) and a logistic model learns who goes on to win. A
// fifth of the matches are kept back to check it. Writes src/deadlock/generated/winmodel.json, which the coach uses to
// put a win chance on every moment (src/deadlock/winmodel.ts).
//
//   npm run dl:train [-- --matches 4000 --min-badge 91]
import fs from 'node:fs';
import path from 'node:path';
import { FEATURES, features, type State } from '../src/deadlock/winmodel';
import { gameplayPatches } from '../src/deadlock/patchFeed';

const API = 'https://api.deadlock-api.com';
const args = process.argv.slice(2).filter(a => a !== '--');
const arg = (k: string, d: number) => Number(args[args.indexOf(k) + 1]) || d;
const want = arg('--matches', 4000), minBadge = arg('--min-badge', 91);
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/winmodel.json');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get<T>(url: string): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(API + url).catch(() => null);
    if (res?.ok) return res.json() as Promise<T>;
    if (i < 6) { await sleep(5000 * (i + 1)); continue; }
    throw new Error(`${url}: ${res?.status}`);
  }
}

type S = { time_stamp_s: number; net_worth: number; kills: number };
type P = { team: string; abandon_match_time_s?: number; stats?: S[] };
type O = { team: string; team_objective: string; destroyed_time_s: number };
type M = { match_id: number; duration_s: number; winning_team: string; players?: P[]; objectives?: O[]; mid_boss?: { team_claimed: string; destroyed_time_s: number }[] };
const T0 = (t: string) => t === 'Team0';

/** The state at time t, from team 0's side (the model is symmetric in the teams: see winmodel.ts). */
function stateAt(m: M, t: number): State {
  const last = (p: P) => [...(p.stats ?? [])].reverse().find(s => s.time_stamp_s <= t + 1);
  let nw0 = 0, nw1 = 0, k0 = 0, k1 = 0;
  for (const p of m.players!) { const s = last(p); if (!s) continue; if (T0(p.team)) { nw0 += s.net_worth; k0 += s.kills; } else { nw1 += s.net_worth; k1 += s.kills; } }
  // objectives lost by each team (the objective's team is its owner)
  const lost = (team0: boolean, re: RegExp) => (m.objectives ?? []).filter(o => T0(o.team) === team0 && o.destroyed_time_s > 0 && o.destroyed_time_s <= t && re.test(o.team_objective)).length;
  const boss = (team0: boolean) => (m.mid_boss ?? []).filter(b => T0(b.team_claimed) === team0 && b.destroyed_time_s <= t).length;
  return {
    t, souls: [nw0, nw1], kills: [k0, k1],
    guardians: [lost(true, /^Tier1/), lost(false, /^Tier1/)], walkers: [lost(true, /^Tier2/), lost(false, /^Tier2/)],
    base: [lost(true, /^(BarrackBoss|TitanShieldGenerator)/), lost(false, /^(BarrackBoss|TitanShieldGenerator)/)],
    midBoss: [boss(true), boss(false)],
  };
}

// ---- collect -----------------------------------------------------------------------------------------------------
const patch = (await gameplayPatches())[0];
const days = await get<string[]>('/v1/patches/big-days');
const since = Math.max(patch?.at ?? 0, Math.floor(Date.parse(days[0]) / 1000));
console.log(`training on matches since ${new Date(since * 1000).toISOString().slice(0, 10)}${patch ? ` (${patch.title})` : ''}, average badge ${minBadge}+`);
const rows: { x: number[]; y: number; match: number; t: number }[] = [];
let seen = 0, maxId: number | undefined;
while (seen < want) {
  const page = await get<M[]>(`/v1/matches/metadata?include_info=true&include_objectives=true&include_mid_boss=true&include_player_info=true&include_player_stats=true&game_mode=normal`
    + `&min_average_badge=${minBadge}&min_unix_timestamp=${since}&min_duration_s=900&order_by=match_id&order_direction=desc&limit=100${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
  if (!page.length) break;
  for (const m of page) {
    const ps = m.players ?? [];
    if (ps.length !== 12 || ps.some(p => (p.abandon_match_time_s ?? 0) > 0 || !p.stats?.length)) continue;
    const times = [...new Set(ps.flatMap(p => p.stats!.map(s => s.time_stamp_s)))].filter(t => t > 0 && t < m.duration_s).sort((a, b) => a - b);
    for (const t of times) rows.push({ x: features(stateAt(m, t)), y: T0(m.winning_team) ? 1 : 0, match: m.match_id, t });
    seen++;
  }
  maxId = Math.min(...page.map(m => m.match_id));
  console.log(`  ${seen} matches, ${rows.length} moments`);
  await sleep(2100);
}

// ---- fit (logistic regression, Newton's method with a little L2) -------------------------------------------------------
const isTest = (id: number) => id % 5 === 0;
const train = rows.filter(r => !isTest(r.match)), test = rows.filter(r => isTest(r.match));
const d = FEATURES.length + 1;
const X = (r: { x: number[] }) => [1, ...r.x];
const sig = (z: number) => 1 / (1 + Math.exp(-z));
let w = new Array(d).fill(0);
for (let it = 0; it < 25; it++) {
  const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const r of train) {
    const x = X(r), p = sig(x.reduce((a, v, i) => a + v * w[i], 0)), e = p - r.y, s = p * (1 - p);
    for (let i = 0; i < d; i++) { g[i] += e * x[i]; for (let j = 0; j < d; j++) H[i][j] += s * x[i] * x[j]; }
  }
  for (let i = 1; i < d; i++) { g[i] += 1e-3 * w[i] * train.length; H[i][i] += 1e-3 * train.length; }
  // solve H · step = g (Gaussian elimination)
  const A = H.map((row, i) => [...row, g[i]]);
  for (let c = 0; c < d; c++) {
    const piv = A.reduce((b, row, i) => (i >= c && Math.abs(row[c]) > Math.abs(A[b][c]) ? i : b), c);
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let i = 0; i < d; i++) if (i !== c) { const f = A[i][c] / A[c][c]; for (let j = c; j <= d; j++) A[i][j] -= f * A[c][j]; }
  }
  const step = A.map((row, i) => row[d] / row[i]);
  w = w.map((v, i) => v - step[i]);
  if (Math.max(...step.map(Math.abs)) < 1e-6) break;
}

// ---- check on the held-back matches ---------------------------------------------------------------------------------
const pred = (r: { x: number[] }) => sig(X(r).reduce((a, v, i) => a + v * w[i], 0));
const logloss = (rs: typeof rows) => -rs.reduce((a, r) => { const p = Math.min(1 - 1e-9, Math.max(1e-9, pred(r))); return a + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / rs.length;
const acc = (rs: typeof rows) => rs.filter(r => (pred(r) >= 0.5) === (r.y === 1)).length / rs.length;
const base = test.filter(r => r.y).length / test.length;
// by game time: how sure and how right it is at 6, 15, 25 minutes
const at = (lo: number, hi: number) => { const rs = test.filter(r => r.t / 60 >= lo && r.t / 60 < hi); return rs.length ? { n: rs.length, accuracy: +acc(rs).toFixed(3) } : null; };
// calibration: in each tenth of predicted chance, how often it really happened
const calib = Array.from({ length: 10 }, (_, b) => { const rs = test.filter(r => Math.min(9, Math.floor(pred(r) * 10)) === b); return { bin: b / 10, n: rs.length, won: rs.length ? +(rs.filter(r => r.y).length / rs.length).toFixed(3) : null }; });
const out = {
  since: new Date(since * 1000).toISOString(), patch: patch?.title ?? null, minBadge, matches: seen, moments: rows.length,
  features: FEATURES, weights: [w[0], ...w.slice(1)].map(v => +v.toFixed(5)),
  test: { matches: new Set(test.map(r => r.match)).size, logloss: +logloss(test).toFixed(4), coinflip: +(-(base * Math.log(base) + (1 - base) * Math.log(1 - base))).toFixed(4), accuracy: +acc(test).toFixed(3),
    early: at(0, 10), mid: at(10, 20), late: at(20, 99), calibration: calib },
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out.test, calibration: undefined }, null, 1));
console.log(`weights: ${FEATURES.map((f, i) => `${f} ${w[i + 1].toFixed(3)}`).join(', ')} (intercept ${w[0].toFixed(3)})`);
console.log(`→ ${path.relative(process.cwd(), OUT)}`);

// Trains the Deadlock coach's win chance (its "evaluation", like a chess engine's) on high-rank public matches since the
// current patch (deadlock-api's bulk match data: every player's numbers every few minutes, deaths, objectives, Mid
// Boss). Every minute of every match is read as a moment (winChance.ts's valueStateAt, the same code the site runs)
// and two models learn who goes on to win:
//   simple    logistic regression on the differences between the teams (winmodel.ts)
//   network   the value network: a small neural network that sees each team as it is (valueNet.ts)
// A fifth of the matches are kept back to test both, a tenth more picks when the network stops learning. The better one
// on the test matches (log loss) ships. Writes src/deadlock/generated/winmodel.json (src/deadlock/winChance.ts reads it).
// The matches are cached in tools/.cache, so a second run (or --again) trains without downloading them again.
//
//   npm run dl:train [-- --matches 4000 --min-badge 91]
import fs from 'node:fs';
import path from 'node:path';
import { FEATURES, features } from '../src/deadlock/winmodel';
import { gameplayPatches } from '../src/deadlock/patchFeed';
import { valueStateAt } from '../src/deadlock/winChance';
import { mirror, simpleState, VALUE_FEATURES, valueChance, valueFeatures, type ValueState } from '../src/deadlock/valueNet';
import { trainMlp, type TrainSet } from '../src/engine/mlp';
import { objectiveOf, type DlTeam } from '../src/deadlock/data';
import type { DlMatch } from '../src/deadlock/match';

const API = 'https://api.deadlock-api.com';
const args = process.argv.slice(2).filter(a => a !== '--');
const arg = (k: string, d: number) => Number(args[args.indexOf(k) + 1]) || d;
const want = arg('--matches', 4000), minBadge = arg('--min-badge', 91);
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/winmodel.json');
const CACHE = path.resolve(import.meta.dirname, '.cache');
const STEP = 60;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get<T>(url: string): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(API + url).catch(() => null);
    if (res?.ok) return res.json() as Promise<T>;
    if (i < 6) { await sleep(5000 * (i + 1)); continue; }
    throw new Error(`${url}: ${res?.status}`);
  }
}

type S = { time_stamp_s: number; net_worth: number; level: number };
type D = { game_time_s: number; killer_player_slot?: number | null; death_duration_s?: number };
type P = { player_slot: number; team: string; abandon_match_time_s?: number; stats?: S[]; death_details?: D[] };
type O = { team: string; team_objective: string; destroyed_time_s: number };
type M = { match_id: number; duration_s: number; winning_team: string; players?: P[]; objectives?: O[]; mid_boss?: { team_claimed: string; destroyed_time_s: number }[] };
const teamOf = (t: string): DlTeam => (t === 'Team0' ? 0 : 1);
// Valve's objective names, as the ids the site's match data uses (objectiveOf)
const OBJ_ID: Record<string, number> = { Core: 0, Titan: 9, TitanShieldGenerator1: 10, TitanShieldGenerator2: 11 };
for (let n = 1; n <= 4; n++) { OBJ_ID[`Tier1Lane${n}`] = n; OBJ_ID[`Tier2Lane${n}`] = n + 4; OBJ_ID[`BarrackBossLane${n}`] = n + 11; }

/** Just what valueStateAt reads, in the site's match shape. */
function asMatch(m: M): DlMatch {
  const ps = m.players!;
  return {
    id: m.match_id, start: 0, duration: m.duration_s, winner: teamOf(m.winning_team),
    players: ps.map(p => ({ slot: p.player_slot, team: teamOf(p.team) })),
    stats: Object.fromEntries(ps.map(p => [p.player_slot, (p.stats ?? []).map(s => ({ t: s.time_stamp_s, netWorth: s.net_worth, level: s.level }))])),
    deaths: ps.flatMap(p => (p.death_details ?? []).map(d => ({ t: d.game_time_s, slot: p.player_slot, killer: d.killer_player_slot ?? null, respawn: d.death_duration_s ?? 0 }))),
    objectives: (m.objectives ?? []).filter(o => OBJ_ID[o.team_objective] !== undefined).map(o => ({ team: teamOf(o.team), ...objectiveOf(OBJ_ID[o.team_objective]), destroyed: o.destroyed_time_s || null })),
    midBoss: (m.mid_boss ?? []).map(b => ({ t: b.destroyed_time_s, team: teamOf(b.team_claimed) })),
  } as unknown as DlMatch;
}

// ---- collect (or read the cache) ------------------------------------------------------------------------------------
const patch = (await gameplayPatches())[0];
const days = await get<string[]>('/v1/patches/big-days');
const since = Math.max(patch?.at ?? 0, Math.floor(Date.parse(days[0]) / 1000));
console.log(`training on matches since ${new Date(since * 1000).toISOString().slice(0, 10)}${patch ? ` (${patch.title})` : ''}, average badge ${minBadge}+`);
const cacheFile = path.join(CACHE, `dl-train-${since}-${minBadge}.json`);
let matches: M[] = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : [];
if (matches.length < want) {
  let maxId = matches.length ? Math.min(...matches.map(m => m.match_id)) : undefined;
  while (matches.length < want) {
    const page = await get<M[]>(`/v1/matches/metadata?include_info=true&include_objectives=true&include_mid_boss=true&include_player_info=true&include_player_stats=true`
      + `&include_player_death_details=true&game_mode=normal&min_average_badge=${minBadge}&min_unix_timestamp=${since}&min_duration_s=900&order_by=match_id&order_direction=desc`
      + `&limit=100${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
    if (!page.length) break;
    for (const m of page) {
      const ps = m.players ?? [];
      if (ps.length !== 12 || ps.some(p => (p.abandon_match_time_s ?? 0) > 0 || !p.stats?.length)) continue;
      // only what training reads (a page is tens of MB)
      matches.push({
        match_id: m.match_id, duration_s: m.duration_s, winning_team: m.winning_team, objectives: m.objectives, mid_boss: m.mid_boss,
        players: ps.map(p => ({ player_slot: p.player_slot, team: p.team, stats: p.stats!.map(s => ({ time_stamp_s: s.time_stamp_s, net_worth: s.net_worth, level: s.level })),
          death_details: (p.death_details ?? []).map(d => ({ game_time_s: d.game_time_s, killer_player_slot: d.killer_player_slot, death_duration_s: d.death_duration_s })) })),
      });
    }
    maxId = Math.min(...page.map(m => m.match_id));
    console.log(`  ${matches.length} matches`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(matches));
    await sleep(2100);
  }
}
matches = matches.slice(0, want);

// ---- moments ----------------------------------------------------------------------------------------------------------
type Row = { s: ValueState; y: number; match: number };
const rows: Row[] = [];
for (const m of matches) {
  const dm = asMatch(m), y = dm.winner === 0 ? 1 : 0;
  for (let t = STEP; t < m.duration_s; t += STEP) rows.push({ s: valueStateAt(dm, null, t), y, match: m.match_id });
}
// a fifth to test both models; a tenth of the rest picks the network's best epoch
const isTest = (id: number) => id % 5 === 0, isVal = (id: number) => !isTest(id) && id % 10 === 1;
const test = rows.filter(r => isTest(r.match)), val = rows.filter(r => isVal(r.match)), train = rows.filter(r => !isTest(r.match) && !isVal(r.match));
console.log(`${matches.length} matches, ${rows.length} moments (${train.length} to learn from, ${val.length} to stop on, ${test.length} to test)`);

// ---- the simple model: logistic regression, Newton's method with a little L2 -------------------------------------------
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const d = FEATURES.length + 1;
const X = (r: Row) => [1, ...features(simpleState(r.s))];
const fitRows = [...train, ...val];
let w = new Array(d).fill(0);
for (let it = 0; it < 25; it++) {
  const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const r of fitRows) {
    const x = X(r), p = sig(x.reduce((a, v, i) => a + v * w[i], 0)), e = p - r.y, s = p * (1 - p);
    for (let i = 0; i < d; i++) { g[i] += e * x[i]; for (let j = 0; j < d; j++) H[i][j] += s * x[i] * x[j]; }
  }
  for (let i = 1; i < d; i++) { g[i] += 1e-3 * w[i] * fitRows.length; H[i][i] += 1e-3 * fitRows.length; }
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
const simple = (r: Row) => sig(X(r).reduce((a, v, i) => a + v * w[i], 0));

// ---- the value network -------------------------------------------------------------------------------------------------
// each moment both ways round (the teams swapped, the result flipped): it learns the game, not a side
const asSet = (rs: Row[], both: boolean): TrainSet => {
  const out: TrainSet = { x: [], spot: [], y: [] };
  for (const r of rs) {
    out.x.push(valueFeatures(r.s)); out.spot.push(''); out.y.push(r.y);
    if (both) { out.x.push(valueFeatures(mirror(r.s))); out.spot.push(''); out.y.push(1 - r.y); }
  }
  return out;
};
const { net } = trainMlp(asSet(train, true), asSet(val, true), { classes: 2, embDim: 1, h1: 32, h2: 16, epochs: 14, batch: 256, lr: 0.002, l2: 1e-4, minSpot: Infinity, seed: 11, log: s => console.log(s) });
const network = (r: Row) => valueChance(net, r.s);

// ---- test both on the held-back matches --------------------------------------------------------------------------------
const score = (pred: (r: Row) => number) => {
  const logloss = -test.reduce((a, r) => { const p = Math.min(1 - 1e-9, Math.max(1e-9, pred(r))); return a + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / test.length;
  const acc = (rs: Row[]) => (rs.length ? +(rs.filter(r => (pred(r) >= 0.5) === (r.y === 1)).length / rs.length).toFixed(3) : null);
  const at = (lo: number, hi: number) => { const rs = test.filter(r => r.s.t / 60 >= lo && r.s.t / 60 < hi); return rs.length ? { n: rs.length, accuracy: acc(rs) } : null; };
  const calibration = Array.from({ length: 10 }, (_, b) => { const rs = test.filter(r => Math.min(9, Math.floor(pred(r) * 10)) === b); return { bin: b / 10, n: rs.length, won: rs.length ? +(rs.filter(r => r.y).length / rs.length).toFixed(3) : null }; });
  return { logloss: +logloss.toFixed(4), accuracy: acc(test)!, early: at(0, 10), mid: at(10, 20), late: at(20, 99), calibration };
};
const base = test.filter(r => r.y).length / test.length;
const coinflip = +(-(base * Math.log(base) + (1 - base) * Math.log(1 - base))).toFixed(4);
const s1 = score(simple), s2 = score(network);
const kind = s2.logloss < s1.logloss ? 'network' : 'simple';
const won = kind === 'network' ? s2 : s1;
const out = {
  since: new Date(since * 1000).toISOString(), patch: patch?.title ?? null, minBadge, matches: matches.length, moments: rows.length, kind,
  features: FEATURES, weights: w.map(v => +v.toFixed(5)),
  ...(kind === 'network' ? { valueFeatures: VALUE_FEATURES, net } : {}),
  test: { matches: new Set(test.map(r => r.match)).size, coinflip, ...won },
  compare: { simple: { logloss: s1.logloss, accuracy: s1.accuracy, early: s1.early, mid: s1.mid, late: s1.late }, network: { logloss: s2.logloss, accuracy: s2.accuracy, early: s2.early, mid: s2.mid, late: s2.late } },
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify(out.compare, null, 1));
console.log(`coin flip ${coinflip} · shipped: ${kind}`);
console.log(`→ ${path.relative(process.cwd(), OUT)}`);

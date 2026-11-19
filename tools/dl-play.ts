// Trains the Deadlock play network (src/deadlock/playNet.ts): what Phantom-and-up players do at each moment. High-rank
// normal matches since the patch, each one's paths (every player once a second, deadlock-api's match metadata); every
// 20 s of every living player is a moment, labelled with what they really did next (actionAt). A fifth of the matches
// test it, a tenth more picks when it stops learning; it's compared with simply guessing each action's usual share at
// that minute. Writes src/deadlock/generated/playnet.json. Matches are kept gzipped in tools/.cache/dl-matches (the
// fight model will read them too).
//
//   npm run dl:play [-- --matches 300 --min-badge 91]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { gameplayPatches } from '../src/deadlock/patchFeed';
import { matchFromMetadata, type DlMatch } from '../src/deadlock/match';
import { ACTIONS, actionAt, playInput, WINDOW } from '../src/deadlock/playNet';
import { mlpPredict, trainMlp, type TrainSet } from '../src/engine/mlp';

const API = 'https://api.deadlock-api.com';
const args = process.argv.slice(2).filter(a => a !== '--');
const arg = (k: string, d: number) => Number(args[args.indexOf(k) + 1]) || d;
const want = arg('--matches', 300), minBadge = arg('--min-badge', 91);
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/playnet.json');
const CACHE = path.resolve(import.meta.dirname, '.cache/dl-matches');
const STEP = 20;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get<T>(url: string, tries = 6): Promise<T | null> {
  for (let i = 0; ; i++) {
    const res = await fetch(API + url).catch(() => null);
    if (res?.ok) return res.json() as Promise<T>;
    if (res?.status === 404) return null;
    if (i < tries) { await sleep(3000 * (i + 1)); continue; }
    return null;
  }
}
/** A match's metadata: from the cache, else deadlock-api (then cached). */
async function metadata(id: number): Promise<unknown | null> {
  const f = path.join(CACHE, `${id}.json.gz`);
  if (fs.existsSync(f)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
  const meta = await get<unknown>(`/v1/matches/${id}/metadata`, 2);
  if (meta) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(meta))); await sleep(250); }
  return meta;
}

const patch = (await gameplayPatches())[0];
const days = (await get<string[]>('/v1/patches/big-days')) ?? [];
const since = Math.max(patch?.at ?? 0, Math.floor(Date.parse(days[0] ?? '') / 1000) || 0);
console.log(`play network: matches since ${new Date(since * 1000).toISOString().slice(0, 10)}, average badge ${minBadge}+`);

// ---- moments ----------------------------------------------------------------------------------------------------------
type Row = { f: number[]; spot: string; y: number; match: number; t: number };
const rows: Row[] = [];
let used = 0, maxId: number | undefined;
const t0 = Date.now();
outer: while (used < want) {
  const page = await get<{ match_id: number; players?: { abandon_match_time_s?: number }[] }[]>(`/v1/matches/metadata?include_player_info=true&game_mode=normal`
    + `&min_average_badge=${minBadge}&min_unix_timestamp=${since}&min_duration_s=1200&order_by=match_id&order_direction=desc&limit=200${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
  if (!page?.length) break;
  for (const row of page) {
    maxId = row.match_id;
    if ((row.players ?? []).some(p => (p.abandon_match_time_s ?? 0) > 0)) continue;
    const meta = await metadata(row.match_id);
    if (!meta) continue;
    const m: DlMatch = matchFromMetadata(meta);
    if (m.players.length !== 12) continue;
    for (let t = 60; t + WINDOW < m.duration; t += STEP) {
      for (const p of m.players) {
        const x = playInput(m, p.slot, t), a = x ? actionAt(m, p.slot, t) : null;
        if (x && a) rows.push({ f: x.f, spot: x.spot, y: ACTIONS.indexOf(a), match: m.id, t });
      }
    }
    used++;
    if (used % 25 === 0) console.log(`  ${used} matches, ${rows.length} moments (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (used >= want) break outer;
  }
}

const isTest = (id: number) => id % 5 === 0, isVal = (id: number) => !isTest(id) && id % 10 === 1;
const test = rows.filter(r => isTest(r.match)), val = rows.filter(r => isVal(r.match)), train = rows.filter(r => !isTest(r.match) && !isVal(r.match));
const share = ACTIONS.map((_, k) => rows.filter(r => r.y === k).length / rows.length);
console.log(`${used} matches, ${rows.length} moments: ${ACTIONS.map((a, k) => `${a} ${Math.round(share[k] * 100)}%`).join(', ')}`);

// ---- the baseline: each action's usual share at that minute (5-minute buckets) -------------------------------------------
const bucket = (t: number) => Math.min(8, Math.floor(t / 300));
const counts = Array.from({ length: 9 }, () => ACTIONS.map(() => 1));
for (const r of train) counts[bucket(r.t)][r.y]++;
const baseline = (r: Row) => { const c = counts[bucket(r.t)], n = c.reduce((a, v) => a + v, 0); return c.map(v => v / n); };

// ---- the network --------------------------------------------------------------------------------------------------------
const set = (rs: Row[]): TrainSet => ({ x: rs.map(r => r.f), spot: rs.map(r => r.spot), y: rs.map(r => r.y) });
const { net } = trainMlp(set(train), set(val), { classes: ACTIONS.length, embDim: 6, h1: 48, h2: 24, epochs: 8, batch: 256, lr: 0.002, l2: 1e-5, minSpot: 40, seed: 5, log: s => console.log(s) });

// ---- test -------------------------------------------------------------------------------------------------------------------
const score = (pred: (r: Row) => number[]) => {
  let loss = 0, hit = 0, top2 = 0;
  const recall = ACTIONS.map(() => [0, 0]);
  for (const r of test) {
    const p = pred(r), order = p.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    loss -= Math.log(Math.max(1e-7, p[r.y]));
    if (order[0] === r.y) hit++;
    if (order[0] === r.y || order[1] === r.y) top2++;
    recall[r.y][1]++; if (order[0] === r.y) recall[r.y][0]++;
  }
  return { logloss: +(loss / test.length).toFixed(4), accuracy: +(hit / test.length).toFixed(3), top2: +(top2 / test.length).toFixed(3),
    recall: Object.fromEntries(ACTIONS.map((a, k) => [a, recall[k][1] ? +(recall[k][0] / recall[k][1]).toFixed(3) : null])) };
};
const sBase = score(baseline), sNet = score(r => mlpPredict(net, r.f, r.spot));
const out = {
  since: new Date(since * 1000).toISOString(), patch: patch?.title ?? null, minBadge, matches: used, moments: rows.length, actions: ACTIONS, share: share.map(v => +v.toFixed(3)),
  ships: sNet.logloss < sBase.logloss, test: { matches: new Set(test.map(r => r.match)).size, network: sNet, baseline: sBase },
  net: sNet.logloss < sBase.logloss ? net : null,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify(out.test, null, 1));
console.log(`→ ${path.relative(process.cwd(), OUT)}${out.ships ? '' : ' (the network didn\'t beat the baseline: not shipped)'}`);

// Learns what normal looks like in Deadlock from everyone's recent public matches (deadlock-api's bulk match data):
// every player's position (by farm, as dl-positions) and their numbers every few minutes (net worth, last hits,
// kills, deaths, damage, healing, where their souls came from), averaged per position and per hero in a position.
// Pages are read and added up one by one; nothing raw is kept. Writes src/deadlock/generated/bench.json, which the
// coach (laning, deaths) and Match recap compare players with.
//
//   npm run dl:learn [-- --matches 3000]
//   npm run dl:learn -- --matches 4000 --min-badge 91 --out bench-high.json   (high-rank players only: Phantom and up)
import fs from 'node:fs';
import path from 'node:path';
import { gameplayPatches } from '../src/deadlock/patchFeed';

const API = 'https://api.deadlock-api.com';
const args = process.argv.slice(2).filter(a => a !== '--');
const want = Number(args[args.indexOf('--matches') + 1]) || 3000;
const minBadge = args.includes('--min-badge') ? Number(args[args.indexOf('--min-badge') + 1]) : 0;
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated', args.includes('--out') ? args[args.indexOf('--out') + 1] : 'bench.json');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get<T>(url: string): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(API + url).catch(() => null);
    if (res?.ok) return res.json() as Promise<T>;
    if (i < 6) { await sleep(5000 * (i + 1)); continue; }
    throw new Error(`${url}: ${res?.status} ${(await res?.text())?.slice(0, 200)}`);
  }
}

/** Minutes the numbers are read at (each player's last snapshot at or before then). */
export const MARKS = [3, 6, 9, 12, 15, 20, 25, 30];
const METRICS = ['nw', 'lh', 'dn', 'k', 'd', 'dmg', 'heal', 'lane', 'camps', 'kills', 'urn', 'boss'] as const;
type Metric = (typeof METRICS)[number];
type S = { time_stamp_s: number; net_worth: number; creep_kills?: number; denies: number; kills: number; deaths: number; player_damage: number; player_healing?: number;
  teammate_healing?: number; gold_lane_creep?: number; gold_lane_creep_orbs?: number; gold_neutral_creep?: number; gold_neutral_creep_orbs?: number; gold_player?: number;
  gold_player_orbs?: number; gold_treasure?: number; gold_boss?: number; gold_boss_orb?: number };
type P = { hero_id: number; team: string; net_worth: number; abandon_match_time_s?: number; stats?: S[] };
type M = { match_id: number; duration_s: number; players?: P[] };
const read = (s: S): Record<Metric, number> => ({
  nw: s.net_worth, lh: s.creep_kills ?? 0, dn: s.denies, k: s.kills, d: s.deaths, dmg: s.player_damage, heal: (s.player_healing ?? 0) + (s.teammate_healing ?? 0),
  lane: (s.gold_lane_creep ?? 0) + (s.gold_lane_creep_orbs ?? 0), camps: (s.gold_neutral_creep ?? 0) + (s.gold_neutral_creep_orbs ?? 0),
  kills: (s.gold_player ?? 0) + (s.gold_player_orbs ?? 0), urn: s.gold_treasure ?? 0, boss: (s.gold_boss ?? 0) + (s.gold_boss_orb ?? 0),
});

// running sums: key → mark → metric → [n, sum, sum of squares]
const acc = new Map<string, number[][][]>();
const add = (key: string, mi: number, v: Record<Metric, number>) => {
  let a = acc.get(key);
  if (!a) { a = MARKS.map(() => METRICS.map(() => [0, 0, 0])); acc.set(key, a); }
  METRICS.forEach((m, j) => { const c = a![mi][j]; c[0]++; c[1] += v[m]; c[2] += v[m] * v[m]; });
};

const days = await get<string[]>('/v1/patches/big-days');
// the newest gameplay update or the last big day, whichever is later (the big days are kept by hand and lag)
const patch = (await gameplayPatches().catch(() => []))[0];
const since = Math.max(patch?.at ?? 0, Math.floor(Date.parse(days[0]) / 1000));
let seen = 0, maxId: number | undefined;
const t0 = Date.now();
while (seen < want) {
  // newest first, 100 at a time (a page with every player's numbers is ~35 MB)
  const page = await get<M[]>(`/v1/matches/metadata?include_player_info=true&include_player_stats=true&game_mode=normal&min_unix_timestamp=${since}${minBadge ? `&min_average_badge=${minBadge}` : ''}&min_duration_s=1200&order_by=match_id&order_direction=desc&limit=100${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
  if (!page.length) break;
  for (const m of page) {
    const ps = m.players ?? [];
    if (ps.length !== 12 || ps.some(p => (p.abandon_match_time_s ?? 0) > 0 || !p.stats?.length)) continue;
    for (const team of new Set(ps.map(p => p.team))) {
      ps.filter(p => p.team === team).sort((a, b) => b.net_worth - a.net_worth).forEach((p, i) => {
        const pos = i + 1;
        MARKS.forEach((mark, mi) => {
          if (m.duration_s < mark * 60) return;
          const s = [...p.stats!].reverse().find(x => x.time_stamp_s <= mark * 60 + 5);
          if (!s) return;
          const v = read(s);
          add(`pos${pos}`, mi, v);
          add(`h${p.hero_id}`, mi, v);
          add(`h${p.hero_id}p${pos}`, mi, v);
        });
      });
    }
    seen++;
  }
  maxId = Math.min(...page.map(m => m.match_id));
  console.log(`  ${seen} matches (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
  await sleep(2100);
}

// means and spreads where there are enough players (40+ for a hero in a position)
const out: Record<string, Record<string, Record<Metric, [number, number]>>> = {};
for (const [key, a] of acc) {
  const enough = key.startsWith('pos') ? 1 : key.includes('p') ? 40 : 60;
  MARKS.forEach((mark, mi) => {
    const n = a[mi][0][0];
    if (n < enough) return;
    const row = {} as Record<Metric, [number, number]>;
    METRICS.forEach((m, j) => { const [c, s1, s2] = a[mi][j]; const mean = s1 / c; row[m] = [Math.round(mean * 10) / 10, Math.round(Math.sqrt(Math.max(0, s2 / c - mean * mean)) * 10) / 10]; });
    (out[key] ??= {})[mark] = row;
  });
}
fs.writeFileSync(OUT, JSON.stringify({ since: new Date(since * 1000).toISOString(), minBadge, matches: seen, marks: MARKS, metrics: METRICS, rows: out }));
console.log(`${seen} matches since ${new Date(since * 1000).toISOString().slice(0, 10)} → ${path.relative(process.cwd(), OUT)} (${Object.keys(out).length} groups)`);

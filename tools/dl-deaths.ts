// Where high-rank Deadlock players die: every death in Phantom-and-up matches since the patch (deadlock-api's bulk match
// data, death details), turned so the dying player's base is at the bottom (the map is the same turned 180°), counted
// on a grid for each stage of the match. Writes src/deadlock/generated/deathmap.json: the Review map shows it as a
// layer, and the coach points out deaths in spots where good players die a lot (deathMap.ts).
//
//   npm run dl:deaths [-- --matches 6000 --min-badge 91]
import fs from 'node:fs';
import path from 'node:path';
import { toMap } from '../src/deadlock/data';
import { gameplayPatches } from '../src/deadlock/patches';
import { DEATH_GRID, DEATH_PHASES } from '../src/deadlock/deathMap';

const API = 'https://api.deadlock-api.com';
const args = process.argv.slice(2).filter(a => a !== '--');
const arg = (k: string, d: number) => Number(args[args.indexOf(k) + 1]) || d;
const want = arg('--matches', 6000), minBadge = arg('--min-badge', 91);
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/deathmap.json');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get<T>(url: string): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(API + url).catch(() => null);
    if (res?.ok) return res.json() as Promise<T>;
    if (i < 6) { await sleep(5000 * (i + 1)); continue; }
    throw new Error(`${url}: ${res?.status}`);
  }
}
type D = { game_time_s: number; death_pos?: number[] };
type M = { match_id: number; players?: { team: string; abandon_match_time_s?: number; death_details?: D[] }[] };

const patch = (await gameplayPatches())[0];
const days = await get<string[]>('/v1/patches/big-days');
const since = Math.max(patch?.at ?? 0, Math.floor(Date.parse(days[0]) / 1000));
const grids = DEATH_PHASES.map(() => new Array(DEATH_GRID * DEATH_GRID).fill(0));
const totals = DEATH_PHASES.map(() => 0);
let seen = 0, maxId: number | undefined;
while (seen < want) {
  const page = await get<M[]>(`/v1/matches/metadata?include_player_info=true&include_player_death_details=true&game_mode=normal&min_average_badge=${minBadge}`
    + `&min_unix_timestamp=${since}&min_duration_s=900&order_by=match_id&order_direction=desc&limit=500${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
  if (!page.length) break;
  for (const m of page) {
    const ps = m.players ?? [];
    if (ps.length !== 12 || ps.some(p => (p.abandon_match_time_s ?? 0) > 0)) continue;
    for (const p of ps) for (const d of p.death_details ?? []) {
      if (!d.death_pos) continue;
      let { x, y } = toMap(d.death_pos[0], d.death_pos[1]);
      // the dying player's base at the bottom
      if (p.team !== 'Team0') { x = 1 - x; y = 1 - y; }
      const ph = DEATH_PHASES.findIndex(f => d.game_time_s >= f.from && d.game_time_s < f.to);
      const gx = Math.floor(x * DEATH_GRID), gy = Math.floor(y * DEATH_GRID);
      if (ph < 0 || gx < 0 || gy < 0 || gx >= DEATH_GRID || gy >= DEATH_GRID) continue;
      grids[ph][gy * DEATH_GRID + gx]++; totals[ph]++;
    }
    seen++;
  }
  maxId = Math.min(...page.map(m => m.match_id));
  console.log(`  ${seen} matches, ${totals.reduce((a, b) => a + b, 0)} deaths`);
  await sleep(2100);
}
fs.writeFileSync(OUT, JSON.stringify({ since: new Date(since * 1000).toISOString(), minBadge, matches: seen, grid: DEATH_GRID, phases: DEATH_PHASES.map((f, i) => ({ ...f, deaths: totals[i], cells: grids[i] })) }));
console.log(`${seen} matches → ${path.relative(process.cwd(), OUT)}`);

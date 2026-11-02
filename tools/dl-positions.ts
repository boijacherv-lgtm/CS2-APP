// Which positions each Deadlock hero plays, by farm priority (Pos 1 hard carry … Pos 6 hard support): in every team of
// a sample of normal matches since the last big patch, the players ranked by net worth at the end (richest = Pos 1),
// counted per hero. Writes src/deadlock/generated/positions.json, which the site shows as each hero's usual positions.
//
//   npm run dl:positions [-- --matches 20000]
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.deadlock-api.com';
const args = process.argv.slice(2).filter(a => a !== '--');
const want = Number(args[args.indexOf('--matches') + 1]) || 20000;
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/positions.json');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get<T>(url: string): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(API + url);
    if (res.ok) return res.json() as Promise<T>;
    if ((res.status === 429 || res.status >= 500) && i < 5) { await sleep(5000 * (i + 1)); continue; }
    throw new Error(`${url}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

const days = await get<string[]>('/v1/patches/big-days');
const since = Math.floor(Date.parse(days[0]) / 1000);
type P = { hero_id: number; team: string; net_worth: number; abandon_match_time_s?: number };
type M = { match_id: number; duration_s: number; players?: P[] };
const counts = new Map<number, number[]>();
let seen = 0, maxId: number | undefined;
while (seen < want) {
  // newest first, a page at a time (the API allows 30 requests a minute)
  const page = await get<M[]>(`/v1/matches/metadata?include_player_info=true&game_mode=normal&min_unix_timestamp=${since}&min_duration_s=1200&order_by=match_id&order_direction=desc&limit=1000${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
  if (!page.length) break;
  for (const m of page) {
    const ps = m.players ?? [];
    // full teams only, nobody who left
    if (ps.length !== 12 || ps.some(p => (p.abandon_match_time_s ?? 0) > 0)) continue;
    for (const team of new Set(ps.map(p => p.team))) {
      const mine = ps.filter(p => p.team === team).sort((a, b) => b.net_worth - a.net_worth);
      mine.forEach((p, i) => { const c = counts.get(p.hero_id) ?? [0, 0, 0, 0, 0, 0]; c[i]++; counts.set(p.hero_id, c); });
    }
    seen++;
  }
  maxId = Math.min(...page.map(m => m.match_id));
  console.log(`  ${seen} matches`);
  await sleep(2200);
}
const heroes: Record<number, { games: number; share: number[] }> = {};
for (const [hero, c] of counts) {
  const games = c.reduce((a, b) => a + b, 0);
  heroes[hero] = { games, share: c.map(x => +(x / games).toFixed(3)) };
}
fs.writeFileSync(OUT, JSON.stringify({ since: days[0], matches: seen, heroes }));
console.log(`${seen} matches since ${days[0].slice(0, 10)}, ${counts.size} heroes → ${path.relative(process.cwd(), OUT)}`);

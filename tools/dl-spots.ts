// Where good Deadlock players are, by position and stage of the match: high-rank normal matches since the patch, each
// one's paths (every player once a second, deadlock-api's match metadata), each player given a position by farm (as
// dl-positions: richest in the team = Pos 1). Every 5 s a living player adds one to their spot on a grid, turned so
// their own base is at the bottom (the map is the same turned 180°). Writes src/deadlock/generated/spots.json: the
// coach compares where you were with where good players in your position are at that stage (spots.ts).
//
//   npm run dl:spots [-- --matches 300 --min-badge 91]
import fs from 'node:fs';
import path from 'node:path';
import { gameplayPatches } from '../src/deadlock/patchFeed';
import { matchFromMetadata } from '../src/deadlock/match';
import { SPOT_GRID, SPOT_PHASES } from '../src/deadlock/spots';

const API = 'https://api.deadlock-api.com';
const args = process.argv.slice(2).filter(a => a !== '--');
const arg = (k: string, d: number) => Number(args[args.indexOf(k) + 1]) || d;
const want = arg('--matches', 300), minBadge = arg('--min-badge', 91);
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/spots.json');
const STEP = 5;
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

const patch = (await gameplayPatches())[0];
const days = (await get<string[]>('/v1/patches/big-days')) ?? [];
const since = Math.max(patch?.at ?? 0, Math.floor(Date.parse(days[0] ?? '') / 1000) || 0);
// [position 1–6][stage][cell]
const counts = [1, 2, 3, 4, 5, 6].map(() => SPOT_PHASES.map(() => new Array(SPOT_GRID * SPOT_GRID).fill(0)));
let used = 0, maxId: number | undefined;
const t0 = Date.now();
type P = { abandon_match_time_s?: number };
outer: while (used < want) {
  // the IDs: newest first, full matches of 20 min or more at these ranks
  const page = await get<{ match_id: number; players?: P[] }[]>(`/v1/matches/metadata?include_player_info=true&game_mode=normal&min_average_badge=${minBadge}`
    + `&min_unix_timestamp=${since}&min_duration_s=1200&order_by=match_id&order_direction=desc&limit=200${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
  if (!page?.length) break;
  for (const row of page) {
    maxId = row.match_id;
    if ((row.players ?? []).some(p => (p.abandon_match_time_s ?? 0) > 0)) continue;
    const meta = await get<{ match_info: unknown }>(`/v1/matches/${row.match_id}/metadata`, 2);
    if (!meta) continue;
    const m = matchFromMetadata(meta);
    if (m.players.length !== 12) continue;
    for (const team of [0, 1] as const) {
      const mine = m.players.filter(p => p.team === team).sort((a, b) => b.netWorth - a.netWorth);
      mine.forEach((p, i) => {
        const tr = m.tracks[p.slot];
        if (!tr) return;
        for (let t = 0; t < tr.x.length; t += STEP) {
          const x = tr.x[t], y = tr.y[t];
          if (!tr.hp[t] || Number.isNaN(x)) continue; // dead
          const ph = SPOT_PHASES.findIndex(s => t >= s.from && t < s.to);
          // turned so this player's base is at the bottom
          const mx = team === 0 ? x : 1 - x, my = team === 0 ? y : 1 - y;
          const gx = Math.floor(mx * SPOT_GRID), gy = Math.floor(my * SPOT_GRID);
          if (ph < 0 || gx < 0 || gy < 0 || gx >= SPOT_GRID || gy >= SPOT_GRID) continue;
          counts[i][ph][gy * SPOT_GRID + gx]++;
        }
      });
    }
    used++;
    if (used % 25 === 0) console.log(`${used} matches (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (used >= want) break outer;
    await sleep(250);
  }
}

fs.writeFileSync(OUT, JSON.stringify({ since: new Date(since * 1000).toISOString(), minBadge, matches: used, grid: SPOT_GRID, step: STEP, pos: counts }));
console.log(`spots.json: ${used} matches at ${minBadge}+ since ${new Date(since * 1000).toISOString().slice(0, 10)}`);

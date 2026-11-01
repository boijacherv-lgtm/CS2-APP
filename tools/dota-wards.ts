// Finds where pro players put their wards, from OpenDota's logs of recent pro matches, for Tactical's "Best wards".
//
//   npx vite-node tools/dota-wards.ts [matches=150]
//
// A spot is a place wards keep going, per side, part of the match and kind of ward. It's read one match at a time, slowly
// enough for OpenDota's free limit of 60 requests a minute. How much a spot sees past the trees is worked out on the site.
import fs from 'node:fs';
import { cellToMap } from '../src/dota2/data';

const OUT = 'src/dota2/generated/wardspots.json';
const WANTED = Number(process.argv[2] ?? 150);
const API = 'https://api.opendota.com/api';
/** Seconds a ward stands if left alone, and which second each part of the match starts at. */
const LIFE = { obs: 360, sen: 420 } as const;
const PHASE_FROM = [0, 600, 1500];
/** Wards this near each other (in map cells) count as one spot; how many spots to keep; how many wards make a spot. */
const REACH = 3.5, KEEP = 12, AT_LEAST = 4;
const PAUSE = 1100;

type Log = { time: number; x?: number; y?: number; key?: string };
type Player = { player_slot: number; obs_log?: Log[] | null; sen_log?: Log[] | null; obs_left_log?: Log[] | null; sen_left_log?: Log[] | null };
type Placed = { x: number; y: number; life: number };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const get = async <T>(path: string): Promise<T | null> => {
  for (let tries = 0; tries < 3; tries++) {
    const res = await fetch(`${API}${path}`).catch(() => null);
    if (res?.ok) return await res.json() as T;
    await wait(res?.status === 429 ? 30000 : 3000);
  }
  return null;
};

const groups = new Map<string, Placed[]>();
let used = 0, oldest = Infinity, before: number | undefined;
while (used < WANTED) {
  const list = await get<{ match_id: number; start_time: number }[]>(`/proMatches${before ? `?less_than_match_id=${before}` : ''}`);
  if (!list?.length) break;
  for (const m of list) {
    if (used >= WANTED) break;
    before = m.match_id;
    await wait(PAUSE);
    const full = await get<{ players: Player[] }>(`/matches/${m.match_id}`);
    // a match OpenDota hasn't read the replay of has no logs
    if (!full?.players.some(p => p.obs_log?.length)) continue;
    used++;
    oldest = Math.min(oldest, m.start_time);
    for (const p of full.players) {
      const team = p.player_slot < 128 ? 0 : 1;
      for (const kind of ['obs', 'sen'] as const) {
        const placed = (kind === 'obs' ? p.obs_log : p.sen_log) ?? [], left = [...((kind === 'obs' ? p.obs_left_log : p.sen_left_log) ?? [])];
        for (const l of placed) {
          if (l.x === undefined || l.y === undefined) continue;
          const i = left.findIndex(o => o.key === l.key && o.time >= l.time);
          const life = i >= 0 ? Math.min(LIFE[kind], left.splice(i, 1)[0].time - l.time) : LIFE[kind];
          const phase = PHASE_FROM.reduce((a, from, j) => (l.time >= from ? j : a), 0);
          const key = `${team}|${phase}|${kind}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push({ x: l.x, y: l.y, life });
        }
      }
    }
    if (used % 25 === 0) console.log(`${used} matches read`);
  }
}

const spots: { team: number; phase: number; kind: string; x: number; y: number; n: number; life: number }[] = [];
for (const [key, all] of groups) {
  const [team, phase, kind] = key.split('|');
  let rest = all;
  const found: typeof spots = [];
  // the busiest place first, taken out of the rest, so spots don't overlap
  while (found.length < KEEP && rest.length) {
    let best: Placed[] = [];
    for (const p of rest) {
      const near = rest.filter(o => Math.hypot(o.x - p.x, o.y - p.y) < REACH);
      if (near.length > best.length) best = near;
    }
    if (best.length < AT_LEAST) break;
    const cx = best.reduce((a, p) => a + p.x, 0) / best.length, cy = best.reduce((a, p) => a + p.y, 0) / best.length, at = cellToMap(cx, cy);
    found.push({ team: Number(team), phase: Number(phase), kind, x: Math.round(at.x * 1000), y: Math.round(at.y * 1000), n: best.length, life: Math.round(best.reduce((a, p) => a + p.life, 0) / best.length) });
    const taken = new Set(best);
    rest = rest.filter(p => !taken.has(p));
  }
  spots.push(...found);
}
const days = Math.ceil((Date.now() / 1000 - oldest) / 86400);
fs.writeFileSync(OUT, `${JSON.stringify({ matches: used, days, spots })}\n`);
console.log(`${used} matches over ${days} days, ${spots.length} spots, ${fs.statSync(OUT).size} bytes`);
for (const [key, all] of groups) console.log(key, all.length, 'wards');

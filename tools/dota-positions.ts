// Counts which positions each hero is really played in, so draft suggestions by role don't rest on the game's tags alone:
// reads recent parsed pro matches from OpenDota and works out the five positions of each team from lanes and net worth.
// Writes hero id -> games at positions 1 to 5 to generated/heroPositions.json.
//
//   npx vite-node tools/dota-positions.ts [matches=400]
import fs from 'node:fs';
import { positionsOfTeam, type LanedPlayer } from '../src/dota2/draft';

const OUT = 'src/dota2/generated/heroPositions.json', API = 'https://api.opendota.com/api', PAUSE = 1100;
const WANTED = Number(process.argv[2] ?? 400);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const get = async <T>(path: string): Promise<T | null> => {
  for (let tries = 0; tries < 4; tries++) {
    const res = await fetch(`${API}${path}`).catch(() => null);
    if (res?.ok) return await res.json() as T;
    await wait(res?.status === 429 ? 30000 : 3000);
  }
  return null;
};

const counts: Record<number, number[]> = {};
const save = (matches: number) => fs.writeFileSync(OUT, `${JSON.stringify({ matches, heroes: counts })}\n`);
let used = 0, before: number | undefined;
while (used < WANTED) {
  const list = await get<{ match_id: number }[]>(`/proMatches${before ? `?less_than_match_id=${before}` : ''}`);
  if (!list?.length) break;
  for (const { match_id: id } of list) {
    if (used >= WANTED) break;
    before = id;
    await wait(PAUSE);
    const raw = await get<{ players: (LanedPlayer & { player_slot: number })[] }>(`/matches/${id}`);
    if (!raw?.players || raw.players.length !== 10 || raw.players.some(p => !p.lane_role || p.net_worth == null)) continue;
    used++;
    for (const radiant of [true, false]) {
      for (const { hero, position } of positionsOfTeam(raw.players.filter(p => p.player_slot < 128 === radiant))) {
        (counts[hero] ??= [0, 0, 0, 0, 0])[position - 1]++;
      }
    }
    if (used % 25 === 0) { save(used); console.log(`${used} matches`); }
  }
}
save(used);
console.log(`${used} matches, ${Object.keys(counts).length} heroes`);

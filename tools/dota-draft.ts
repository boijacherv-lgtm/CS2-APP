// Counts how heroes do with and against each other in recent high-rank ranked games, for Tactical's auto-pick and counter-picks.
//
//   npx vite-node tools/dota-draft.ts [pages=320]
//
// OpenDota's public match list gives both teams of 100 games a request, slowly enough for its limit of 60 requests a minute.
// The newest games have no teams yet, so the reading starts a little way back.
import fs from 'node:fs';

const OUT = 'src/dota2/generated/heroPairs.json';
const API = 'https://api.opendota.com/api';
const PAGES = Number(process.argv[2] ?? 320), PAUSE = 1100, MIN_RANK = 60, MIN_LENGTH = 900;
const RANKED_ALL_PICK = { lobby: 7, mode: 22 };
/** How far back of the newest match id the teams are filled in. */
const SKIP_NEWEST = 2_000_000;

type Row = { match_id: number; radiant_win: boolean; duration: number; lobby_type: number; game_mode: number; start_time: number; radiant_team: number[]; dire_team: number[] };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const get = async <T>(path: string): Promise<T | null> => {
  for (let tries = 0; tries < 4; tries++) {
    const res = await fetch(`${API}${path}`).catch(() => null);
    if (res?.ok) return await res.json() as T;
    await wait(res?.status === 429 ? 30000 : 3000);
  }
  return null;
};

const stats = await get<{ id: number; roles: string[] }[]>('/heroStats');
if (!stats) throw new Error('No hero list from OpenDota');
const ids = stats.map(h => h.id).sort((a, b) => a - b), index = new Map(ids.map((id, i) => [id, i]));
const N = ids.length, tri = (i: number, j: number) => (i * (2 * N - i - 1)) / 2 + (j - i - 1);
const size = (N * (N - 1)) / 2;
const games = new Int32Array(N), wins = new Int32Array(N);
const withG = new Int32Array(size), withW = new Int32Array(size), vsG = new Int32Array(size), vsW = new Int32Array(size);

let matches = 0, oldest = Infinity;
const first = await get<Row[]>(`/publicMatches?min_rank=${MIN_RANK}`);
if (!first?.length) throw new Error('No matches from OpenDota');
let before = first[0].match_id - SKIP_NEWEST;
for (let page = 0; page < PAGES; page++) {
  await wait(PAUSE);
  const rows = await get<Row[]>(`/publicMatches?min_rank=${MIN_RANK}&less_than_match_id=${before}`);
  if (!rows?.length) break;
  before = rows[rows.length - 1].match_id;
  for (const m of rows) {
    if (m.lobby_type !== RANKED_ALL_PICK.lobby || m.game_mode !== RANKED_ALL_PICK.mode || m.duration < MIN_LENGTH) continue;
    const a = m.radiant_team.map(h => index.get(h)), b = m.dire_team.map(h => index.get(h));
    if (a.length !== 5 || b.length !== 5 || [...a, ...b].some(i => i === undefined)) continue;
    matches++;
    oldest = Math.min(oldest, m.start_time);
    const teams = [[a as number[], m.radiant_win], [b as number[], !m.radiant_win]] as const;
    for (const [team, won] of teams) {
      for (const i of team) { games[i]++; if (won) wins[i]++; }
      for (let x = 0; x < 5; x++) for (let y = x + 1; y < 5; y++) {
        const i = Math.min(team[x], team[y]), j = Math.max(team[x], team[y]), at = tri(i, j);
        withG[at]++; if (won) withW[at]++;
      }
    }
    for (const r of a as number[]) for (const d of b as number[]) {
      const i = Math.min(r, d), j = Math.max(r, d), at = tri(i, j);
      vsG[at]++;
      // counted for the lower-numbered hero of the two
      if ((r === i) === m.radiant_win) vsW[at]++;
    }
  }
  if ((page + 1) % 50 === 0) console.log(`${page + 1} pages, ${matches} matches`);
}

const out = {
  matches, days: Math.ceil((Date.now() / 1000 - oldest) / 86400), ids,
  roles: ids.map(id => stats.find(h => h.id === id)!.roles),
  games: [...games], wins: [...wins], withGames: [...withG], withWins: [...withW], vsGames: [...vsG], vsWins: [...vsW],
};
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`${matches} matches over ${out.days} days, ${N} heroes, ${(fs.statSync(OUT).size / 1000).toFixed(0)} KB`);

// Fetches good players' demos from FACEIT with its official API, for training the coach:
//   - the FACEIT leaderboard per region: the very top (--pro-top, default 30: mostly pros and FPL players, whose
//     history includes their FPL matches) is the pro tier; the rest of the top N is level 10
//   - every 5v5 match each player finished in the last --days (or only the newest --per-player)
//   - optionally a hub's matches (--hubs <ids>, from the hub page URL); FACEIT's official FPL hub isn't listed in
//     the public API, so it isn't searched for
// By default there's no cap per map or per run: it takes every match it finds, skips the ones it already has, and
// stops only when the disk gets low (--min-free-gb, default 30; a demo is ~180 MB), then trains everything
// (learn:all) on the level-10 folder. --per-map / --max / --per-player put caps back.
//
//   npm run fetch:faceit -- [--top 500] [--pro-top 30] [--per-player N] [--regions EU,NA] [--per-map N] [--max N] [--days 30]
//                           [--min-free-gb 30]
//                           [--folder ~/Desktop/APPS/faceit-demos] [--pro-folder ~/Desktop/APPS/pro-demos]
//                           [--hubs <hub ids>] [--no-pro] [--no-train] [--dry-run]
//
// Keys, in cs2-tactics/.env (never committed; create them yourself at developers.faceit.com):
//   FACEIT_API_KEY=...            a server-side Data API key (free): finding players and matches
//   FACEIT_DOWNLOADS_TOKEN=...    a token with the Downloads API scope (apply at fce.gg/downloads-api-application;
//                                 FACEIT answers within ~30 days). Without it, the script writes the match links it
//                                 found to <folder>/faceit-links.txt so they can be downloaded by hand.
//
// Pro demos go to their own folder (a "pro" level next to level 10 comes later), so they don't change the level-10
// benchmarks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MAPS } from '../src/map/catalog';
import { keyOf, listDemos, readCache } from './learn-lib';

// ---- options and keys ---------------------------------------------------------------------------------------
const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = (k: string) => args.includes(`--${k}`);
const home = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());
const TOP = Number(opt('top', '500'));
const PRO_TOP = Number(opt('pro-top', '30'));
const PER_PLAYER = Number(opt('per-player', 'Infinity'));
const REGIONS = opt('regions', 'EU,NA')!.split(',').map(s => s.trim()).filter(Boolean);
const PER_MAP = Number(opt('per-map', 'Infinity'));
const MAX = Number(opt('max', 'Infinity'));
const MIN_FREE = Number(opt('min-free-gb', '30')) * 1e9;
const DAYS = Number(opt('days', '30'));
const FOLDER = home(opt('folder', '~/Desktop/APPS/faceit-demos')!);
const PRO_FOLDER = home(opt('pro-folder', '~/Desktop/APPS/pro-demos')!);
const DRY = flag('dry-run');

function loadEnv(): Record<string, string> {
  const p = path.resolve(import.meta.dirname, '../.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
const API_KEY = env.FACEIT_API_KEY;
const DL_TOKEN = env.FACEIT_DOWNLOADS_TOKEN;
if (!API_KEY) {
  console.error(`No FACEIT_API_KEY. Create a server-side API key at developers.faceit.com (Apps → your app → API keys) and add this line to ${path.resolve(import.meta.dirname, '../.env')}:\n  FACEIT_API_KEY=<your key>`);
  process.exit(1);
}

// ---- FACEIT API ---------------------------------------------------------------------------------------------
const DATA = 'https://open.faceit.com/data/v4';
const DOWNLOAD = 'https://open.faceit.com/download/v2/demos/download';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
/** A Data API GET with a gentle pace (~4 a second) and backoff on 429 / 5xx. */
async function api<T>(p: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = `${DATA}${p}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  for (let attempt = 0; ; attempt++) {
    const wait = 250 - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' } });
    if (res.ok) return res.json() as Promise<T>;
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(`FACEIT refused the API key (${res.status}): check FACEIT_API_KEY in .env.`);
    throw new Error(`FACEIT ${p}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}
type Ranking = { items: { player_id: string; nickname: string; faceit_elo?: number; game_skill_level?: number }[] };
type History = { items: { match_id: string; game_mode?: string; competition_type?: string; competition_name?: string; status?: string; finished_at?: number }[] };
type Match = { match_id: string; status?: string; demo_url?: string[]; voting?: { map?: { pick?: string[] } }; competition_name?: string; finished_at?: number };
type HubMatches = { items: { match_id: string; status?: string }[] };

// ---- what we have ------------------------------------------------------------------------------------------
const STATE = path.join(FOLDER, '.stratboard-faceit.json');
type State = { seen: Record<string, { map?: string; got?: string; skip?: string; at: number }> };
const state: State = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { seen: {} };
const saveState = () => { if (!DRY) fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); };
// --maps de_inferno,de_cache…: only these maps (and only they have to fill up); default every map the site has
const supported = new Set(opt('maps') ? opt('maps')!.split(',').map(x => x.trim()) : MAPS.map(m => m.id));
const known_maps = new Set(MAPS.map(m => m.id));

/** Demos per map in a folder: the ones already read (analyst cache) plus the ones this script fetched but not read yet. */
function perMap(folder: string): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!fs.existsSync(folder)) return counts;
  const cache = readCache<{ map: string | null; error?: string }>(folder, 'spots'); // small: just each demo's map
  const read = new Set<string>();
  for (const f of listDemos(folder)) { const k = keyOf(folder, f); const c = cache[k]; if (c?.map && !c.error) { counts[c.map] = (counts[c.map] ?? 0) + 1; read.add(path.join(folder, f)); } }
  for (const s of Object.values(state.seen)) if (s.got && s.map && path.dirname(s.got) === folder && fs.existsSync(s.got) && !read.has(s.got)) counts[s.map] = (counts[s.map] ?? 0) + 1;
  return counts;
}

/** FACEIT match ids already downloaded or tried: from the demos' file names, and the helper's progress files. */
function known(folder: string): Set<string> {
  const ids = new Set<string>();
  const MATCH = /1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const f of listDemos(folder)) { const m = path.basename(f).match(MATCH); if (m) ids.add(m[0].toLowerCase()); }
  for (const p of (opt('known') ?? '').split(',').map(x => home(x.trim())).filter(Boolean))
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); for (const id of [...Object.keys(j.done ?? {}), ...Object.keys(j.skipped ?? {})]) ids.add(id.toLowerCase()); } catch { /* not there */ }
  return ids;
}

// ---- 1. candidates: top players' recent matches, and pro hubs' matches --------------------------------------
async function topPlayers(): Promise<{ id: string; nick: string; rank: number }[]> {
  const out: { id: string; nick: string; rank: number }[] = [];
  for (const region of REGIONS)
    for (let offset = 0; offset < TOP; offset += 100) {
      const r = await api<Ranking>(`/rankings/games/cs2/regions/${region}`, { offset, limit: Math.min(100, TOP - offset) });
      out.push(...r.items.map((i, k) => ({ id: i.player_id, nick: i.nickname, rank: offset + k + 1 })));
      if (r.items.length < 100) break;
    }
  return out;
}
async function playerMatches(id: string): Promise<string[]> {
  const from = Math.floor(Date.now() / 1000) - DAYS * 86400;
  const items: History['items'] = [];
  // every page of their history in the window (100 a page)
  for (let offset = 0; items.length < PER_PLAYER; offset += 100) {
    const h = await api<History>(`/players/${id}/history`, { game: 'cs2', from, offset, limit: 100 });
    items.push(...h.items);
    if (h.items.length < 100 || offset >= 900) break;
  }
  // finished 5v5 matches only (matchmaking queues and hubs; not wingman or 1v1)
  return items.filter(m => (!m.game_mode || /5v5/i.test(m.game_mode)) && (!m.status || /finished/i.test(m.status)))
    .sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0)).slice(0, PER_PLAYER).map(m => m.match_id);
}
/** Free space on the disk the folder is on (bytes). */
const freeBytes = (folder: string) => { try { const s = fs.statfsSync(folder); return s.bavail * s.bsize; } catch { return Infinity; } };
/** Hubs given with --hubs (their id is in the hub page URL on faceit.com). */
const proHubs = (): string[] => (opt('hubs') ?? '').split(',').map(s => s.trim()).filter(Boolean);
async function hubMatches(hub: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const r = await api<HubMatches>(`/hubs/${hub}/matches`, { type: 'past', offset, limit: 100 });
    ids.push(...r.items.filter(m => !m.status || /finished/i.test(m.status)).map(m => m.match_id));
    if (r.items.length < 100) break;
  }
  return ids;
}

// ---- 2. download ------------------------------------------------------------------------------------------
async function signedUrl(resource: string): Promise<string> {
  const res = await fetch(DOWNLOAD, { method: 'POST', headers: { Authorization: `Bearer ${DL_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: resource }) });
  if (res.status === 401 || res.status === 403) throw new Error(`FACEIT refused the Downloads API token (${res.status}): it needs the Downloads API scope (fce.gg/downloads-api-application).`);
  if (!res.ok) throw new Error(`Downloads API: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json() as { payload?: { download_url?: string } };
  if (!j.payload?.download_url) throw new Error('Downloads API: no download_url in the answer');
  return j.payload.download_url;
}
async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, file);
}

const LINKS_OUT = path.join(FOLDER, 'faceit-links.txt');
async function main() {
  if (!DL_TOKEN || DRY) fs.writeFileSync(LINKS_OUT, 'map\tmatch room (open it and click Watch demo)\tsource\n');
  const t0 = Date.now();
  const links: string[] = [];
  let got = 0;
  const run = async (label: string, folder: string, matchIds: string[]) => {
    fs.mkdirSync(folder, { recursive: true });
    const counts = perMap(folder);
    // not the matches already here (a demo in the folder, linked disk included) or already tried by the download
    // helper (--known <its progress.json>: downloaded, or skipped because it had no demo)
    const have = known(folder);
    const todo = [...new Set(matchIds)].filter(id => !state.seen[id] && !have.has(id));
    console.log(`\n${label}: ${matchIds.length} matches found, ${todo.length} new. Demos per map now: ${Object.entries(counts).map(([m, n]) => `${m.replace('de_', '')} ${n}`).join(', ') || 'none'}`);
    const full = () => Number.isFinite(PER_MAP) && [...supported].every(m => (counts[m] ?? 0) >= PER_MAP);
    for (const id of todo) {
      if (got >= MAX || full()) break;
      if (DL_TOKEN && !DRY && freeBytes(folder) < MIN_FREE) {
        console.log(`\nStopping: under ${(MIN_FREE / 1e9).toFixed(0)} GB free on the disk (--min-free-gb). Free some space, or lower it, and run again: it continues where it stopped.`);
        break;
      }
      let m: Match;
      try { m = await api<Match>(`/matches/${id}`); } catch (e) { console.log(`  ${id}: ${(e as Error).message}`); continue; }
      const map = m.voting?.map?.pick?.[0];
      const demo = m.demo_url?.[0];
      const skip = !map ? 'no map' : !supported.has(map) ? `${map} isn't supported` : !demo ? 'no demo (yet)' : Number.isFinite(PER_MAP) && (counts[map] ?? 0) >= PER_MAP ? `${map} has ${PER_MAP} already` : null;
      // (a map left out with --maps, or one already full, isn't remembered as skipped: another run may want it)
      if (skip) { if (skip !== 'no demo (yet)' && !/already/.test(skip) && !(map && known_maps.has(map))) state.seen[id] = { map, skip, at: Date.now() }; continue; }
      const ext = /\.zst$/i.test(demo!) ? '.dem.zst' : /\.gz$/i.test(demo!) ? '.dem.gz' : '.dem';
      const file = path.join(folder, `faceit-${id}${ext}`);
      if (!DL_TOKEN || DRY) {
        links.push(`${map}\thttps://www.faceit.com/en/cs2/room/${id}\t${label}`);
        // written as found, so a stopped run keeps what it found
        fs.appendFileSync(LINKS_OUT, `${links.at(-1)}\n`);
        if (links.length % 25 === 0) console.log(`  ${links.length} links so far: ${[...supported].map(m => `${m.replace('de_', '')} ${counts[m] ?? 0}`).join(', ')}`);
        counts[map!] = (counts[map!] ?? 0) + 1;
        continue;
      }
      try {
        await download(await signedUrl(demo!), file);
        state.seen[id] = { map, got: file, at: Date.now() };
        counts[map!] = (counts[map!] ?? 0) + 1;
        got++;
        console.log(`  [${got}] ${map} ${path.basename(file)} (${(fs.statSync(file).size / 1e6).toFixed(0)} MB)`);
        saveState();
      } catch (e) {
        console.log(`  ${id}: ${(e as Error).message}`);
        if (/refused/.test((e as Error).message)) throw e;
      }
    }
  };

  // the leaderboard: the very top is the pro tier, the rest level 10
  const players = await topPlayers();
  console.log(`Top players: ${players.length} (${REGIONS.join(', ')}); ranks 1–${PRO_TOP} count as pro tier.`);
  const collect = async (list: typeof players) => {
    const ids: string[] = [];
    for (const [i, p] of list.entries()) {
      try { ids.push(...await playerMatches(p.id)); } catch (e) { console.log(`  ${p.nick}: ${(e as Error).message}`); }
      if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${list.length} players, ${new Set(ids).size} matches`);
    }
    return ids;
  };
  if (!flag('no-pro')) {
    const pro = await collect(players.filter(p => p.rank <= PRO_TOP));
    for (const h of proHubs()) pro.push(...await hubMatches(h));
    await run('Pro tier', PRO_FOLDER, pro);
  }
  await run(`Top ${TOP} (level 10)`, FOLDER, await collect(players.filter(p => p.rank > PRO_TOP)));
  saveState();

  if (links.length) {
    const out = LINKS_OUT;
    console.log(`\n${DL_TOKEN ? 'Dry run' : 'No FACEIT_DOWNLOADS_TOKEN yet'}: ${links.length} matches to download, listed in ${out}.`);
  }
  console.log(`\nDownloaded ${got} demos in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
  if (got && !flag('no-train') && !DRY) {
    console.log('\nTraining on the level-10 folder (learn:all)…');
    execFileSync('npx', ['vite-node', path.join(import.meta.dirname, 'learn-all.ts'), FOLDER], { stdio: 'inherit' });
  }
}
main().catch(e => { console.error(`\n${(e as Error).message}`); process.exit(1); });

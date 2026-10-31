/**
 * opendota.com, called from the browser (it allows any site; no key): a player's matches and a match's data. A parsed
 * match is kept in this browser once read (gzipped, IndexedDB) so it opens instantly next time.
 */
import { getItem, gunzipJson, gzipJson, setItem } from '../ui/localStore';
import { matchFromOpenDota, type D2Match, type RawMatch } from './match';

const API = 'https://api.opendota.com/api';
async function get<T>(path: string): Promise<T> {
  const res = await fetch(API + path);
  if (res.status === 404) throw new Error('OpenDota doesn\'t have that match. Check the ID: matches show up there shortly after they end.');
  if (res.status === 429) throw new Error('OpenDota is busy (too many requests): try again in a minute.');
  if (!res.ok) throw new Error(`OpenDota answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/** Steam's account number in Dota's data (SteamID3) from a SteamID64. */
export const steamId3 = (id64: string) => String(BigInt(id64) - 76561197960265728n);

export interface D2HistoryRow {
  match_id: number; hero_id: number; start_time: number; duration: number; player_slot: number; radiant_win: boolean;
  kills: number; deaths: number; assists: number; version: number | null;
}
/** A player's latest matches, newest first. */
export const matchHistory = (account: string) => get<D2HistoryRow[]>(`/players/${account}/matches?limit=30`);

/** A week's keeping for what changes slowly, and to stay well inside OpenDota's limit of requests a minute. */
async function kept<T>(key: string, path: string): Promise<T> {
  try {
    const c = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (c && Date.now() - c.at < 7 * 86400e3) return c.data as T;
  } catch { /* private mode */ }
  const data = await get<T>(path);
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* private mode or full */ }
  return data;
}
export interface HeroMatchup { hero_id: number; games_played: number; wins: number }
/** How a hero has done against every other hero (OpenDota's sample of ranked and pro games: not large). */
export const heroMatchups = (hero: number) => kept<HeroMatchup[]>(`stratboard.d2.matchups.${hero}`, `/heroes/${hero}/matchups`);
export interface ItemTiming { time: number; games: string | number; wins: string | number }
/** When players on a hero finished an item: how many games by each time (s), in steps of several minutes. */
export const itemTimings = (hero: number, item: string) => kept<ItemTiming[]>(`stratboard.d2.timing.${hero}.${item}`, `/scenarios/itemTimings?hero_id=${hero}&item=${item}`);

/** How far past the usual time (s) counts as late; the data is in steps of this size. */
export const TIMING_MARGIN = 300;
/** Fewer games than this say little about when an item is usually bought. */
const MIN_TIMING_GAMES = 30;
/** When half the players on a hero have an item, from `itemTimings`; null when there are too few games to tell. */
export function typicalTiming(rows: ItemTiming[]): number | null {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const total = sorted.reduce((a, r) => a + Number(r.games), 0);
  if (total < MIN_TIMING_GAMES) return null;
  let seen = 0;
  for (const r of sorted) { seen += Number(r.games); if (seen >= total / 2) return r.time; }
  return null;
}

/** How a hero does against another from a small sample: pulled towards even, so ten lucky games don't look like a counter. */
export const matchupRate = (m: HeroMatchup | undefined) => (m ? (m.wins + 10) / (m.games_played + 20) : 0.5);

const KEY = (id: number) => `d2match6:${id}`;
/** A match: from this browser when read before, else from OpenDota, then kept here once it's parsed. */
export async function loadMatch(id: number, fresh = false): Promise<D2Match> {
  if (!fresh) {
    const saved = await getItem<Blob>(KEY(id));
    if (saved) { try { return await gunzipJson<D2Match>(saved); } catch { /* read it again */ } }
  }
  const m = matchFromOpenDota(await get<RawMatch>(`/matches/${id}`));
  if (m.parsed) void setItem(KEY(id), await gzipJson(m));
  return m;
}

/** Asks OpenDota to read this match's replay (it takes a few minutes; replays stay available for about two weeks). */
export async function requestParse(id: number): Promise<void> {
  const res = await fetch(`${API}/request/${id}`, { method: 'POST' });
  if (res.status === 429) throw new Error('OpenDota is busy (too many requests): try again in a minute.');
  if (!res.ok) throw new Error(`OpenDota answered ${res.status}.`);
}

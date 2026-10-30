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

const KEY = (id: number) => `d2match5:${id}`;
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

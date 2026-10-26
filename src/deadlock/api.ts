/**
 * deadlock-api.com, called from the browser (it allows any site; no key): a player's matches, a match's data and
 * Steam names. A match is kept in this browser once read (gzipped, IndexedDB) so it opens instantly next time.
 */
import { getItem, gunzipJson, gzipJson, setItem } from '../ui/localStore';
import { matchFromMetadata, type DlMatch } from './match';

const API = 'https://api.deadlock-api.com';
async function get<T>(path: string): Promise<T> {
  const res = await fetch(API + path);
  if (res.status === 404) throw new Error('deadlock-api doesn\'t have that match (yet). Matches show up there a few minutes to an hour after they end.');
  if (res.status === 429) throw new Error('deadlock-api is busy (too many requests): try again in a minute.');
  if (!res.ok) throw new Error(`deadlock-api answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/** Steam's account number in Deadlock's data (SteamID3) from a SteamID64. */
export const steamId3 = (id64: string) => String(BigInt(id64) - 76561197960265728n);

export interface DlHistoryRow {
  match_id: number; hero_id: number; start_time: number; match_duration_s: number; player_team: number; match_result: number;
  player_kills: number; player_deaths: number; player_assists: number; net_worth: number; last_hits: number; game_mode: number;
}
/** A player's matches, newest first. */
export async function matchHistory(account: string): Promise<DlHistoryRow[]> {
  const rows = await get<DlHistoryRow[]>(`/v1/players/${account}/match-history`);
  return [...rows].sort((a, b) => b.start_time - a.start_time);
}

const KEY = (id: number) => `dlmatch1:${id}`;
/** A match: from this browser when read before, else from deadlock-api (about 1 MB), then kept here. */
export async function loadMatch(id: number): Promise<DlMatch> {
  const saved = await getItem<Blob>(KEY(id));
  if (saved) { try { return revive(await gunzipJson<DlMatch>(saved)); } catch { /* read it again */ } }
  const meta = await get<unknown>(`/v1/matches/${id}/metadata`);
  const m = matchFromMetadata(meta);
  void setItem(KEY(id), await gzipJson(m));
  return m;
}
/** Typed arrays come back from JSON as plain objects: make them arrays again. */
function revive(m: DlMatch): DlMatch {
  const arr = <T extends Float32Array | Uint8Array>(v: unknown, C: { from(a: ArrayLike<number>): T }) => C.from(Object.values(v as Record<string, number>));
  for (const k of Object.keys(m.tracks)) {
    const tr = m.tracks[+k] as unknown as Record<string, unknown>;
    m.tracks[+k] = { x: arr(tr.x, Float32Array), y: arr(tr.y, Float32Array), hp: arr(tr.hp, Uint8Array) };
  }
  return m;
}

/** Steam names (and avatars) of accounts, by SteamID3. */
export async function steamNames(accounts: number[]): Promise<Record<number, { name: string; avatar: string | null }>> {
  if (!accounts.length) return {};
  type Row = { account_id: number; personaname?: string; avatar?: string; avatarmedium?: string };
  const rows = await get<Row[]>(`/v1/players/steam?account_ids=${accounts.join(',')}`).catch(() => [] as Row[]);
  return Object.fromEntries(rows.map(r => [r.account_id, { name: r.personaname ?? String(r.account_id), avatar: r.avatarmedium ?? r.avatar ?? null }]));
}

/**
 * deadlock-api.com, called from the browser (it allows any site; no key): a player's matches, a match's data and
 * Steam names. A match is kept in this browser once read (gzipped, IndexedDB) so it opens instantly next time.
 */
import { getItem, gunzipJson, gzipJson, setItem } from '../ui/localStore';
import { matchFromMetadata, type DlMatch } from './match';

const API = 'https://api.deadlock-api.com';
async function get<T>(path: string): Promise<T> {
  const res = await fetch(API + path);
  if (res.status === 404) throw new Error('Match not found. Check the ID, or try again later: new matches take a few minutes to an hour to show up.');
  if (res.status === 429) throw new Error('deadlock-api is busy (too many requests): try again in a minute.');
  if (!res.ok) throw new Error(`deadlock-api answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/** Steam's account number in Deadlock's data (SteamID3) from a SteamID64. */
export const steamId3 = (id64: string) => String(BigInt(id64) - 76561197960265728n);

export interface DlHistoryRow {
  match_id: number; hero_id: number; start_time: number; match_duration_s: number; player_team: number; match_result: number;
  player_kills: number; player_deaths: number; player_assists: number; net_worth: number; last_hits: number; game_mode: number;
  /** ranked matches: the badge shown after it (tier × 10 + subrank) and its change */ ranked_display_badge?: number | null; ranked_delta?: number | null;
}
/** A player's matches, newest first. */
export async function matchHistory(account: string): Promise<DlHistoryRow[]> {
  const rows = await get<DlHistoryRow[]>(`/v1/players/${account}/match-history`);
  return [...rows].sort((a, b) => b.start_time - a.start_time);
}

/** The matches you played with a Steam friend on your team (deadlock-api's "same party": same team and Steam friends at
 * the start). Normal matches only. */
export async function partyMatches(account: string): Promise<Set<number>> {
  const mates = await get<{ mate_id: number; matches: number[] }[]>(`/v1/players/${account}/mate-stats?same_party=true`);
  return new Set(mates.flatMap(m => m.matches));
}
/** Your matches split into solo and with a friend: how many, how many won, the KDA. */
export function soloVsParty(rows: DlHistoryRow[], party: Set<number>) {
  const side = (xs: DlHistoryRow[]) => ({
    n: xs.length, wins: xs.filter(r => r.match_result === r.player_team).length,
    kda: xs.reduce((a, r) => a + r.player_kills + r.player_assists, 0) / Math.max(1, xs.reduce((a, r) => a + r.player_deaths, 0)),
  });
  return { solo: side(rows.filter(r => !party.has(r.match_id))), party: side(rows.filter(r => party.has(r.match_id))) };
}

/** A rank badge (tier × 10 + subrank) as words: "Oracle 4". */
export const RANK_TIERS = ['', 'Initiate', 'Seeker', 'Alchemist', 'Arcanist', 'Ritualist', 'Emissary', 'Archon', 'Oracle', 'Phantom', 'Ascendant', 'Eternus'];
export const rankName = (b: number) => `${RANK_TIERS[Math.floor(b / 10)] ?? 'Rank'} ${b % 10 || ''}`.trim();

/** A player in a live match, scouted: their rank, and how they do on the hero they're playing (all their matches). */
export interface ScoutRow { account: number; team: number; hero: number; name: string | null; badge: number | null; games: number; wr: number | null; kda: number | null }
type LivePlayer = { account_id: number; team: number; hero_id: number };
type HeroStat = { account_id: number; hero_id: number; matches_played: number; wins: number; kills: number; deaths: number; assists: number };
/** Your live match, when it's in the game's watch list (the top 200 matches being played), or null. */
export async function liveMatch(account: string): Promise<{ id: number; start: number; players: LivePlayer[] } | null> {
  const ms = await get<{ match_id: number; start_time: number; players: LivePlayer[] }[]>(`/v1/matches/active?account_id=${account}`).catch(() => []);
  const m = ms.find(x => x.players.some(p => String(p.account_id) === account));
  return m ? { id: m.match_id, start: m.start_time, players: m.players } : null;
}
/** Every player in it with their rank and their record on this hero. */
export async function scout(players: LivePlayer[]): Promise<ScoutRow[]> {
  const ids = players.map(p => p.account_id).join(',');
  const [stats, ranks, names] = await Promise.all([
    get<HeroStat[]>(`/v1/players/hero-stats?account_ids=${ids}`).catch(() => [] as HeroStat[]),
    get<{ account_id: number; badge?: number | null }[]>(`/v1/players/rank?account_ids=${ids}`).catch(() => []),
    steamNames(players.map(p => p.account_id)),
  ]);
  return scoutRows(players, stats, ranks, names);
}
export function scoutRows(players: LivePlayer[], stats: HeroStat[], ranks: { account_id: number; badge?: number | null }[], names: Record<number, { name: string }>): ScoutRow[] {
  return players.map(p => {
    const s = stats.find(x => x.account_id === p.account_id && x.hero_id === p.hero_id);
    return {
      account: p.account_id, team: p.team, hero: p.hero_id, name: names[p.account_id]?.name ?? null,
      badge: ranks.find(r => r.account_id === p.account_id)?.badge || null,
      games: s?.matches_played ?? 0, wr: s?.matches_played ? s.wins / s.matches_played : null,
      kda: s?.matches_played ? (s.kills + s.assists) / Math.max(1, s.deaths) : null,
    };
  });
}

const KEY = (id: number) => `dlmatch4:${id}`;
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

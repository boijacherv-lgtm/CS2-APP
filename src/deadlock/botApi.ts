/**
 * The Deadlock bot service (server/src/deadlock.mjs): a Steam bot visitors add as a friend once; it then finds their new
 * matches by itself and hands them to deadlock-api. The site asks it who the bot is, whether you're its friend, and
 * your matches as it last saw them (they show here before deadlock-api has them).
 */
import { DL_BOT_URL } from '../env';
import type { DlHistoryRow } from './api';

export const BOT_ON = !!DL_BOT_URL;
export type BotRelation = 'friend' | 'pending' | 'none';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(DL_BOT_URL + path, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error ?? `The bot answered ${res.status}.`);
  return out as T;
}
export const botInfo = () => call<{ steamId: string | null; state: string; friends: number; pollMinutes: number }>('/dl/bot');
export const botFriend = (account: string) => call<{ relation: BotRelation; polled: number | null }>(`/dl/friend/${account}`);
type GcMatch = { match_id: number; hero_id: number; match_duration_s: number; start_time: number; match_result: number; player_team: number;
  player_kills: number; player_deaths: number; player_assists: number; last_hits: number; net_worth: number; game_mode: number };
const toRow = (m: GcMatch): DlHistoryRow => ({ ...m, match_id: Number(m.match_id) });
export const botMatches = (account: string) =>
  call<{ relation: BotRelation; polled?: number | null; matches: GcMatch[] }>(`/dl/matches/${account}`).then(r => ({ ...r, matches: r.matches.map(toRow) }));
export const botRefresh = (account: string) =>
  call<{ polled: number; matches: GcMatch[] }>(`/dl/refresh/${account}`, { method: 'POST' }).then(r => ({ ...r, matches: r.matches.map(toRow) }));

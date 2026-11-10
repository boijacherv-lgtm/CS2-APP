/**
 * The Deadlock bot's view, for the site (the bot runs on GitHub Actions every 15 minutes, server/src/once.mjs, and
 * can't be reached itself):
 *   POST /internal/dlbot          the bot (SERVER_TOKEN): who it is, its friends, their recent matches
 *   GET  /dl/bot                  who to add as a friend, how often it looks
 *   GET  /dl/friend/<account>     'friend', 'pending' or 'none'
 *   GET  /dl/matches/<account>    a friend's recent matches as the bot last saw them
 * One KV key, written only when something changed (KV's free plan has 1,000 writes a day).
 */
import type { AdminKV } from './admin';

const KEY = 'dlbot:state';
export const POLL_MINUTES = 15;
interface BotState { steamId: string | null; friends: number[]; pending: number[]; matches: Record<string, unknown[]>; polled: Record<string, number>; at: number }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.map(num).filter((x): x is number => x !== null).slice(0, 5000) : []);

export async function saveBotState(kv: AdminKV, raw: Record<string, unknown>) {
  const matches: Record<string, unknown[]> = {}, polled: Record<string, number> = {};
  const rm = (raw.matches ?? {}) as Record<string, unknown>, rp = (raw.polled ?? {}) as Record<string, unknown>;
  const friends = ids(raw.friends);
  for (const a of friends) {
    if (Array.isArray(rm[a])) matches[a] = (rm[a] as unknown[]).slice(0, 50);
    const p = num(rp[a]); if (p) polled[a] = p;
  }
  const next: BotState = { steamId: typeof raw.steamId === 'string' && /^7656\d{13}$/.test(raw.steamId) ? raw.steamId : null,
    friends, pending: ids(raw.pending), matches, polled, at: Date.now() };
  // skip the write when only the times moved (every run polls everyone)
  const prev = await kv.get(KEY, 'json') as BotState | null;
  const same = prev && JSON.stringify({ ...prev, polled: 0, at: 0 }) === JSON.stringify({ ...next, polled: 0, at: 0 }) && Date.now() - prev.at < 6 * 3600e3;
  if (!same) await kv.put(KEY, JSON.stringify(next));
  return { ok: true, written: !same };
}

/** The public answers; null for a path that isn't one of them. */
export async function botRoute(kv: AdminKV, path: string): Promise<unknown | null> {
  const st = await kv.get(KEY, 'json') as BotState | null;
  if (path === '/dl/bot') return { steamId: st?.steamId ?? null, state: st ? 'ready' : 'off', friends: st?.friends.length ?? 0, pollMinutes: POLL_MINUTES };
  const m = path.match(/^\/dl\/(friend|matches)\/(\d{1,12})$/);
  if (!m) return null;
  const a = Number(m[2]);
  const relation = st?.friends.includes(a) ? 'friend' : st?.pending.includes(a) ? 'pending' : 'none';
  if (m[1] === 'friend') return { relation, polled: st?.polled[a] ?? null };
  return relation === 'friend' ? { relation, polled: st?.polled[a] ?? null, matches: st?.matches[a] ?? [] } : { relation, matches: [] };
}

/**
 * The site owner's dev page (GET /admin/stats): everything the Worker knows, counted. Only for the SteamIDs in
 * OWNER_IDS (wrangler.toml); everyone else gets 403. It reads every user's record, so it's for a handful of loads a
 * day, not a live dashboard (KV's free plan allows 100,000 reads a day).
 *
 * The demo bot reports after each round (POST /internal/heartbeat), so the page shows when it last ran.
 */
import type { ProfileData } from '../../src/engine/profile';

export interface AdminKV {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  list(o: { prefix: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export const isOwner = (ownerIds: string | undefined, steamId: string | null) =>
  !!steamId && (ownerIds ?? '').split(',').map(s => s.trim()).includes(steamId);

/** Every key under a prefix (paged; stops at `max`). */
async function keys(kv: AdminKV, prefix: string, max = 5000): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    out.push(...page.keys.map(k => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < max);
  return out;
}

interface UserRecord { authCode?: string; knownCode?: string; lastSyncAt?: number; note?: string | null;
  matches: { outcomeId: string; foundAt: number; parsed?: boolean; gone?: boolean; error?: string | null; tries?: number; map?: string | null }[] }

const READ_CAP = 500; // records read per load (profiles and match lists each)
const WEEK = 7 * 86400000;
/** The Monday a moment falls in (UTC), as YYYY-MM-DD. */
const weekOf = (ms: number) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

export async function adminStats(kv: AdminKV) {
  const [userKeys, statKeys, sessionKeys, demoKeys] = await Promise.all([keys(kv, 'user:'), keys(kv, 'stats:'), keys(kv, 'session:'), keys(kv, 'demo:')]);

  // profiles: matches reviewed, public, notify-me, goals, maps, results, last activity
  const profiles = { count: statKeys.length, read: 0, matches: 0, public: 0, notifyPro: 0, withGoals: 0, lastMatchAt: 0,
    goals: {} as Record<string, number>, maps: {} as Record<string, number>, results: { win: 0, loss: 0, tie: 0 },
    /** Matches played per week (Monday, YYYY-MM-DD), the last 12 weeks. */
    weeks: {} as Record<string, number>,
    /** Level grades (B = a typical level-10 game) across every match. */
    levels: {} as Record<string, number>,
    engine: null as number | null,
    top: [] as { steamId: string; matches: number; lastAt: number }[] };
  const weekFloor = Date.now() - 12 * WEEK;
  let engineSum = 0, engineN = 0;
  for (const k of statKeys.slice(0, READ_CAP)) {
    const p = (await kv.get(k, 'json')) as ProfileData | null;
    if (!p) continue;
    profiles.read++;
    const ms = p.matches ?? [];
    profiles.matches += ms.length;
    if (p.prefs?.public) profiles.public++;
    if (p.notifyPro) profiles.notifyPro++;
    if (p.goals?.length) profiles.withGoals++;
    for (const g of p.goals ?? []) profiles.goals[g.id] = (profiles.goals[g.id] ?? 0) + 1;
    for (const m of ms) {
      profiles.maps[m.map] = (profiles.maps[m.map] ?? 0) + 1;
      if (m.at > weekFloor) { const w = weekOf(m.at); profiles.weeks[w] = (profiles.weeks[w] ?? 0) + 1; }
      const grade = m.level ?? null;
      if (grade) profiles.levels[grade] = (profiles.levels[grade] ?? 0) + 1;
      if (typeof m.engine === 'number') { engineSum += m.engine; engineN++; }
      profiles.results[m.result] = (profiles.results[m.result] ?? 0) + 1;
    }
    const lastAt = Math.max(0, ...ms.map(m => m.at));
    profiles.lastMatchAt = Math.max(profiles.lastMatchAt, lastAt);
    profiles.top.push({ steamId: k.slice(6), matches: ms.length, lastAt });
  }
  profiles.top = profiles.top.sort((a, b) => b.matches - a.matches).slice(0, 10);
  profiles.engine = engineN ? +(engineSum / engineN).toFixed(1) : null;
  // every week of the last 12, empty ones too (a chart's x axis)
  for (let k = 0; k < 12; k++) { const w = weekOf(Date.now() - k * WEEK); profiles.weeks[w] ??= 0; }

  // match lists (Your matches + the bot): who set up their codes, how the demos went, the latest errors
  const lists = { count: userKeys.length, read: 0, withCodes: 0, matches: 0, parsed: 0, pending: 0, gone: 0, failing: 0, lastSyncAt: 0,
    errors: [] as { steamId: string; outcomeId: string; error: string; at: number }[], notes: [] as { steamId: string; note: string }[] };
  for (const k of userKeys.slice(0, READ_CAP)) {
    const u = (await kv.get(k, 'json')) as UserRecord | null;
    if (!u) continue;
    lists.read++;
    const id = k.slice(5);
    if (u.authCode && u.knownCode) lists.withCodes++;
    lists.lastSyncAt = Math.max(lists.lastSyncAt, u.lastSyncAt ?? 0);
    if (u.note) lists.notes.push({ steamId: id, note: u.note });
    for (const m of u.matches ?? []) {
      lists.matches++;
      if (m.parsed) lists.parsed++;
      else if (m.gone) lists.gone++;
      else if ((m.tries ?? 0) >= 3) lists.failing++;
      else lists.pending++;
      if (m.error && !m.parsed) lists.errors.push({ steamId: id, outcomeId: m.outcomeId, error: m.error, at: m.foundAt });
    }
  }
  lists.errors = lists.errors.sort((a, b) => b.at - a.at).slice(0, 15);
  lists.notes = lists.notes.slice(0, 10);

  return {
    at: Date.now(),
    keys: { users: userKeys.length, profiles: statKeys.length, sessions: sessionKeys.length, demos: demoKeys.length },
    profiles, lists,
    bot: (await kv.get('server:heartbeat', 'json')) as Record<string, unknown> | null,
  };
}

/** The demo bot's report after a round: kept as one record (only the newest matters). */
export async function saveHeartbeat(kv: AdminKV, raw: Record<string, unknown>) {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const beat = {
    at: Date.now(), users: n(raw.users), handled: n(raw.handled), ready: n(raw.ready), failed: n(raw.failed), gone: n(raw.gone),
    cycleMs: n(raw.cycleMs), grading: raw.grading === true, version: typeof raw.version === 'string' ? raw.version.slice(0, 40) : null,
  };
  await kv.put('server:heartbeat', JSON.stringify(beat));
  return beat;
}

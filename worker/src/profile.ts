/**
 * Your profile on the website: the matches you reviewed as yourself (summaries only, no demos), your goals and your
 * settings, one KV value per SteamID (`stats:<id>`). Only what src/engine/profile.ts accepts is stored.
 *
 *   GET  /profile           yours
 *   POST /profile/match     add or replace one reviewed match
 *   POST /profile/goals     what you're working on (up to 3)
 *   POST /profile/prefs     public profile, default comparison
 *   POST /profile/notify    tell me when Pro launches
 *   GET  /public/:steamId   a friend's name, avatar and last matches, only if their profile is public
 *   GET  /resolve?q=        a Steam profile link, vanity name or SteamID → SteamID (logged-in only)
 */
import { cleanGoals, cleanMatch, cleanPrefs, EMPTY_PROFILE, FREE_HISTORY, withMatch, type ProfileData } from '../../src/engine/profile';

export interface ProfileKV {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const KEY = (steamId: string) => `stats:${steamId}`;

export async function loadProfile(kv: ProfileKV, steamId: string): Promise<ProfileData> {
  const v = (await kv.get(KEY(steamId), 'json')) as Partial<ProfileData> | null;
  return { ...EMPTY_PROFILE, ...(v ?? {}), prefs: cleanPrefs(v?.prefs) };
}
const save = (kv: ProfileKV, steamId: string, p: ProfileData) => kv.put(KEY(steamId), JSON.stringify(p));
export const forgetProfile = (kv: ProfileKV, steamId: string) => kv.delete(KEY(steamId));

/** The logged-in routes (`steamId` is who's logged in). Null: not a profile route. */
export async function profileRoute(kv: ProfileKV, steamId: string, method: string, path: string, input: Record<string, unknown>): Promise<unknown | null> {
  if (method === 'GET' && path === '/profile') return loadProfile(kv, steamId);
  if (method !== 'POST') return null;
  const p = await loadProfile(kv, steamId);
  if (path === '/profile/match') {
    const m = cleanMatch(input.match);
    if (!m) throw new Error('That isn\'t a match summary.');
    p.matches = withMatch(p.matches, m);
  } else if (path === '/profile/goals') p.goals = cleanGoals(input.goals);
  else if (path === '/profile/prefs') p.prefs = cleanPrefs(input, p.prefs);
  else if (path === '/profile/notify') p.notifyPro = input.on === true;
  else return null;
  await save(kv, steamId, p);
  return p;
}

/** A friend's public profile: only when they made it public, and only their last matches' numbers. */
export async function publicProfileOf(kv: ProfileKV, steamId: string): Promise<{ matches: ProfileData['matches'] } | null> {
  const p = await loadProfile(kv, steamId);
  if (!p.prefs.public) return null;
  return { matches: p.matches.slice(0, FREE_HISTORY) };
}

/** "https://steamcommunity.com/id/name", ".../profiles/7656…", a SteamID or a vanity name → SteamID. */
export async function resolveSteamId(q: string, apiKey: string | undefined): Promise<string | null> {
  const s = q.trim().slice(0, 200);
  const id = s.match(/(7656\d{13})/)?.[1];
  if (id) return id;
  const vanity = s.match(/steamcommunity\.com\/id\/([\w-]{2,32})/)?.[1] ?? (/^[\w-]{2,32}$/.test(s) ? s : null);
  if (!vanity || !apiKey) return null;
  const res = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`);
  if (!res.ok) return null;
  const r = ((await res.json()) as { response?: { success?: number; steamid?: string } }).response;
  return r?.success === 1 && r.steamid && /^7656\d{13}$/.test(r.steamid) ? r.steamid : null;
}

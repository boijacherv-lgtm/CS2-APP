import { create } from 'zustand';
import { STEAM_AVAILABLE } from '../env';
import { cleanGoals, cleanNotifyGames, cleanPrefs, cleanVerdicts, withVerdict, type MoveVerdict, EMPTY_PROFILE, withMatch, type GoalId, type ProfileData, type ProfileMatch, type ProfilePrefs } from '../engine/profile';
import { steamFetch } from './steamApi';
import type { DemoData } from '../engine/recap';

/**
 * Your profile in the browser. Logged in with Steam (website: the Worker; locally: the dev server, when it has the
 * routes), it lives on your account and follows you between devices; otherwise it's kept in this browser. Matches
 * reviewed before logging in are uploaded once you do.
 */
export type SteamMe = { steamId: string; name: string | null; avatar: string | null; /** may open the dev page */ owner?: boolean };

interface ProfileState {
  /** undefined while unknown; null = not logged in (or no Steam on this build). */
  me: SteamMe | null | undefined;
  data: ProfileData;
  /** Where the profile is kept. */
  remote: boolean;
  loaded: boolean;
  error: string | null;
}
export const useProfile = create<ProfileState>(() => ({ me: undefined, data: loadLocal(), remote: false, loaded: false, error: null }));

const LOCAL = 'stratboard.profile';
function loadLocal(): ProfileData {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL) ?? 'null') as Partial<ProfileData> | null;
    return v ? { ...EMPTY_PROFILE, ...v, prefs: cleanPrefs(v.prefs), goals: cleanGoals(v.goals), notifyGames: cleanNotifyGames(v.notifyGames), verdicts: cleanVerdicts(v.verdicts) } : { ...EMPTY_PROFILE };
  } catch { return { ...EMPTY_PROFILE }; }
}
function saveLocal(d: ProfileData) { try { localStorage.setItem(LOCAL, JSON.stringify(d)); } catch { /* private mode: this visit only */ } }

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await steamFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error ?? `The server answered ${res.status}.`);
  return out as T;
}

/** Who's logged in, and the profile from wherever it lives. Safe to call often. */
export async function refreshProfile(): Promise<void> {
  let me: SteamMe | null = null;
  if (STEAM_AVAILABLE) {
    try { const r = await steamFetch('/me'); if (r.ok) me = (await r.json()).me ?? null; } catch { /* offline: this browser */ }
  }
  const local = loadLocal();
  if (!me) { useProfile.setState({ me, data: local, remote: false, loaded: true, error: null }); return; }
  try {
    let data = await api<ProfileData>('/profile');
    // matches reviewed here before logging in go up to the account (once: then they're there)
    const missing = local.matches.filter(m => !data.matches.some(x => x.id === m.id));
    for (const m of missing) data = await api<ProfileData>('/profile/match', { match: m });
    useProfile.setState({ me, data, remote: true, loaded: true, error: null });
  } catch (e) {
    // the account has no profile routes (an older Worker / dev server): keep it in this browser
    useProfile.setState({ me, data: local, remote: false, loaded: true, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Saves a change where the profile lives (`remote` call, or this browser). */
async function update(local: (d: ProfileData) => ProfileData, remote: () => Promise<ProfileData>) {
  const s = useProfile.getState();
  if (s.remote) {
    try { useProfile.setState({ data: await remote(), error: null }); } catch (e) { useProfile.setState({ error: e instanceof Error ? e.message : String(e) }); }
    return;
  }
  const data = local(s.data);
  saveLocal(data);
  useProfile.setState({ data });
}

export const recordMatch = (m: ProfileMatch) => {
  // always kept here too, so logging in later uploads it
  saveLocal({ ...loadLocal(), matches: withMatch(loadLocal().matches, m) });
  return update(d => ({ ...d, matches: withMatch(d.matches, m) }), () => api('/profile/match', { match: m }));
};
export const setGoals = (ids: GoalId[]) => {
  const was = useProfile.getState().data.goals;
  const goals = cleanGoals(ids.map(id => was.find(g => g.id === id) ?? { id, since: Date.now() }));
  return update(d => ({ ...d, goals }), () => api('/profile/goals', { goals }));
};
export const setPrefs = (p: Partial<ProfilePrefs>) =>
  update(d => ({ ...d, prefs: cleanPrefs(p, d.prefs) }), () => api('/profile/prefs', p));
export const setNotifyPro = (on: boolean) =>
  update(d => ({ ...d, notifyPro: on }), () => api('/profile/notify', { on }));
/**
 * "Coach was wrong" on a move (or take it back with { remove: verdictKey }): on your account when logged in, else in
 * this browser; an account server without the route yet (an older Worker) keeps it in this browser instead of failing.
 */
export async function setVerdict(v: MoveVerdict | { remove: string }) {
  const change = (d: ProfileData): ProfileData => ({ ...d, verdicts: withVerdict(d.verdicts, v) });
  const s = useProfile.getState();
  if (s.remote) {
    try { useProfile.setState({ data: await api<ProfileData>('/profile/verdict', 'remove' in v ? { remove: v.remove } : { verdict: v }), error: null }); return; } catch { /* fall through */ }
  }
  saveLocal(change(loadLocal()));
  useProfile.setState({ data: change(s.data) });
}

/**
 * A disputed moment for the owner to check by hand (the dev page): the round it's in and the coach's card, sent when
 * logged in. Fails quietly: the verdict itself is already saved.
 */
export function sendClip(v: MoveVerdict, card: { note: string; title: string; why: string[]; tags: string[] }, data: DemoData) {
  if (!useProfile.getState().remote) return;
  const round = data.rounds[v.round - 1];
  if (!round) return;
  void steamFetch('/clip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: v, card, demo: { ...data, rounds: [round] } }) }).catch(() => {});
}
export function removeClip(key: string) {
  if (useProfile.getState().remote) void api('/clip/remove', { key }).catch(() => {});
}

/**
 * Tell me when this game ("deadlock") goes live: on your account when logged in, else in this browser. An account
 * server without the route yet (an older Worker) keeps it in this browser instead of failing.
 */
export async function setNotifyGame(game: string, on: boolean) {
  const change = (d: ProfileData): ProfileData => ({ ...d, notifyGames: on ? cleanNotifyGames([...d.notifyGames, game]) : d.notifyGames.filter(g => g !== game) });
  const s = useProfile.getState();
  if (s.remote) {
    try { useProfile.setState({ data: await api<ProfileData>('/profile/notify-game', { game, on }), error: null }); return; } catch { /* fall through */ }
  }
  saveLocal(change(loadLocal()));
  useProfile.setState({ data: change(s.data) });
}

/** Removes your synced profile and match list from the account (Steam), or this browser's copy. */
export async function forgetProfile() {
  const s = useProfile.getState();
  if (s.remote) await api('/forget', {});
  try { localStorage.removeItem(LOCAL); } catch { /* nothing kept */ }
  useProfile.setState({ data: { ...EMPTY_PROFILE } });
}

/** A friend's public profile (they turned it on in Settings). */
export interface PublicProfile { steamId: string; name: string | null; avatar: string | null; matches: ProfileMatch[] }
export async function findFriend(q: string): Promise<PublicProfile> {
  const { steamId } = await api<{ steamId: string }>(`/resolve?q=${encodeURIComponent(q)}`);
  return api<PublicProfile>(`/public/${steamId}`);
}

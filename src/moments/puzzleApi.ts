// The site's side of the server's puzzle routes (worker/src/puzzles.ts): an answer to a premade puzzle is counted
// ("X% of players got this"), your record goes to your account when you're logged in, and the leaderboard.
import { STEAM_AVAILABLE } from '../env';
import { steamFetch } from '../ui/steamApi';
import { useProfile } from '../ui/profileApi';
import type { Score } from './score';

/** Counts your answer and returns everyone's so far (null offline, or for your own puzzles, which aren't counted). */
export async function sendAnswer(id: string, right: boolean): Promise<{ tried: number; right: number } | null> {
  if (!STEAM_AVAILABLE || !id.startsWith('p:')) return null;
  try {
    const res = await steamFetch('/puzzle/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, right }) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Your record to your account, a few seconds after the last answer (one write for a run of answers). */
export function syncRecord(s: Score) {
  if (!useProfile.getState().remote) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void steamFetch('/profile/puzzles', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puzzles: { rating: s.rating, solved: s.solved, tried: s.tried, best: s.best, dailyStreak: Math.max(s.daily.streak, ...Object.values(s.dailies ?? {}).map(d => d.streak)), rushBest: s.rushBest } }) }).catch(() => {});
  }, 4000);
}

export interface BoardRow { steamId: string; rating: number; solved: number; tried: number; best: number; name: string | null; avatar: string | null }
/** The top ratings (public profiles), with names and avatars. */
export async function loadBoard(): Promise<BoardRow[]> {
  const res = await steamFetch('/puzzle/board');
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const { rows } = await res.json() as { rows: Omit<BoardRow, 'name' | 'avatar'>[] };
  const names: Record<string, { name: string | null; avatar: string | null }> = {};
  for (let i = 0; i < rows.length; i += 20) {
    const r = await steamFetch(`/profiles?ids=${rows.slice(i, i + 20).map(x => x.steamId).join(',')}`).catch(() => null);
    if (r?.ok) Object.assign(names, (await r.json()).profiles ?? {});
  }
  return rows.map(r => ({ ...r, name: names[r.steamId]?.name ?? null, avatar: names[r.steamId]?.avatar ?? null }));
}

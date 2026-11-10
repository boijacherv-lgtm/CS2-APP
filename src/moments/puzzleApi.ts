// The site's side of the server's puzzle routes (worker/src/puzzles.ts): an answer to a premade puzzle is counted
// ("X% of players got this"), your record goes to your account when you're logged in, and the leaderboard.
import { STEAM_AVAILABLE } from '../env';
import { steamFetch } from '../ui/steamApi';
import { useProfile } from '../ui/profileApi';
import type { PuzzleGame, Score } from './score';

/** Counts your answer and returns everyone's so far (null offline, or for your own puzzles, which aren't counted). */
export async function sendAnswer(id: string, right: boolean): Promise<{ tried: number; right: number } | null> {
  if (!STEAM_AVAILABLE || !id.startsWith('p:')) return null;
  try {
    const res = await steamFetch('/puzzle/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, right }) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const timers: Partial<Record<PuzzleGame, ReturnType<typeof setTimeout>>> = {};
/** Your record to your account, a few seconds after the last answer (one write for a run of answers). */
export function syncRecord(s: Score, game: PuzzleGame) {
  if (!useProfile.getState().remote) return;
  if (timers[game]) clearTimeout(timers[game]);
  timers[game] = setTimeout(() => {
    void steamFetch('/profile/puzzles', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puzzles: { rating: s.rating, solved: s.solved, tried: s.tried, best: s.best, dailyStreak: (s.dailies?.[game] ?? s.daily).streak, rushBest: s.rushBest }, game }) }).catch(() => {});
  }, 4000);
}

export interface BoardRow { steamId: string; rating: number; solved: number; tried: number; best: number; name: string | null; avatar: string | null }
/** The top ratings (public profiles), with names and avatars. */
/** Names and avatars for board rows (the Worker's /profiles, 20 at a time). */
async function named(rows: Omit<BoardRow, 'name' | 'avatar'>[]): Promise<BoardRow[]> {
  const names: Record<string, { name: string | null; avatar: string | null }> = {};
  for (let i = 0; i < rows.length; i += 20) {
    const r = await steamFetch(`/profiles?ids=${rows.slice(i, i + 20).map(x => x.steamId).join(',')}`).catch(() => null);
    if (r?.ok) Object.assign(names, (await r.json()).profiles ?? {});
  }
  return rows.map(r => ({ ...r, name: names[r.steamId]?.name ?? null, avatar: names[r.steamId]?.avatar ?? null }));
}

export async function loadBoard(game: PuzzleGame): Promise<BoardRow[]> {
  const res = await steamFetch(`/puzzle/board?game=${game}`);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return named((await res.json() as { rows: Omit<BoardRow, 'name' | 'avatar'>[] }).rows);
}

/** You and your Steam friends with public profiles (logged in). `note`: why it's short (a private friends list…). */
export async function loadFriendsBoard(game: PuzzleGame): Promise<{ rows: BoardRow[]; note: string | null }> {
  const res = await steamFetch(`/puzzle/friends?game=${game}`);
  const out = await res.json().catch(() => ({})) as { rows?: Omit<BoardRow, 'name' | 'avatar'>[]; note?: string | null; error?: string };
  if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
  return { rows: await named(out.rows ?? []), note: out.note ?? null };
}

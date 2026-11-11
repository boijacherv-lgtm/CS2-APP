/**
 * Puzzles on the server: how many players got each premade puzzle right, and the puzzle leaderboard.
 *
 *   POST /puzzle/answer   { id, right }  anyone (rate-limited per IP): counts one answer, returns { tried, right }
 *   GET  /puzzle/board                   anyone: the top ratings of players whose profile is public
 *   GET  /puzzle/friends                 logged in: you and your Steam friends with public profiles, by rating
 *
 * KV: pz:<id> ({ tried, right } for one puzzle; only premade ones, "p:…"), pzboard (the top 100: steamId, rating,
 * solved, tried, best). The board is updated when a player saves their record (POST /profile/puzzles, profile.ts).
 */
import { puzzleField, type PuzzleGame, type PuzzleRecord } from '../../src/engine/profile';
import { loadProfile, type ProfileKV } from './profile';

// one board per game (CS2's kept its first key)
const BOARD = (g: PuzzleGame) => (g === 'deadlock' ? 'pzboard:deadlock' : 'pzboard'), MAX_BOARD = 100;
export interface BoardRow { steamId: string; rating: number; solved: number; tried: number; best: number; at: number }

/** Premade puzzle ids only ("p:" + the match and moment), so the counts can't be used to store anything else. */
const okId = (id: unknown): id is string => typeof id === 'string' && id.length <= 160 && /^p:[\w|.,;#: -]+$/.test(id);

export async function countAnswer(kv: ProfileKV, input: Record<string, unknown>) {
  if (!okId(input.id) || typeof input.right !== 'boolean') throw new Error('That isn\'t a puzzle answer.');
  const key = `pz:${input.id}`;
  const was = ((await kv.get(key, 'json')) ?? { tried: 0, right: 0 }) as { tried: number; right: number };
  // KV's free plan has 1,000 writes a day: past 100 answers the share barely moves, so one answer in w is written,
  // counted w times (the same totals on average, far fewer writes)
  const w = Math.max(1, Math.floor(was.tried / 100));
  if (w > 1 && Math.random() * w >= 1) return { tried: was.tried + 1, right: was.right + (input.right ? 1 : 0) };
  const now = { tried: was.tried + w, right: was.right + (input.right ? w : 0) };
  await kv.put(key, JSON.stringify(now));
  return now;
}

export async function board(kv: ProfileKV, g: PuzzleGame = 'cs2'): Promise<BoardRow[]> {
  return ((await kv.get(BOARD(g), 'json')) ?? []) as BoardRow[];
}

/** Puts a player on the board (public profile) or takes them off; keeps the top MAX_BOARD by rating. */
export async function updateBoard(kv: ProfileKV, steamId: string, rec: PuzzleRecord | undefined, isPublic: boolean, g: PuzzleGame = 'cs2') {
  const rows = (await board(kv, g)).filter(r => r.steamId !== steamId);
  // at least 10 puzzles tried: a rating from 2 answers isn't one
  if (isPublic && rec && rec.tried >= 10) rows.push({ steamId, rating: rec.rating, solved: rec.solved, tried: rec.tried, best: rec.best, at: rec.at });
  rows.sort((a, b) => b.rating - a.rating);
  const next = JSON.stringify(rows.slice(0, MAX_BOARD));
  // nothing changed (not on the board, and still not): no write
  if (next !== JSON.stringify(await board(kv, g))) await kv.put(BOARD(g), next);
}

/**
 * You and your Steam friends on the puzzle board: their Steam friends list (it has to be public on Steam), then each
 * friend's record where their RageView profile is public. At most 150 friends are looked at.
 */
export async function friendsBoard(kv: ProfileKV, steamId: string, apiKey: string | undefined, g: PuzzleGame = 'cs2'): Promise<{ rows: BoardRow[]; note: string | null }> {
  if (!apiKey) return { rows: [], note: 'The site has no Steam Web API key configured yet.' };
  const res = await fetch(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&relationship=friend`);
  if (res.status === 401 || res.status === 403) return { rows: [], note: 'Your Steam friends list is private: set it to public on Steam (Edit profile → Privacy settings) to see your friends here.' };
  if (!res.ok) return { rows: [], note: `Steam answered ${res.status}; try again later.` };
  const list = ((await res.json()) as { friendslist?: { friends?: { steamid?: string }[] } }).friendslist?.friends ?? [];
  const ids = [steamId, ...list.map(f => f.steamid).filter((x): x is string => !!x && /^7656\d{13}$/.test(x)).slice(0, 150)];
  const rows: BoardRow[] = [];
  await Promise.all(ids.map(async id => {
    const p = await loadProfile(kv, id);
    const rec = p[puzzleField(g)];
    if (rec && rec.tried > 0 && (id === steamId || p.prefs.public)) rows.push({ steamId: id, rating: rec.rating, solved: rec.solved, tried: rec.tried, best: rec.best, at: rec.at });
  }));
  rows.sort((a, b) => b.rating - a.rating);
  return { rows, note: rows.length <= 1 ? 'None of your Steam friends has a public RageView profile with puzzles yet.' : null };
}

/**
 * Your Steam friends who use RageView with a public profile (for Profile → Compare with a friend): their SteamIDs and
 * how many matches they have, most first. Their friends list has to be public on Steam; at most 150 friends looked at.
 */
export async function friendsOnSite(kv: ProfileKV, steamId: string, apiKey: string | undefined): Promise<{ friends: { steamId: string; matches: number }[]; note: string | null }> {
  if (!apiKey) return { friends: [], note: 'The site has no Steam Web API key configured yet.' };
  const res = await fetch(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&relationship=friend`);
  if (res.status === 401 || res.status === 403) return { friends: [], note: 'Your Steam friends list is private: set it to public on Steam (Edit profile → Privacy settings) to see your friends here.' };
  if (!res.ok) return { friends: [], note: `Steam answered ${res.status}; try again later.` };
  const list = ((await res.json()) as { friendslist?: { friends?: { steamid?: string }[] } }).friendslist?.friends ?? [];
  const ids = list.map(f => f.steamid).filter((x): x is string => !!x && /^7656\d{13}$/.test(x)).slice(0, 150);
  const out: { steamId: string; matches: number }[] = [];
  await Promise.all(ids.map(async id => {
    const p = await loadProfile(kv, id);
    if (p.prefs.public && p.matches.length) out.push({ steamId: id, matches: p.matches.length });
  }));
  out.sort((a, b) => b.matches - a.matches);
  return { friends: out, note: out.length ? null : 'None of your Steam friends has a public RageView profile yet.' };
}

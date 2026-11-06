/**
 * Puzzles on the server: how many players got each premade puzzle right, and the puzzle leaderboard.
 *
 *   POST /puzzle/answer   { id, right }  anyone (rate-limited per IP): counts one answer, returns { tried, right }
 *   GET  /puzzle/board                   anyone: the top ratings of players whose profile is public
 *
 * KV: pz:<id> ({ tried, right } for one puzzle; only premade ones, "p:…"), pzboard (the top 100: steamId, rating,
 * solved, tried, best). The board is updated when a player saves their record (POST /profile/puzzles, profile.ts).
 */
import type { PuzzleRecord } from '../../src/engine/profile';
import type { ProfileKV } from './profile';

const BOARD = 'pzboard', MAX_BOARD = 100;
export interface BoardRow { steamId: string; rating: number; solved: number; tried: number; best: number; at: number }

/** Premade puzzle ids only ("p:" + the match and moment), so the counts can't be used to store anything else. */
const okId = (id: unknown): id is string => typeof id === 'string' && id.length <= 160 && /^p:[\w|.,;#: -]+$/.test(id);

export async function countAnswer(kv: ProfileKV, input: Record<string, unknown>) {
  if (!okId(input.id) || typeof input.right !== 'boolean') throw new Error('That isn\'t a puzzle answer.');
  const key = `pz:${input.id}`;
  const was = ((await kv.get(key, 'json')) ?? { tried: 0, right: 0 }) as { tried: number; right: number };
  const now = { tried: was.tried + 1, right: was.right + (input.right ? 1 : 0) };
  await kv.put(key, JSON.stringify(now));
  return now;
}

export async function board(kv: ProfileKV): Promise<BoardRow[]> {
  return ((await kv.get(BOARD, 'json')) ?? []) as BoardRow[];
}

/** Puts a player on the board (public profile) or takes them off; keeps the top MAX_BOARD by rating. */
export async function updateBoard(kv: ProfileKV, steamId: string, rec: PuzzleRecord | undefined, isPublic: boolean) {
  const rows = (await board(kv)).filter(r => r.steamId !== steamId);
  // at least 10 puzzles tried: a rating from 2 answers isn't one
  if (isPublic && rec && rec.tried >= 10) rows.push({ steamId, rating: rec.rating, solved: rec.solved, tried: rec.tried, best: rec.best, at: rec.at });
  rows.sort((a, b) => b.rating - a.rating);
  await kv.put(BOARD, JSON.stringify(rows.slice(0, MAX_BOARD)));
}

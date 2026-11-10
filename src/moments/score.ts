// Your puzzle record in this browser, one per game (CS2, Deadlock: each its own rating): right/tried, streak, a rating
// like chess puzzles (Elo against each puzzle's difficulty), how you do per kind of situation (weak spots), the daily
// puzzle's streak and your best rush.
import type { Moment } from './moments';

export interface Score {
  solved: number; tried: number; streak: number; best: number; seen: string[];
  rating: number; tags: Record<string, { tried: number; right: number }>;
  daily: { day: number; right: boolean | null; streak: number }; rushBest: number;
  /** the daily puzzle per game ("cs2", "deadlock"); `daily` is the CS2 one from before there was one per game */
  dailies?: Record<string, { day: number; right: boolean | null; streak: number }>;
}
/** A game's daily record. */
/** A game's daily record (each game's record is its own; `dailies` is from when one record held both). */
export const dailyFor = (s: Score, game: string) => s.dailies?.[game] ?? s.daily;
export type PuzzleGame = 'cs2' | 'deadlock';
// CS2 keeps the first key (the record from before there was one per game counts as CS2's)
const KEY = (g: PuzzleGame) => (g === 'deadlock' ? 'rageview.puzzles.deadlock' : 'rageview.puzzles');
const START: Score = { solved: 0, tried: 0, streak: 0, best: 0, seen: [], rating: 1200, tags: {}, daily: { day: -1, right: null, streak: 0 }, rushBest: 0 };
export const readScore = (g: PuzzleGame = 'cs2'): Score => {
  try {
    const raw = localStorage.getItem(KEY(g));
    if (raw) return { ...START, ...JSON.parse(raw) };
    // Deadlock's first time: its daily streak was kept in the shared record
    const old = g === 'deadlock' ? (JSON.parse(localStorage.getItem(KEY('cs2')) ?? '{}') as Partial<Score>).dailies?.deadlock : undefined;
    return { ...START, ...(old ? { daily: old } : {}) };
  } catch { return { ...START }; }
};
const write = (g: PuzzleGame, s: Score) => { try { localStorage.setItem(KEY(g), JSON.stringify({ ...s, seen: s.seen.slice(-500) })); } catch { /* private mode */ } };

/** How hard a puzzle is (700–2300): the closer the best move is to the next one, the harder to see. */
export function puzzleRating(m: Moment): number {
  const v = m.options.map(o => o.value).sort((a, b) => b - a);
  const margin = v[0] - (v[1] ?? 0);
  return Math.round(Math.min(2300, Math.max(700, 1900 - margin * 4000)));
}
/** Your rating after a puzzle (Elo, K 32). */
export function rated(you: number, puzzle: number, right: boolean): number {
  const expect = 1 / (1 + 10 ** ((puzzle - you) / 400));
  return Math.round(you + 32 * ((right ? 1 : 0) - expect));
}

/** Records an answer; returns the new score and how the rating moved. */
export function record(m: Moment, right: boolean): { score: Score; delta: number } {
  const g: PuzzleGame = m.game === 'deadlock' ? 'deadlock' : 'cs2';
  const s = readScore(g), streak = right ? s.streak + 1 : 0, rating = rated(s.rating, puzzleRating(m), right);
  const t = m.tag ? { ...s.tags, [m.tag]: { tried: (s.tags[m.tag]?.tried ?? 0) + 1, right: (s.tags[m.tag]?.right ?? 0) + (right ? 1 : 0) } } : s.tags;
  const score = { ...s, solved: s.solved + (right ? 1 : 0), tried: s.tried + 1, streak, best: Math.max(s.best, streak), seen: [...s.seen, m.id], rating, tags: t };
  write(g, score);
  return { score, delta: rating - s.rating };
}

/** Days since 1 Jan 2026 (UTC): the daily puzzle's number. */
export const dayNumber = (now = Date.now()) => Math.floor((now - Date.UTC(2026, 0, 1)) / 86400e3);
/** Today's puzzle: the same for everyone (by the day's number, through a fixed shuffle of the premade list). */
export function dailyOf(pool: Moment[], day = dayNumber()): Moment | null {
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
  return sorted[(day * 7919) % sorted.length];
}
export function recordDaily(right: boolean, day = dayNumber(), game: PuzzleGame = 'cs2'): Score {
  const s = readScore(game), was = dailyFor(s, game);
  if (was.day === day) return s;
  const streak = right ? (was.day === day - 1 && was.right ? was.streak + 1 : 1) : 0;
  const score = { ...s, daily: { day, right, streak }, dailies: { ...s.dailies, [game]: { day, right, streak } } };
  write(game, score);
  return score;
}
export function recordRush(n: number, game: PuzzleGame = 'cs2'): Score { const s = readScore(game), score = { ...s, rushBest: Math.max(s.rushBest, n) }; write(game, score); return score; }

/** The kinds of situation you get wrong most (at least 3 tried), worst first. */
export function weakSpots(s: Score): { tag: string; tried: number; rate: number }[] {
  return Object.entries(s.tags).filter(([, v]) => v.tried >= 3).map(([tag, v]) => ({ tag, tried: v.tried, rate: v.right / v.tried })).sort((a, b) => a.rate - b.rate);
}

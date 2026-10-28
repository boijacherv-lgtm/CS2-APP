import type { MoveVerdict } from '../engine/profile';
import type { JudgeReason } from '../engine/corrections';
import type { DemoData } from '../engine/recap';
import { useStore } from '../store';
import { steamFetch } from './steamApi';
import { setRemoved } from './corrections';

/**
 * Disputed moments for the owner (worker/src/clips.ts): the list, your call on one, and opening one as a short clip in
 * Review to judge it (the Dev page's Disputes tab and the judging panel on the board).
 */
export interface Clip {
  id: string; from: string; at: number; verdict: MoveVerdict; done?: boolean; size: number;
  card: { note: string; title: string; why: string[]; tags: string[] };
  /** Your call: the player was right (the coach was wrong) or the coach was. The coach learns from these. */
  ruling?: { side: 'player' | 'coach'; reason?: JudgeReason; note?: string; at: number };
  /** "Coach asks": the coach sent it itself (tools/ask-coach.ts), unsure of its mark: why, and how unsure (0–1). */
  ask?: { why: string; score: number };
}
export type ClipChange = { done?: boolean; delete?: boolean; ruling?: 'player' | 'coach' | null; rulingReason?: JudgeReason; rulingNote?: string };

/** A clip: from this long before the moment to this long after (20 s to judge it). */
export const CLIP_BEFORE = 15, CLIP_AFTER = 5;

export async function adminCall<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const res = await steamFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error ?? `The Worker answered ${res.status}.`);
  return out as T;
}
export const listClips = async () => (await adminCall<{ clips?: Clip[] }>('/admin/clips')).clips ?? [];
/** Your call (or done / delete); the clip as it is now (null when deleted). */
export async function changeClip(c: Clip, change: ClipChange): Promise<Clip | null> {
  const out = await adminCall<{ clip?: Clip }>(`/admin/clip/${c.id}`, change);
  return change.delete ? null : out.clip ?? c;
}
/** Still to judge: not ruled on and not skipped. Players' disputes first (newest first), then the coach's own
 * questions, the ones it's least sure of first. */
export const toJudge = (cs: Clip[]) => {
  const open = cs.filter(c => !c.ruling && !c.done);
  return [...open.filter(c => !c.ask), ...open.filter(c => c.ask).sort((a, b) => b.ask!.score - a.ask!.score)];
};

/** Opens a moment in Review as a 20 s clip, playing, with the judging panel on the board. */
export async function openClip(c: Clip) {
  const data = await adminCall<DemoData>(`/admin/clip/${c.id}`);
  const s = useStore.getState();
  s.startReview(data);
  if (location.hash !== '#/cs2/review') location.hash = '#/cs2/review';
  const from = Math.max(0, c.verdict.t - CLIP_BEFORE), to = c.verdict.t + CLIP_AFTER;
  useStore.setState({ judging: { clip: c, from, to }, time: from, playing: true });
}

/** Takes one moment's mark off by hand (and counts it as "player's right" for the coach); shows at once. */
export async function removeMark(v: MoveVerdict, card: Clip['card'], data: DemoData) {
  const round = data.rounds[v.round - 1];
  if (!round) throw new Error('That round isn\'t loaded.');
  const out = await adminCall<{ key: string }>('/admin/remove-move', { verdict: v, card, demo: { ...data, rounds: [round] } });
  setRemoved(out.key, true);
}
export async function restoreMark(key: string) {
  await adminCall('/admin/restore-move', { key });
  setRemoved(key, false);
}

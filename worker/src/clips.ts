/**
 * Disputed moments: when a logged-in player says "Coach wrong?" on a move, the site sends that round (and the coach's
 * card) here, so the owner can watch the moment on the dev page and check the coach by hand.
 *
 *   POST /clip                 { verdict, card, demo } from the player (demo: the match with just that round)
 *   POST /clip/remove          { key } the player took their verdict back
 *   GET  /admin/clips          the owner: every disputed moment, newest first
 *   GET  /admin/clip/<id>      the owner: one moment's round (gzipped JSON)
 *   POST /admin/clip/<id>      the owner: { done: true | false } or { delete: true }
 *
 * KV: clips (the list) and clip:<id> (the round, gzipped).
 */
import { cleanVerdict, verdictKey, type MoveVerdict } from '../../src/engine/profile';

/** Moments kept (the oldest go first), and per player. */
const MAX_CLIPS = 300, MAX_PER_PLAYER = 60;
/** A round's data is about 0.1–0.4 MB as JSON. */
export const MAX_CLIP_BYTES = 3_000_000;

export interface ClipCard { note: string; title: string; why: string[]; tags: string[] }
export interface ClipEntry { id: string; from: string; at: number; verdict: MoveVerdict; card: ClipCard; done?: boolean; size: number }

interface ClipKV {
  get(key: string, type: 'json'): Promise<unknown>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer): Promise<void>;
  delete(key: string): Promise<void>;
}

const list = async (kv: ClipKV) => ((await kv.get('clips', 'json')) as ClipEntry[] | null) ?? [];
/** One id per player and move: sending it again replaces it. */
async function idOf(from: string, key: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${from}|${key}`));
  return [...new Uint8Array(h).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
function cleanCard(raw: unknown): ClipCard {
  const c = (raw ?? {}) as Partial<ClipCard>;
  return {
    note: str(c.note, 4), title: str(c.title, 200),
    why: Array.isArray(c.why) ? c.why.slice(0, 20).map(w => str(w, 400)) : [],
    tags: Array.isArray(c.tags) ? c.tags.slice(0, 20).map(t => str(t, 30)) : [],
  };
}

export async function saveClip(kv: ClipKV, from: string, text: string) {
  if (text.length > MAX_CLIP_BYTES) throw new Error('That round is too big to send.');
  const input = JSON.parse(text) as { verdict?: unknown; card?: unknown; demo?: { map?: unknown; rounds?: unknown[] } };
  const verdict = cleanVerdict(input.verdict);
  if (!verdict) throw new Error('No verdict with it.');
  const demo = input.demo;
  if (!demo || typeof demo.map !== 'string' || !Array.isArray(demo.rounds) || demo.rounds.length !== 1) throw new Error('Send just the one round.');
  const id = await idOf(from, verdictKey(verdict));
  const gz = await new Response(new Blob([JSON.stringify(demo)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await kv.put(`clip:${id}`, gz);
  let all = (await list(kv)).filter(c => c.id !== id);
  all.unshift({ id, from, at: Date.now(), verdict, card: cleanCard(input.card), size: gz.byteLength });
  // a player's oldest beyond their share, then everyone's oldest beyond the total
  const over = new Set(all.filter(c => c.from === from).slice(MAX_PER_PLAYER).map(c => c.id));
  const drop = new Set([...over, ...all.filter(c => !over.has(c.id)).slice(MAX_CLIPS).map(c => c.id)]);
  for (const d of drop) await kv.delete(`clip:${d}`);
  all = all.filter(c => !drop.has(c.id));
  await kv.put('clips', JSON.stringify(all));
  return { ok: true };
}

export async function removeClip(kv: ClipKV, from: string, key: unknown) {
  if (typeof key !== 'string') return { ok: true };
  const id = await idOf(from, key.slice(0, 200));
  const all = await list(kv);
  if (all.some(c => c.id === id)) { await kv.delete(`clip:${id}`); await kv.put('clips', JSON.stringify(all.filter(c => c.id !== id))); }
  return { ok: true };
}

export const clipList = async (kv: ClipKV) => ({ clips: await list(kv) });
export const clipData = (kv: ClipKV, id: string) => kv.get(`clip:${id}`, 'arrayBuffer');

export async function updateClip(kv: ClipKV, id: string, input: Record<string, unknown>) {
  const all = await list(kv);
  if (input.delete === true) { await kv.delete(`clip:${id}`); await kv.put('clips', JSON.stringify(all.filter(c => c.id !== id))); return { ok: true }; }
  await kv.put('clips', JSON.stringify(all.map(c => (c.id === id ? { ...c, done: input.done === true } : c))));
  return { ok: true };
}

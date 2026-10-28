/**
 * Disputed moments: when a logged-in player says "Coach wrong?" on a move, the site sends that round (and the coach's
 * card) here, so the owner can watch the moment on the dev page and check the coach by hand.
 *
 *   POST /clip                 { verdict, card, demo } from the player (demo: the match with just that round)
 *   POST /clip/remove          { key } the player took their verdict back
 *   GET  /admin/clips          the owner: every disputed moment, newest first
 *   GET  /admin/clip/<id>      the owner: one moment's round (gzipped JSON)
 *   POST /admin/clip/<id>      the owner: { done }, { ruling: 'player' | 'coach' | null, rulingReason, rulingNote } or { delete: true }
 *   POST /admin/remove-move    the owner: { verdict, card, demo } take one moment's mark off (and count it as "player's right")
 *   POST /admin/restore-move   the owner: { key } put it back
 *   GET  /corrections          anyone: what the rulings change in the coach's marks, and the marks removed by hand
 *   GET  /internal/disputes    the coach's tools (SERVER_TOKEN): every ruled moment; /internal/clip/<id> its round
 *   POST /internal/ask         the coach's tools: { verdict, card, demo, ask: { why, score } } a moment the coach is
 *                              unsure of ("Coach asks"), judged like a dispute; GET /internal/asks: the ones sent so far
 *
 * KV: clips (the list), clip:<id> (the round, gzipped) and rulings (who was right, per move pattern: kept when a
 * moment is deleted, so the coach doesn't forget what it learned).
 */
import { cleanVerdict, verdictKey, type MoveVerdict } from '../../src/engine/profile';
import { isJudgeReason, patternOf, tableOf, type JudgeReason } from '../../src/engine/corrections';

/** Moments kept (the oldest go first), and per player. */
const MAX_CLIPS = 300, MAX_PER_PLAYER = 60;
/** A round's data is about 0.1–0.4 MB as JSON. */
export const MAX_CLIP_BYTES = 3_000_000;

export interface ClipCard { note: string; title: string; why: string[]; tags: string[] }
/** The owner's call on a moment: the player was right (the coach was wrong) or the coach was. */
export interface Ruling { side: 'player' | 'coach'; reason?: JudgeReason; note?: string; at: number }
export interface ClipEntry { id: string; from: string; at: number; verdict: MoveVerdict; card: ClipCard; done?: boolean; ruling?: Ruling; size: number;
  /** "Coach asks": the coach sent it itself, unsure of its mark (why, and how unsure: 0–1). */
  ask?: { why: string; score: number } }
/** The sender of the coach's own questions. */
export const COACH_ASKS = 'coach';
type RulingRow = { id: string; pattern: string; side: Ruling['side']; reason?: JudgeReason; at: number };
/** Rulings kept (the oldest go first). */
const MAX_RULINGS = 5000;
/** Marks removed by hand (verdict keys), kept the newest first. */
const MAX_REMOVED = 5000;
const removedList = async (kv: ClipKV) => ((await kv.get('removed', 'json')) as { key: string; at: number }[] | null) ?? [];

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
  const input = JSON.parse(text) as { verdict?: unknown; card?: unknown; demo?: { map?: unknown; rounds?: unknown[] }; ask?: { why?: unknown; score?: unknown } };
  const verdict = cleanVerdict(input.verdict);
  if (!verdict) throw new Error('No verdict with it.');
  const demo = input.demo;
  if (!demo || typeof demo.map !== 'string' || !Array.isArray(demo.rounds) || demo.rounds.length !== 1) throw new Error('Send just the one round.');
  const id = await idOf(from, verdictKey(verdict));
  // the coach asking again about a moment already judged: leave it as it is
  if (from === COACH_ASKS && (await list(kv)).some(c => c.id === id && (c.ruling || c.done))) return { ok: true, id, skipped: true };
  const ask = from === COACH_ASKS ? { why: str(input.ask?.why, 300), score: typeof input.ask?.score === 'number' ? Math.max(0, Math.min(1, input.ask.score)) : 0 } : null;
  const gz = await new Response(new Blob([JSON.stringify(demo)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await kv.put(`clip:${id}`, gz);
  const before = (await list(kv)).find(c => c.id === id);
  let all = (await list(kv)).filter(c => c.id !== id);
  // sent again (a note added): the owner's call stays if the player's answer is the same
  const keep = before && before.verdict.verdict === verdict.verdict ? { ...(before.done ? { done: true } : {}), ...(before.ruling ? { ruling: before.ruling } : {}) } : {};
  all.unshift({ id, from, at: Date.now(), verdict, card: cleanCard(input.card), size: gz.byteLength, ...keep, ...(ask ? { ask } : {}) });
  // a player's oldest beyond their share, then everyone's oldest beyond the total
  const over = new Set(all.filter(c => c.from === from).slice(MAX_PER_PLAYER).map(c => c.id));
  const drop = new Set([...over, ...all.filter(c => !over.has(c.id)).slice(MAX_CLIPS).map(c => c.id)]);
  for (const d of drop) await kv.delete(`clip:${d}`);
  all = all.filter(c => !drop.has(c.id));
  await kv.put('clips', JSON.stringify(all));
  return { ok: true, id };
}
/** The coach's questions sent so far (verdict keys), so its tool doesn't send the same moment twice. */
export const askedKeys = async (kv: ClipKV) => ({ keys: (await list(kv)).filter(c => c.from === COACH_ASKS).map(c => verdictKey(c.verdict)) });

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
  const c = all.find(x => x.id === id);
  if (!c) throw new Error('That moment is gone.');
  if ('done' in input) c.done = input.done === true;
  if ('ruling' in input) {
    const side = input.ruling === 'player' || input.ruling === 'coach' ? input.ruling : null;
    const note = str(input.rulingNote, 400), reason = isJudgeReason(input.rulingReason) ? input.rulingReason : undefined;
    if (side) { c.ruling = { side, ...(reason ? { reason } : {}), ...(note ? { note } : {}), at: Date.now() }; c.done = true; } else delete c.ruling;
    // the coach learns from it: one row per moment, replaced when the call changes
    const rows = (((await kv.get('rulings', 'json')) as RulingRow[] | null) ?? []).filter(r => r.id !== id);
    if (side) rows.unshift({ id, pattern: patternOf(c.verdict.kind, c.card.note, c.card.tags), side, ...(reason ? { reason } : {}), at: Date.now() });
    await kv.put('rulings', JSON.stringify(rows.slice(0, MAX_RULINGS)));
  }
  await kv.put('clips', JSON.stringify(all));
  return { ok: true, clip: c };
}

/** What the rulings change: { pattern: { wrong, right } } (engine/corrections.ts decides when that's enough), and the
 * marks removed by hand. */
export async function corrections(kv: ClipKV) {
  return { table: tableOf(((await kv.get('rulings', 'json')) as RulingRow[] | null) ?? []), removed: (await removedList(kv)).map(r => r.key) };
}

/** The owner takes a moment's mark off: saved like a dispute (with its round, to judge or test later), ruled "player's
 * right" at once (the coach learns from it), and that one moment shows unmarked for everyone. */
export async function removeMove(kv: ClipKV, owner: string, text: string) {
  await saveClip(kv, owner, text);
  const verdict = cleanVerdict((JSON.parse(text) as { verdict?: unknown }).verdict)!;
  const key = verdictKey(verdict);
  await updateClip(kv, await idOf(owner, key), { ruling: 'player', rulingNote: 'Removed by hand' });
  const rows = (await removedList(kv)).filter(r => r.key !== key);
  await kv.put('removed', JSON.stringify([{ key, at: Date.now() }, ...rows].slice(0, MAX_REMOVED)));
  return { ok: true, key };
}
export async function restoreMove(kv: ClipKV, owner: string, key: unknown) {
  if (typeof key !== 'string') return { ok: true };
  await kv.put('removed', JSON.stringify((await removedList(kv)).filter(r => r.key !== key)));
  try { await updateClip(kv, await idOf(owner, key.slice(0, 200)), { ruling: null }); } catch { /* the moment is gone: nothing to take back */ }
  return { ok: true };
}

/** Every moment the owner has ruled on (the coach's tools fetch each one's round with /internal/clip/<id>). */
export const ruledClips = async (kv: ClipKV) => ({ clips: (await list(kv)).filter(c => c.ruling) });

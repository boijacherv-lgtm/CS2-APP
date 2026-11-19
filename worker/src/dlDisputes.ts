/**
 * Deadlock's "Coach wrong?": a logged-in player says one of the coach's marks is off (should be better or worse); the
 * owner watches the moment and rules who was right on the dev page; the rulings become corrections the site's coach
 * applies to moments of the same kind (same kind of move and tags).
 *
 *   POST /dl/dispute            { match, t, slot, kind, note, title, why, tags, want: 'better' | 'worse', comment? }
 *   POST /dl/dispute/remove     { id }   take it back
 *   GET  /admin/dldisputes      the owner: every dispute, newest first
 *   POST /admin/dldispute/<id>  the owner: { ruling: 'player' | 'coach' | null } or { delete: true }
 *   GET  /dl/corrections        anyone: per kind of moment, how many rulings went each way and which way players wanted
 *
 * KV: dldisputes (the list, at most 500, 40 per player; ruled ones are kept first).
 */
interface KV { get(key: string, type: 'json'): Promise<unknown>; put(key: string, value: string): Promise<void> }
export interface DlDispute {
  id: string; from: string; at: number; match: number; t: number; slot: number; kind: string; note: string; title: string; why: string[]; tags: string[];
  want: 'better' | 'worse'; comment: string; ruling?: { side: 'player' | 'coach'; at: number };
}
const MAX = 500, PER_PLAYER = 40;
const KINDS = new Set(['death', 'kill', 'laning']), NOTES = new Set(['!!', '!', 'book', '?!', '?', '??']);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const list = async (kv: KV) => ((await kv.get('dldisputes', 'json')) as DlDispute[] | null) ?? [];
/** The kind of moment a ruling applies to: what happened and its tags (e.g. "death|ISOLATED,OUTNUMBERED"). */
export const patternOf = (kind: string, tags: string[]) => `${kind}|${[...tags].sort().join(',')}`;

async function idOf(...parts: (string | number)[]) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(h).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function saveDispute(kv: KV, from: string, input: Record<string, unknown>) {
  const match = Number(input.match), t = Number(input.t), slot = Number(input.slot);
  const kind = str(input.kind, 12), note = str(input.note, 3), want = input.want === 'better' || input.want === 'worse' ? input.want : null;
  if (!Number.isFinite(match) || match <= 0 || !Number.isFinite(t) || !Number.isFinite(slot) || !KINDS.has(kind) || !NOTES.has(note) || !want) throw new Error('That isn\'t a moment of a match.');
  const id = await idOf(from, match, Math.round(t), slot, kind);
  const all = (await list(kv)).filter(d => d.id !== id);
  all.unshift({ id, from, at: Date.now(), match, t, slot, kind, note, title: str(input.title, 200), want, comment: str(input.comment, 400),
    why: Array.isArray(input.why) ? input.why.slice(0, 12).map(w => str(w, 300)) : [], tags: Array.isArray(input.tags) ? input.tags.slice(0, 10).map(x => str(x, 20)) : [] });
  // a player's oldest beyond their share; past the total, the oldest unruled first (rulings are what the coach learns)
  const mine = all.filter(d => d.from === from && !d.ruling);
  const drop = new Set(mine.slice(PER_PLAYER).map(d => d.id));
  const kept = all.filter(d => !drop.has(d.id));
  while (kept.length > MAX) { const i = kept.map(d => !d.ruling).lastIndexOf(true); if (i < 0) break; kept.splice(i, 1); }
  await kv.put('dldisputes', JSON.stringify(kept.slice(0, MAX)));
  return { ok: true, id };
}

export async function removeDispute(kv: KV, from: string, id: unknown) {
  const all = await list(kv);
  await kv.put('dldisputes', JSON.stringify(all.filter(d => !(d.id === id && d.from === from && !d.ruling))));
  return { ok: true };
}

export const disputeList = async (kv: KV) => ({ disputes: await list(kv) });

export async function ruleDispute(kv: KV, id: string, input: Record<string, unknown>) {
  const all = await list(kv);
  if (input.delete === true) { await kv.put('dldisputes', JSON.stringify(all.filter(d => d.id !== id))); return { ok: true }; }
  const d = all.find(x => x.id === id);
  if (!d) throw new Error('That dispute is gone.');
  if (input.ruling === 'player' || input.ruling === 'coach') d.ruling = { side: input.ruling, at: Date.now() }; else delete d.ruling;
  await kv.put('dldisputes', JSON.stringify(all));
  return { ok: true, dispute: d };
}

/** Per kind of moment: rulings for the player (and which way they wanted it moved) and for the coach. */
export async function dlCorrections(kv: KV) {
  const out: Record<string, { better: number; worse: number; coach: number }> = {};
  for (const d of await list(kv)) {
    if (!d.ruling) continue;
    const k = patternOf(d.kind, d.tags), c = (out[k] ??= { better: 0, worse: 0, coach: 0 });
    if (d.ruling.side === 'coach') c.coach++; else c[d.want]++;
  }
  return { patterns: out };
}

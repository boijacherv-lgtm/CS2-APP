/**
 * Deadlock "Coach wrong?" (worker/src/dlDisputes.ts): a player says a mark should be better or worse; the owner rules on
 * the dev page; the rulings come back as corrections the coach applies to moments of the same kind.
 */
import { API_URL, ONLINE } from '../env';
import { steamFetch } from '../ui/steamApi';
import type { DlMove } from './coach';

export type Corrections = Record<string, { better: number; worse: number; coach: number }>;
export const patternOf = (kind: string, tags: string[]) => `${kind}|${[...tags].sort().join(',')}`;

async function json<T>(res: Response): Promise<T> {
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error ?? `The site answered ${res.status}.`);
  return out as T;
}

export const sendDispute = (match: number, m: DlMove, want: 'better' | 'worse', comment: string) =>
  steamFetch('/dl/dispute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ match, t: m.t, slot: m.slot, kind: m.kind, note: m.note, title: m.title, why: m.why, tags: m.tags, want, comment }) }).then(r => json<{ id: string }>(r));

/** The rulings so far (public, kept 10 minutes in this browser); none on the local build or offline. */
export async function loadCorrections(): Promise<Corrections> {
  if (!ONLINE || !API_URL) return {};
  const k = 'stratboard.dl.corrections';
  try { const c = JSON.parse(localStorage.getItem(k) ?? 'null'); if (c && Date.now() - c.at < 600_000) return c.v; } catch { /* read again */ }
  const v = (await json<{ patterns: Corrections }>(await fetch(`${API_URL}/dl/corrections`))).patterns;
  try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), v })); } catch { /* private mode */ }
  return v;
}

export interface DlDispute { id: string; from: string; at: number; match: number; t: number; slot: number; kind: string; note: string; title: string; why: string[]; tags: string[];
  want: 'better' | 'worse'; comment: string; ruling?: { side: 'player' | 'coach'; at: number } }
export const ownerDisputes = () => steamFetch('/admin/dldisputes').then(r => json<{ disputes: DlDispute[] }>(r)).then(r => r.disputes);
export const rule = (id: string, body: { ruling?: 'player' | 'coach' | null; delete?: true }) =>
  steamFetch(`/admin/dldispute/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => json(r));

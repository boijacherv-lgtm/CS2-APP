/** Deadlock's patch notes in this browser: deadlock-api's feed (`/v2/patches`), read and kept 6 hours (patches.ts
 * understands it). */
import { parsePatches, type Patch } from './patches';

const API = 'https://api.deadlock-api.com';
const KEEP_MS = 6 * 3600e3;

/** The feed, newest first (kept 6 hours). */
export async function patchNotes(): Promise<Patch[]> {
  const k = 'stratboard.dlpatches';
  try { const c = JSON.parse(localStorage.getItem(k) ?? 'null'); if (c && Date.now() - c.at < KEEP_MS) return c.v; } catch { /* read it again */ }
  const res = await fetch(`${API}/v2/patches`);
  if (!res.ok) throw new Error(`deadlock-api answered ${res.status}.`);
  const v = parsePatches(await res.json());
  try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), v })); } catch { /* too big or private mode */ }
  return v;
}

/** The newest gameplay update and the one before it (for "since the last patch"). */
export async function gameplayPatches(): Promise<Patch[]> {
  return (await patchNotes()).filter(p => p.gameplay);
}

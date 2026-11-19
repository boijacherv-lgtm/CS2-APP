/**
 * The meta's parts that need no browser, shared by the site (meta.ts) and the Worker's job that reads the meta every
 * 3 hours for everyone (worker/src/dlMeta.ts): the rank bands, the filters deadlock-api takes, when the patch started,
 * and the snapshot the Worker keeps.
 */
import type { Patch } from './patches';

/** Rank bands, by the match's average badge (tier × 10 + subrank 1–6: Initiate 1x … Eternus 11x). */
export interface RankBand { id: string; label: string; min?: number; max?: number }
export const RANKS: RankBand[] = [
  { id: 'all', label: 'All ranks' },
  { id: 'low', label: 'Initiate – Arcanist', max: 46 },
  { id: 'mid', label: 'Ritualist – Emissary', min: 51, max: 66 },
  { id: 'high', label: 'Archon – Oracle', min: 71, max: 86 },
  { id: 'top', label: 'Phantom – Ascendant', min: 91, max: 106 },
  { id: 'eternus', label: 'Eternus', min: 111 },
];
export const rankOf = (id: string) => RANKS.find(r => r.id === id) ?? RANKS[0];
export const filters = (since: number, band: RankBand) => `min_unix_timestamp=${since}${band.min !== undefined ? `&min_average_badge=${band.min}` : ''}${band.max !== undefined ? `&max_average_badge=${band.max}` : ''}`;

/**
 * The current patch's start, the previous one's (for "since last patch"), and the update itself: the newest gameplay
 * update in the notes or deadlock-api's last "big day", whichever is later (the big days are kept by hand and can lag).
 */
export function patchWindowFrom(days: string[], notes: Patch[]): { since: number; before: number; patch: Patch | null } {
  const bigDays = days.map(d => Math.floor(Date.parse(d) / 1000)).filter(Number.isFinite).sort((a, b) => b - a);
  const starts = [...new Set([...bigDays, ...notes.map(p => p.at)])].sort((a, b) => b - a);
  const since = starts[0] ?? Math.floor(Date.now() / 1000) - 14 * 86400;
  // the one before (at least a day earlier: the forum and Steam posts of one update come hours apart)
  const before = starts.find(t => t < since - 86400) ?? since - 14 * 86400;
  return { since, before, patch: notes.find(p => Math.abs(p.at - since) < 86400) ?? null };
}

/** deadlock-api's hero stats and ban stats rows, as the meta reads them. */
export type HeroRow = { hero_id: number; wins: number; matches: number; total_kills: number; total_deaths: number; total_assists: number; total_net_worth: number };
export type BanRow = { hero_id: number; bans: number; matches: number };
/** What the Worker keeps (GET /dl/meta): the gameplay updates, the patch window, and each band's heroes on this patch
 * and the one before. */
export interface MetaSnapshot {
  at: number; patches: Patch[]; since: number; before: number;
  bands: Record<string, { heroes: HeroRow[]; bans: BanRow[]; prev: HeroRow[] }>;
}

/**
 * Deadlock's meta for everyone, read every 3 hours (wrangler.toml [triggers]): the patch notes, when the current patch
 * started, and each rank band's heroes on this patch and the one before. The site reads it at GET /dl/meta (one request,
 * the same early meta for everyone right after a patch) and falls back on asking deadlock-api itself.
 */
import { parsePatches, type RawPatch } from '../../src/deadlock/patches';
import { filters, patchWindowFrom, RANKS, type BanRow, type HeroRow, type MetaSnapshot } from '../../src/deadlock/metaCore';

const API = 'https://api.deadlock-api.com';
export const META_KEY = 'dlmeta';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(API + url, { headers: { 'User-Agent': 'RageView (tsakhstvo.xyz)' } });
  if (!res.ok) throw new Error(`deadlock-api ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

// only what the meta reads (deadlock-api's rows carry many more numbers)
const hero = (h: HeroRow): HeroRow => ({ hero_id: h.hero_id, wins: h.wins, matches: h.matches, total_kills: h.total_kills, total_deaths: h.total_deaths, total_assists: h.total_assists, total_net_worth: h.total_net_worth });
const ban = (b: BanRow): BanRow => ({ hero_id: b.hero_id, bans: b.bans, matches: b.matches });

/** Reads it all and keeps it (one KV value). A failed band keeps that band's last copy. */
export async function refreshDlMeta(kv: KVNamespace): Promise<MetaSnapshot> {
  const old = await kv.get<MetaSnapshot>(META_KEY, 'json');
  const notes = parsePatches(await get<RawPatch[]>('/v2/patches')).filter(p => p.gameplay);
  const days = await get<string[]>('/v1/patches/big-days').catch(() => [] as string[]);
  const { since, before } = patchWindowFrom(days, notes);
  const bands: MetaSnapshot['bands'] = {};
  for (const band of RANKS) {
    const f = filters(since, band);
    try {
      const [heroes, bans, prev] = await Promise.all([
        get<HeroRow[]>(`/v1/analytics/hero-stats?${f}`),
        get<BanRow[]>(`/v1/analytics/hero-ban-stats?${f}`).catch(() => [] as BanRow[]),
        get<HeroRow[]>(`/v1/analytics/hero-stats?${filters(before, band)}&max_unix_timestamp=${since}`).catch(() => [] as HeroRow[]),
      ]);
      bands[band.id] = { heroes: heroes.map(hero), bans: bans.map(ban), prev: prev.map(hero) };
    } catch {
      if (old?.since === since && old.bands[band.id]) bands[band.id] = old.bands[band.id];
    }
  }
  // the last few gameplay updates are all the site shows
  const snap: MetaSnapshot = { at: Date.now(), patches: notes.slice(0, 6), since, before, bands };
  await kv.put(META_KEY, JSON.stringify(snap));
  return snap;
}

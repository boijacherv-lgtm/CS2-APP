import { useEffect, useState } from 'react';
import { STEAM_AVAILABLE } from '../env';
import { steamFetch } from './steamApi';

/**
 * Steam avatars for the players in a demo (their ids are SteamIDs), from the dev server or the Worker (/profiles).
 * Kept in memory and in this browser for a day; players without a SteamID (bots) or a lookup that fails get none.
 */
const KEY = 'stratboard.avatars';
const DAY = 86400e3;
type Entry = { avatar: string | null; at: number };
let cache: Record<string, Entry> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } })();
const pending = new Map<string, Promise<void>>();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ } };
const fresh = (id: string) => cache[id] && Date.now() - cache[id].at < DAY;

async function load(ids: string[]) {
  const key = ids.join(',');
  if (!pending.has(key)) pending.set(key, (async () => {
    try {
      const res = await steamFetch(`/profiles?ids=${key}`);
      if (!res.ok) return;
      const { profiles } = await res.json() as { profiles: Record<string, { avatar: string | null }> };
      const at = Date.now();
      for (const id of ids) cache[id] = { avatar: profiles?.[id]?.avatar ?? null, at };
      cache = Object.fromEntries(Object.entries(cache).filter(([, e]) => at - e.at < DAY));
      save();
    } catch { /* offline: no avatars */ } finally { pending.delete(key); }
  })());
  return pending.get(key);
}

/** id → avatar URL for those that have one. */
export function useAvatars(ids: string[]): Record<string, string> {
  const wanted = ids.filter(id => /^7656\d{13}$/.test(id)).sort();
  const key = wanted.join(',');
  const [, bump] = useState(0);
  useEffect(() => {
    if (!STEAM_AVAILABLE) return;
    const missing = wanted.filter(id => !fresh(id));
    if (!missing.length) return;
    let live = true;
    load(missing.slice(0, 20)).then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const out: Record<string, string> = {};
  for (const id of wanted) if (cache[id]?.avatar) out[id] = cache[id].avatar!;
  return out;
}

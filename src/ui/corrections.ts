import { useSyncExternalStore } from 'react';
import { STEAM_AVAILABLE } from '../env';
import type { CorrectionTable } from '../engine/corrections';
import { steamFetch } from './steamApi';

/**
 * The coach's corrections from checked disputes (engine/corrections.ts), fetched from the Worker once a page load and
 * kept in this browser for the next one (so a demo opened offline is marked the same way).
 */
const KEY = 'stratboard.corrections';
let table: CorrectionTable | null = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } })();
const subs = new Set<() => void>();
let loading: Promise<void> | null = null;

export function loadCorrections() {
  if (!STEAM_AVAILABLE) return Promise.resolve();
  loading ??= (async () => {
    try {
      const res = await steamFetch('/corrections');
      if (!res.ok) return;
      const next = ((await res.json()) as { table?: CorrectionTable }).table ?? {};
      if (JSON.stringify(next) === JSON.stringify(table)) return;
      table = next;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
      subs.forEach(f => f());
    } catch { /* offline: last page load's */ }
  })();
  return loading;
}
export const currentCorrections = () => table;
export function useCorrections(): CorrectionTable | null {
  return useSyncExternalStore(f => { subs.add(f); void loadCorrections(); return () => subs.delete(f); }, () => table);
}

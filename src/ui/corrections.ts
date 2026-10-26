import { useSyncExternalStore } from 'react';
import { STEAM_AVAILABLE } from '../env';
import type { CorrectionTable } from '../engine/corrections';
import { steamFetch } from './steamApi';

/** What the checked disputes change: marks per kind of move, and marks removed by hand (one moment each). */
export interface Corrections { table: CorrectionTable; removed: string[] }

/**
 * The coach's corrections from checked disputes (engine/corrections.ts), fetched from the Worker once a page load and
 * kept in this browser for the next one (so a demo opened offline is marked the same way).
 */
const KEY = 'stratboard.corrections';
let current: Corrections | null = (() => {
  try { const c = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return c && c.table ? c : null; } catch { return null; }
})();
const subs = new Set<() => void>();
let loading: Promise<void> | null = null;

export function loadCorrections() {
  if (!STEAM_AVAILABLE) return Promise.resolve();
  loading ??= (async () => {
    try {
      const res = await steamFetch('/corrections');
      if (!res.ok) return;
      const out = (await res.json()) as { table?: CorrectionTable; removed?: string[] };
      const next: Corrections = { table: out.table ?? {}, removed: out.removed ?? [] };
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      current = next;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
      subs.forEach(f => f());
    } catch { /* offline: last page load's */ }
  })();
  return loading;
}
export const currentCorrections = () => current;
/** A mark you just removed or restored shows right away (the next page load gets it from the Worker). */
export function setRemoved(key: string, on: boolean) {
  const removed = (current?.removed ?? []).filter(k => k !== key);
  current = { table: current?.table ?? {}, removed: on ? [...removed, key] : removed };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
  subs.forEach(f => f());
}
export function useCorrections(): Corrections | null {
  return useSyncExternalStore(f => { subs.add(f); void loadCorrections(); return () => subs.delete(f); }, () => current);
}

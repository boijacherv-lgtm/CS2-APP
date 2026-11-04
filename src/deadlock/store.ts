import { create } from 'zustand';
import type { DlMatch } from './match';
import type { Benchmarks } from './coach';
import type { DlDemo } from './demo';

/** Deadlock Review's state (separate from CS2's store): the open match, the clock and playback. */
interface DlState {
  match: DlMatch | null;
  /** Steam names by account (SteamID3). */
  names: Record<number, { name: string; avatar: string | null }>;
  time: number;
  playing: boolean;
  speed: number;
  /** The danger layer: where high-rank players die at this stage (deathMap.ts). */
  danger: boolean;
  /** The hero followed / looked at (player slot). */
  selected: number | null;
  /** The average player on each hero in this match (for the laning grade); empty until loaded. */
  bench: Benchmarks;
  /** Whose moves the coach shows: everyone's, or only yours (when you're in the match). */
  scope: 'all' | 'mine';
  /** The match's demo, once deadlock-api has read it (null until then), and how that's going. */
  demo: DlDemo | null;
  /** Reading the demo: deadlock-api's estimated wait (s), or how far into the replay file on this PC (0–1). */
  demoStatus: { state: 'reading' | 'done' | 'failed'; wait?: number | null; local?: number; error?: string } | null;
  open(match: DlMatch): void;
  close(): void;
  setTime(t: number): void;
  setPlaying(on: boolean): void;
  setSpeed(x: number): void;
  toggleDanger(): void;
  select(slot: number | null): void;
  setScope(s: 'all' | 'mine'): void;
}

export const useDl = create<DlState>(set => ({
  match: null, names: {}, time: 0, playing: false, speed: 1, danger: (() => { try { return localStorage.getItem('stratboard.dl.danger') === '1'; } catch { return false; } })(), selected: null, bench: {}, scope: 'mine', demo: null, demoStatus: null,
  open: match => set({ match, time: 0, playing: false, selected: null, names: {}, bench: {}, demo: null, demoStatus: null }),
  close: () => set({ match: null, time: 0, playing: false, selected: null, demo: null, demoStatus: null }),
  setTime: time => set(s => ({ time: Math.max(0, Math.min(s.match?.duration ?? 0, time)) })),
  setPlaying: playing => set({ playing }),
  setSpeed: speed => set({ speed }),
  toggleDanger: () => set(s => { try { localStorage.setItem('stratboard.dl.danger', s.danger ? '0' : '1'); } catch { /* private mode */ } return { danger: !s.danger }; }),
  select: selected => set({ selected }),
  setScope: scope => set({ scope }),
}));

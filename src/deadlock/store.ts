import { create } from 'zustand';
import type { DlMatch } from './match';

/** Deadlock Review's state (separate from CS2's store): the open match, the clock and playback. */
interface DlState {
  match: DlMatch | null;
  /** Steam names by account (SteamID3). */
  names: Record<number, { name: string; avatar: string | null }>;
  time: number;
  playing: boolean;
  speed: number;
  /** The hero followed / looked at (player slot). */
  selected: number | null;
  open(match: DlMatch): void;
  close(): void;
  setTime(t: number): void;
  setPlaying(on: boolean): void;
  setSpeed(x: number): void;
  select(slot: number | null): void;
}

export const useDl = create<DlState>(set => ({
  match: null, names: {}, time: 0, playing: false, speed: 8, selected: null,
  open: match => set({ match, time: 0, playing: false, selected: null, names: {} }),
  close: () => set({ match: null, time: 0, playing: false, selected: null }),
  setTime: time => set(s => ({ time: Math.max(0, Math.min(s.match?.duration ?? 0, time)) })),
  setPlaying: playing => set({ playing }),
  setSpeed: speed => set({ speed }),
  select: selected => set({ selected }),
}));

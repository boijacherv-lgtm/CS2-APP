import { create } from 'zustand';
import type { D2Match } from './match';
import type { ReplayTracks } from './replay/parser';
import { loadTracks, type TrackProgress } from './tracks';

/** The replay behind the open match: where heroes really walked. */
export type TrackState = { status: 'idle' } | ({ status: 'loading' } & Partial<TrackProgress>) | { status: 'ready'; tracks: ReplayTracks } | { status: 'failed'; error: string };

/** Dota 2 Review's state (separate from the other games'): the open match, the clock and playback. */
interface D2State {
  match: D2Match | null;
  replay: TrackState;
  time: number;
  playing: boolean;
  speed: number;
  /** The hero looked at (player slot). */
  selected: number | null;
  /** Whose moves the coach shows: everyone's, or only yours (when you're in the match). */
  scope: 'all' | 'mine';
  open(match: D2Match): void;
  close(): void;
  setTime(t: number): void;
  setPlaying(on: boolean): void;
  setSpeed(x: number): void;
  select(slot: number | null): void;
  setScope(s: 'all' | 'mine'): void;
}

let stopLoading = () => {};

export const useD2 = create<D2State>((set, get) => ({
  match: null, replay: { status: 'idle' }, time: 0, playing: false, speed: 8, selected: null, scope: 'mine',
  open: match => {
    stopLoading();
    set({ match, replay: { status: 'loading' }, time: match.start, playing: false, selected: null });
    const job = loadTracks(match.id, match.replayUrl, p => { if (get().match === match) set({ replay: { status: 'loading', ...p } }); });
    stopLoading = job.stop;
    job.done.then(
      tracks => { if (get().match === match) set({ replay: { status: 'ready', tracks } }); },
      e => { if (get().match === match) set({ replay: { status: 'failed', error: e instanceof Error ? e.message : String(e) } }); },
    );
  },
  close: () => { stopLoading(); set({ match: null, replay: { status: 'idle' }, time: 0, playing: false, selected: null }); },
  setTime: time => set(s => ({ time: Math.max(s.match?.start ?? 0, Math.min(s.match?.duration ?? 0, time)) })),
  setPlaying: playing => set({ playing }),
  setSpeed: speed => set({ speed }),
  select: selected => set({ selected }),
  setScope: scope => set({ scope }),
}));

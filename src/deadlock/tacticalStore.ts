import { create } from 'zustand';
import type { DlTeam } from './data';

/**
 * Deadlock Tactical (deadlock/tactical/): the macro plan, the teamfight frames and the two builds. Kept in this browser,
 * so a plan is still there next time.
 */
export interface TacHero { id: string; team: DlTeam; hero: number }
export type Pt = { x: number; y: number };
/** Where a hero should be at a moment of the match (macro plan); in between they move in a straight line. */
export interface Key { t: number; at: Pt }
export interface Note { t: number; text: string }
export interface Frame { pos: Record<string, Pt>; focus: { from: string; to: string }[] }
export interface BuildRow { hero: number; items: number[] }

interface TacState {
  heroes: TacHero[];
  // macro
  keys: Record<string, Key[]>;
  notes: Note[];
  time: number;
  playing: boolean;
  // teamfight
  frames: Frame[];
  frame: number;
  /** Ability range rings (game units), per hero. */
  ranges: Record<string, number>;
  // builds
  builds: Record<DlTeam, BuildRow[]>;
  selected: string | null;

  addHero(team: DlTeam, hero: number, at: Pt): void;
  setHero(id: string, hero: number): void;
  removeHero(id: string): void;
  setKey(id: string, t: number, at: Pt): void;
  clearKeys(id: string): void;
  addNote(n: Note): void;
  removeNote(i: number): void;
  setTime(t: number): void;
  setPlaying(on: boolean): void;
  setFramePos(id: string, at: Pt): void;
  addFrame(): void;
  removeFrame(i: number): void;
  setFrame(i: number): void;
  toggleFocus(from: string, to: string): void;
  setRange(id: string, r: number): void;
  setBuild(team: DlTeam, rows: BuildRow[]): void;
  select(id: string | null): void;
  reset(): void;
}

const KEY = 'stratboard.dl.tactical';
type Saved = Pick<TacState, 'heroes' | 'keys' | 'notes' | 'frames' | 'ranges' | 'builds'>;
const EMPTY: Saved = { heroes: [], keys: {}, notes: [], frames: [{ pos: {}, focus: [] }], ranges: {}, builds: { 0: [], 1: [] } };
const load = (): Saved => { try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return EMPTY; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };
let n = 0;
const newId = () => `h${Date.now().toString(36)}${(n++).toString(36)}`;

export const MATCH_LENGTH = 40 * 60;

export const useTac = create<TacState>((set, get) => {
  const commit = (patch: Partial<TacState>) => {
    set(patch);
    const s = get();
    save({ heroes: s.heroes, keys: s.keys, notes: s.notes, frames: s.frames, ranges: s.ranges, builds: s.builds });
  };
  return {
    ...load(), time: 0, playing: false, frame: 0, selected: null,
    addHero: (team, hero, at) => {
      const id = newId();
      const s = get();
      commit({ heroes: [...s.heroes, { id, team, hero }], keys: { ...s.keys, [id]: [{ t: 0, at }] },
        frames: s.frames.map(f => ({ ...f, pos: { ...f.pos, [id]: at } })), selected: id });
    },
    setHero: (id, hero) => commit({ heroes: get().heroes.map(h => (h.id === id ? { ...h, hero } : h)) }),
    removeHero: id => {
      const s = get();
      const { [id]: _k, ...keys } = s.keys;
      commit({ heroes: s.heroes.filter(h => h.id !== id), keys,
        frames: s.frames.map(f => { const { [id]: _p, ...pos } = f.pos; return { pos, focus: f.focus.filter(x => x.from !== id && x.to !== id) }; }),
        selected: s.selected === id ? null : s.selected });
    },
    setKey: (id, t, at) => {
      const ks = (get().keys[id] ?? []).filter(k => Math.abs(k.t - t) >= 1);
      commit({ keys: { ...get().keys, [id]: [...ks, { t: Math.round(t), at }].sort((a, b) => a.t - b.t) } });
    },
    clearKeys: id => { const first = get().keys[id]?.[0]; commit({ keys: { ...get().keys, [id]: first ? [{ ...first, t: 0 }] : [] } }); },
    addNote: note => commit({ notes: [...get().notes, note].sort((a, b) => a.t - b.t) }),
    removeNote: i => commit({ notes: get().notes.filter((_, j) => j !== i) }),
    setTime: t => set({ time: Math.max(0, Math.min(MATCH_LENGTH, t)) }),
    setPlaying: playing => set({ playing }),
    setFramePos: (id, at) => { const s = get(); commit({ frames: s.frames.map((f, i) => (i === s.frame ? { ...f, pos: { ...f.pos, [id]: at } } : f)) }); },
    addFrame: () => { const s = get(); const cur = s.frames[s.frame]; commit({ frames: [...s.frames, { pos: { ...cur.pos }, focus: [] }], frame: s.frames.length }); },
    removeFrame: i => { const s = get(); if (s.frames.length <= 1) return; commit({ frames: s.frames.filter((_, j) => j !== i), frame: Math.max(0, Math.min(s.frame, s.frames.length - 2)) }); },
    setFrame: frame => set({ frame }),
    toggleFocus: (from, to) => {
      const s = get();
      commit({ frames: s.frames.map((f, i) => i !== s.frame ? f : {
        ...f, focus: f.focus.some(x => x.from === from && x.to === to) ? f.focus.filter(x => !(x.from === from && x.to === to)) : [...f.focus.filter(x => x.from !== from), { from, to }],
      }) });
    },
    setRange: (id, r) => commit({ ranges: { ...get().ranges, [id]: r } }),
    setBuild: (team, rows) => commit({ builds: { ...get().builds, [team]: rows } }),
    select: selected => set({ selected }),
    reset: () => { commit({ ...EMPTY }); set({ time: 0, frame: 0, selected: null, playing: false }); },
  };
});

/** Where a hero is at time t in the macro plan (between its key points). */
export function keyAt(keys: Key[] | undefined, t: number): Pt | null {
  if (!keys?.length) return null;
  if (t <= keys[0].t) return keys[0].at;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i], f = (t - a.t) / (b.t - a.t || 1);
      return { x: a.at.x + (b.at.x - a.at.x) * f, y: a.at.y + (b.at.y - a.at.y) * f };
    }
  }
  return keys[keys.length - 1].at;
}

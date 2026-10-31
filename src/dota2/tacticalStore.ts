import { create } from 'zustand';
import { keyAt, type Frame, type Key, type Note } from '../deadlock/tacticalStore';
import type { D2Team, Pt } from './data';

export { keyAt };

/** Dota 2 Tactical: the macro plan with wards, and the teamfight frames. Kept in this browser, so a plan is still there next time. */
export interface TacHero { id: string; team: D2Team; hero: number }
export interface PlanWard { t: number; at: Pt; kind: 'obs' | 'sen'; team: D2Team }

interface TacState {
  heroes: TacHero[];
  keys: Record<string, Key[]>;
  notes: Note[];
  wards: PlanWard[];
  time: number;
  playing: boolean;
  frames: Frame[];
  frame: number;
  /** Ability range rings (game units), per hero. */
  ranges: Record<string, number>;
  selected: string | null;

  addHero(team: D2Team, hero: number, at: Pt): void;
  /** Starts a plan from a real moment of a match: these heroes where they stood, at that time. */
  loadMoment(t: number, heroes: { team: D2Team; hero: number; at: Pt }[]): void;
  setHero(id: string, hero: number): void;
  removeHero(id: string): void;
  setKey(id: string, t: number, at: Pt): void;
  clearKeys(id: string): void;
  addNote(n: Note): void;
  removeNote(i: number): void;
  addWard(w: PlanWard): void;
  removeWard(w: PlanWard): void;
  setTime(t: number): void;
  setPlaying(on: boolean): void;
  setFramePos(id: string, at: Pt): void;
  addFrame(): void;
  removeFrame(i: number): void;
  setFrame(i: number): void;
  toggleFocus(from: string, to: string): void;
  setRange(id: string, r: number): void;
  select(id: string | null): void;
  reset(): void;
}

const KEY = 'stratboard.d2.tactical';
type Saved = Pick<TacState, 'heroes' | 'keys' | 'notes' | 'wards' | 'frames' | 'ranges'>;
const EMPTY: Saved = { heroes: [], keys: {}, notes: [], wards: [], frames: [{ pos: {}, focus: [] }], ranges: {} };
const load = (): Saved => { try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return EMPTY; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };
let n = 0;
const newId = () => `h${Date.now().toString(36)}${(n++).toString(36)}`;

export const MATCH_LENGTH = 50 * 60;
/** How long a planned ward stays on the map. */
export const WARD_LIFE = { obs: 360, sen: 420 };

export const useTac = create<TacState>((set, get) => {
  const commit = (patch: Partial<TacState>) => {
    set(patch);
    const s = get();
    save({ heroes: s.heroes, keys: s.keys, notes: s.notes, wards: s.wards, frames: s.frames, ranges: s.ranges });
  };
  return {
    ...load(), time: 0, playing: false, frame: 0, selected: null,
    addHero: (team, hero, at) => {
      const id = newId();
      const s = get();
      commit({ heroes: [...s.heroes, { id, team, hero }], keys: { ...s.keys, [id]: [{ t: 0, at }] },
        frames: s.frames.map(f => ({ ...f, pos: { ...f.pos, [id]: at } })), selected: id });
    },
    loadMoment: (t, list) => {
      const heroes = list.map(h => ({ id: newId(), team: h.team, hero: h.hero }));
      const keys = Object.fromEntries(heroes.map((h, i) => [h.id, [{ t: Math.max(0, Math.round(t)), at: list[i].at }]]));
      const pos = Object.fromEntries(heroes.map((h, i) => [h.id, list[i].at]));
      commit({ ...EMPTY, heroes, keys, frames: [{ pos, focus: [] }], frame: 0, time: Math.max(0, Math.min(MATCH_LENGTH, t)), selected: null, playing: false });
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
    addWard: w => commit({ wards: [...get().wards, w] }),
    removeWard: w => commit({ wards: get().wards.filter(x => x !== w) }),
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
    select: selected => set({ selected }),
    reset: () => { commit({ ...EMPTY }); set({ time: 0, frame: 0, selected: null, playing: false }); },
  };
});

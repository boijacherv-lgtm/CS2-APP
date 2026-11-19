import { create } from 'zustand';
import type { DlTeam } from './data';

/**
 * Deadlock Tactical's planners (deadlock/tactical/ → Planner): the macro plan and the two builds. Kept in this browser,
 * so a plan is still there next time.
 */
export interface TacHero { id: string; team: DlTeam; hero: number }
export type Pt = { x: number; y: number };
/** Where a hero should be at a moment of the match (macro plan); in between they move in a straight line. */
export interface Key { t: number; at: Pt }
export interface Note { t: number; text: string }
export interface BuildRow { hero: number; items: number[] }

interface TacState {
  heroes: TacHero[];
  // macro
  keys: Record<string, Key[]>;
  notes: Note[];
  time: number;
  playing: boolean;
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
  setBuild(team: DlTeam, rows: BuildRow[]): void;
  select(id: string | null): void;
  reset(): void;
}

const KEY = 'stratboard.dl.tactical';
type Saved = Pick<TacState, 'heroes' | 'keys' | 'notes' | 'builds'>;
const EMPTY: Saved = { heroes: [], keys: {}, notes: [], builds: { 0: [], 1: [] } };
const load = (): Saved => { try { const v = { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; return { heroes: v.heroes, keys: v.keys, notes: v.notes, builds: v.builds }; } catch { return EMPTY; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };
let n = 0;
const newId = () => `h${Date.now().toString(36)}${(n++).toString(36)}`;

export const MATCH_LENGTH = 40 * 60;

export const useTac = create<TacState>((set, get) => {
  const commit = (patch: Partial<TacState>) => {
    set(patch);
    const s = get();
    save({ heroes: s.heroes, keys: s.keys, notes: s.notes, builds: s.builds });
  };
  return {
    ...load(), time: 0, playing: false, selected: null,
    addHero: (team, hero, at) => {
      const id = newId();
      const s = get();
      commit({ heroes: [...s.heroes, { id, team, hero }], keys: { ...s.keys, [id]: [{ t: 0, at }] }, selected: id });
    },
    setHero: (id, hero) => commit({ heroes: get().heroes.map(h => (h.id === id ? { ...h, hero } : h)) }),
    removeHero: id => {
      const s = get();
      const { [id]: _k, ...keys } = s.keys;
      commit({ heroes: s.heroes.filter(h => h.id !== id), keys, selected: s.selected === id ? null : s.selected });
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
    setBuild: (team, rows) => commit({ builds: { ...get().builds, [team]: rows } }),
    select: selected => set({ selected }),
    reset: () => { commit({ ...EMPTY }); set({ time: 0, selected: null, playing: false }); },
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

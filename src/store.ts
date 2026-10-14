import { create } from 'zustand';
import { UTIL_FLIGHT } from './engine/grid';
import type { DemoData } from './engine/recap';
import { presetsFor, tPlaysFor } from './map/catalog';
import { loadCustomLineups, saveCustomLineups, type Lineup } from './map/lineups';
import type { BoardState, Player, RoundContext, Route, Side, UtilType, Utility, Vec2, Weapon } from './engine/types';

export type Tool = 'select' | 'ct' | 't' | 'smoke' | 'flash' | 'molotov' | 'he' | 'path' | 'lineup' | 'erase';
export type Overlay = 'control' | 'killmap' | 'lineups' | 'los' | 'threat' | 'timing' | 'walkable' | 'callouts';
export type KillMetric = 'pKill' | 'expKills' | 'survive';

interface Store {
  mapId: string;
  level: number;
  /** Boards for maps you switched away from, restored when you come back. */
  saved: Record<string, BoardState>;
  board: BoardState;
  past: BoardState[];
  future: BoardState[];
  tool: Tool;
  selectedId: string | null;
  overlays: Record<Overlay, boolean>;
  time: number;
  /** Route being drawn: the player it belongs to and the waypoints clicked so far. */
  draftRoute: { playerId: string; pts: Vec2[] } | null;
  playing: boolean;
  speed: number;
  /** Players fight and die during the timeline. */
  combat: boolean;
  /** Seed for fight outcomes; re-roll to see another way the round can go. */
  seed: number;
  /** Route tool: one click on the map = destination (Shift+click adds waypoints instead). */
  autoRoute: boolean;
  killMetric: KillMetric;
  /** Line-up being drawn with the Line-up tool: throw spot, then landing spot. */
  draftLineup: { from?: Vec2; to?: Vec2 } | null;
  customLineups: Lineup[];
  /** Demo review: parsed demo, round shown, and the board to restore afterwards. */
  review: { data: DemoData; round: number; prevBoard: BoardState; prevMap: string } | null;
  /** Short message shown over the board (e.g. why an action did nothing). */
  notice: string | null;

  setTool(t: Tool): void;
  select(id: string | null): void;
  toggleOverlay(o: Overlay): void;
  setTime(t: number): void;
  setContext(c: Partial<RoundContext>): void;
  addPlayer(side: Side, pos: Vec2): void;
  addUtility(type: UtilType, pos: Vec2): void;
  move(id: string, pos: Vec2): void;
  updatePlayer(id: string, patch: Partial<Pick<Player, 'weapon' | 'facing'>>): void;
  updateUtility(id: string, patch: Partial<Pick<Utility, 'throwAt'>>): void;
  remove(id: string): void;
  startRoute(playerId: string): void;
  routePoint(p: Vec2): void;
  finishRoute(): void;
  cancelRoute(): void;
  updateRoute(playerId: string, patch: Partial<Route> | null): void;
  setPlaying(on: boolean): void;
  setCombat(on: boolean): void;
  reroll(): void;
  setAutoRoute(on: boolean): void;
  setKillMetric(m: KillMetric): void;
  lineupPoint(p: Vec2): void;
  saveLineup(l: Omit<Lineup, 'id' | 'map' | 'level' | 'custom'>): void;
  deleteLineup(id: string): void;
  /** Put a line-up's grenade on the board, released at `throwAt`. */
  useLineup(l: Lineup, throwAt: number, flight: number): void;
  startReview(data: DemoData): void;
  setReviewRound(n: number): void;
  exitReview(): void;
  /** Auto-route a player to a destination (replaces their route, keeps leave time/mode). */
  routeTo(playerId: string, p: Vec2): void;
  setSpeed(x: number): void;
  loadPreset(name: string): void;
  /** Replace the T side with a scripted T play (CTs stay). */
  loadTPlay(name: string | null): void;
  setMap(id: string): void;
  setLevel(level: number): void;
  undo(): void;
  redo(): void;
}

const uid = () => Math.random().toString(36).slice(2, 9);

const ctx: RoundContext = { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } };

const P = (side: Side, x: number, y: number, weapon: Weapon = 'rifle'): Player =>
  ({ id: uid(), side, pos: { x, y }, weapon, label: '' });

function relabel(players: Player[]) {
  const n = { T: 0, CT: 0 };
  return players.map(p => ({ ...p, label: String(++n[p.side]) }));
}

const DEFAULT_MAP = 'de_mirage';

const freshBoard = (mapId: string, level = 0): BoardState => {
  const presets = presetsFor(mapId, level);
  const names = Object.keys(presets);
  const first = names.find(n => n.startsWith('Stack A')) ?? names.find(n => n !== 'Empty') ?? 'Empty';
  return { players: relabel(presets[first]()), utility: [], context: ctx };
};

export const useStore = create<Store>((set, get) => {
  /** Apply an undoable board change. */
  const commit = (fn: (b: BoardState) => BoardState) =>
    set(s => ({ past: [...s.past.slice(-50), s.board], future: [], board: fn(s.board) }));

  return {
    mapId: DEFAULT_MAP,
    level: 0,
    saved: {},
    board: freshBoard(DEFAULT_MAP),
    past: [],
    future: [],
    tool: 'select',
    selectedId: null,
    overlays: { control: true, killmap: false, lineups: false, los: true, threat: true, timing: false, walkable: false, callouts: true },
    time: 10,
    draftRoute: null,
    playing: false,
    speed: 1,
    combat: true,
    seed: 1,
    autoRoute: true,
    killMetric: 'pKill',
    draftLineup: null,
    customLineups: loadCustomLineups(),
    review: null,
    notice: null,

    setTool: tool => {
      if (tool !== 'lineup') set({ draftLineup: null });
      // Switching to Route with a player selected starts that player's route right away.
      const sel = get().board.players.find(p => p.id === get().selectedId);
      set({ tool, draftRoute: tool === 'path' && sel ? { playerId: sel.id, pts: [] } : null });
    },
    select: selectedId => set({ selectedId }),
    toggleOverlay: o =>
      set(s => {
        const on = !s.overlays[o];
        const other = o === 'control' ? { killmap: false } : o === 'killmap' ? { control: false } : {};
        return { overlays: { ...s.overlays, [o]: on, ...(on ? other : {}) } };
      }),
    setTime: time => set({ time }),
    setContext: c => commit(b => ({ ...b, context: { ...b.context, ...c, economy: { ...b.context.economy, ...c.economy } } })),

    addPlayer: (side, pos) => {
      if (get().board.players.filter(p => p.side === side).length >= 5) {
        set({ notice: `Already 5 ${side} players. Erase one first, or use "Clear board".` });
        return;
      }
      const p = P(side, pos.x, pos.y);
      commit(b => ({ ...b, players: relabel([...b.players, p]) }));
      set({ selectedId: p.id });
    },
    addUtility: (type, pos) =>
      // Thrown so it is already bloomed at the current slider time.
      commit(b => ({ ...b, utility: [...b.utility, { id: uid(), type, pos, throwAt: Math.max(0, get().time - UTIL_FLIGHT) }] })),
    move: (id, pos) =>
      commit(b => ({
        ...b,
        players: b.players.map(p => (p.id === id ? { ...p, pos } : p)),
        utility: b.utility.map(u => (u.id === id ? { ...u, pos } : u)),
      })),
    updatePlayer: (id, patch) => commit(b => ({ ...b, players: b.players.map(p => (p.id === id ? { ...p, ...patch } : p)) })),
    updateUtility: (id, patch) => commit(b => ({ ...b, utility: b.utility.map(u => (u.id === id ? { ...u, ...patch } : u)) })),
    remove: id => {
      // "route:<playerId>" removes just that player's route
      const routeOf = id.startsWith('route:') ? id.slice(6) : null;
      commit(b => ({
        ...b,
        players: routeOf
          ? b.players.map(p => (p.id === routeOf ? { ...p, route: undefined } : p))
          : relabel(b.players.filter(p => p.id !== id)),
        utility: b.utility.filter(u => u.id !== id),
      }));
      if (get().selectedId === id) set({ selectedId: null });
    },
    startRoute: playerId => {
      // Picking another player while drawing: keep what was drawn, then switch.
      const d = get().draftRoute;
      if (d && d.playerId !== playerId && d.pts.length) get().finishRoute();
      set({ draftRoute: { playerId, pts: [] }, selectedId: playerId });
    },
    routePoint: p => set(s => (s.draftRoute ? { draftRoute: { ...s.draftRoute, pts: [...s.draftRoute.pts, p] } } : s)),
    finishRoute: () => {
      const d = get().draftRoute;
      set({ draftRoute: null });
      // double-click also lands two clicks: drop repeated points
      const pts = d?.pts.filter((q, i, a) => i === 0 || Math.hypot(q.x - a[i - 1].x, q.y - a[i - 1].y) > 3) ?? [];
      if (!d || !pts.length) return;
      const start = get().board.players.find(p => p.id === d.playerId)?.route?.start ?? 0;
      commit(b => ({ ...b, players: b.players.map(p => (p.id === d.playerId ? { ...p, route: { pts, start, mode: p.route?.mode ?? 'run' } } : p)) }));
    },
    cancelRoute: () => set({ draftRoute: null }),
    updateRoute: (playerId, patch) =>
      commit(b => ({
        ...b,
        players: b.players.map(p => (p.id !== playerId ? p : { ...p, route: patch === null || !p.route ? undefined : { ...p.route, ...patch } })),
      })),
    setPlaying: playing => set({ playing }),
    setCombat: combat => set({ combat }),
    reroll: () => set(s => ({ seed: s.seed + 1 })),
    setAutoRoute: autoRoute => set({ autoRoute }),
    setKillMetric: killMetric => set({ killMetric }),
    lineupPoint: p =>
      set(s => (!s.draftLineup?.from ? { draftLineup: { from: p } } : { draftLineup: { from: s.draftLineup.from, to: p } })),
    saveLineup: l => {
      const full: Lineup = { ...l, id: `custom:${uid()}`, map: get().mapId, level: get().level, custom: true };
      const list = [...get().customLineups, full];
      saveCustomLineups(list);
      set({ customLineups: list, draftLineup: null });
    },
    deleteLineup: id => {
      const list = get().customLineups.filter(l => l.id !== id);
      saveCustomLineups(list);
      set({ customLineups: list });
    },
    useLineup: (l, throwAt, flight) =>
      commit(b => ({ ...b, utility: [...b.utility, { id: uid(), type: l.type, pos: l.to, from: l.from, flight, throwAt, lineup: l.id }] })),
    startReview: data =>
      set(s => ({
        review: { data, round: 0, prevBoard: s.board, prevMap: s.mapId },
        mapId: data.map, level: 0, selectedId: null, draftRoute: null, playing: false, time: 0, past: [], future: [],
        tool: 'select',
      })),
    setReviewRound: n => set(s => (s.review ? { review: { ...s.review, round: n }, time: 0, playing: false, selectedId: null } : s)),
    exitReview: () =>
      set(s => (s.review ? { board: s.review.prevBoard, mapId: s.review.prevMap, level: 0, review: null, time: 10, playing: false, selectedId: null } : s)),
    routeTo: (playerId, p) =>
      commit(b => ({
        ...b,
        players: b.players.map(q => (q.id !== playerId ? q : { ...q, route: { pts: [p], start: q.route?.start ?? 0, mode: q.route?.mode ?? 'run' } })),
      })),
    setSpeed: speed => set({ speed }),
    loadPreset: name => {
      const preset = presetsFor(get().mapId, get().level)[name];
      if (!preset) return;
      const ts = get().board.players.filter(p => p.side === 'T');
      commit(b => ({ ...b, players: relabel([...preset(), ...ts]), utility: [] }));
      set({ selectedId: null });
    },
    loadTPlay: name => {
      const make = name ? tPlaysFor(get().mapId, get().level)[name] : () => [];
      if (!make) return;
      commit(b => ({ ...b, players: relabel([...b.players.filter(p => p.side === 'CT'), ...make()]) }));
      set({ selectedId: null, time: 0, playing: false });
    },
    // Each map level keeps its own board (e.g. Nuke A upstairs, B downstairs).
    setMap: id =>
      set(s => (id === s.mapId ? s : {
        mapId: id, level: 0, selectedId: null, draftRoute: null, playing: false, past: [], future: [],
        saved: { ...s.saved, [`${s.mapId}:${s.level}`]: s.board },
        board: s.saved[`${id}:0`] ?? { ...freshBoard(id), context: s.board.context },
      })),
    setLevel: level =>
      set(s => (level === s.level ? s : {
        level, selectedId: null, draftRoute: null, playing: false, past: [], future: [],
        saved: { ...s.saved, [`${s.mapId}:${s.level}`]: s.board },
        board: s.saved[`${s.mapId}:${level}`] ?? { ...freshBoard(s.mapId, level), context: s.board.context },
      })),
    undo: () => set(s => (s.past.length ? { board: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.board, ...s.future] } : s)),
    redo: () => set(s => (s.future.length ? { board: s.future[0], future: s.future.slice(1), past: [...s.past, s.board] } : s)),
  };
});

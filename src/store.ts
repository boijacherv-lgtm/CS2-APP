import { create } from 'zustand';
import { UTIL_FLIGHT } from './engine/grid';
import type { RoundSummary } from './engine/match';
import type { DemoData } from './engine/recap';
import { presetsFor, tPlaysFor } from './map/catalog';
import { loadCustomLineups, saveCustomLineups, type Lineup } from './map/lineups';
import type { BoardState, Player, RoundContext, Route, Side, UtilType, Utility, Vec2, Weapon } from './engine/types';

export type Tool = 'select' | 'ct' | 't' | 'smoke' | 'flash' | 'molotov' | 'he' | 'path' | 'lineup' | 'erase';
export type Overlay =
  | 'control' | 'vision' | 'killmap' | 'lineups' | 'los' | 'threat' | 'entryCards' | 'playerInfo' | 'timing' | 'walkable' | 'callouts';

/** How much the board shows. Presets only touch the "noise" layers; tool layers (best spots, line-ups, timing, debug) stay as they are. */
export type ViewName = 'clean' | 'standard' | 'full';
export const NOISE_LAYERS: Overlay[] = ['control', 'vision', 'threat', 'entryCards', 'playerInfo', 'callouts', 'los'];
const OFF: Record<Overlay, boolean> = {
  control: false, vision: false, killmap: false, lineups: false, los: false, threat: false,
  entryCards: false, playerInfo: false, timing: false, walkable: false, callouts: false,
};
export const VIEW_PRESETS: Record<ViewName, Record<Overlay, boolean>> = {
  /** Players, routes and grenades only. */
  clean: { ...OFF },
  /** Map control, entry lines, callouts, guns and kill chances; no vision cones, no entry cards. */
  standard: { ...OFF, control: true, threat: true, callouts: true, los: true, playerInfo: true },
  /** Everything the board can draw. */
  full: { ...OFF, control: true, vision: true, threat: true, entryCards: true, callouts: true, los: true, playerInfo: true },
};

/** Which preset the current layers match, or null when the user has mixed their own. */
export function activeView(o: Record<Overlay, boolean>): ViewName | null {
  for (const name of Object.keys(VIEW_PRESETS) as ViewName[]) {
    const pr = VIEW_PRESETS[name];
    // the control heat-map is switched off whenever Best spots is on, so don't count it then
    if (NOISE_LAYERS.every(l => (l === 'control' && o.killmap ? true : o[l] === pr[l]))) return name;
  }
  return null;
}

const LS_OVERLAYS = 'stratboard.overlays', LS_FOLDED = 'stratboard.folded';
function loadJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
function saveJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode etc. */ } }
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
  /** Panel sections the user opened (false) or collapsed (true); sections not listed use their own default. */
  folded: Record<string, boolean>;
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
  /** Which CS2 screen is open: planning a round, or reviewing a played match. */
  mode: 'tactical' | 'review';
  /** The loaded match (kept while you switch back to Tactical). */
  review: { data: DemoData; round: number } | null;
  /** Every round of the loaded match graded in the background (Match report page). */
  report: { data: DemoData; rounds: (RoundSummary | null)[]; done: boolean } | null;
  /** The tactical board, parked while Review mode shows a match. */
  parked: { board: BoardState; mapId: string; level: number } | null;
  /** Review shows the whole round at once instead of revealing it as time passes. */
  reviewSpoilers: boolean;
  /** Short message shown over the board (e.g. why an action did nothing). */
  notice: string | null;

  setTool(t: Tool): void;
  select(id: string | null): void;
  toggleOverlay(o: Overlay): void;
  setView(v: ViewName): void;
  toggleFold(id: string, collapsedNow: boolean): void;
  setTime(t: number): void;
  setContext(c: Partial<RoundContext>): void;
  addPlayer(side: Side, pos: Vec2): void;
  addUtility(type: UtilType, pos: Vec2): void;
  move(id: string, pos: Vec2): void;
  updatePlayer(id: string, patch: Partial<Pick<Player, 'weapon' | 'gun' | 'facing'>>): void;
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
  setMode(mode: 'tactical' | 'review'): void;
  startReview(data: DemoData): void;
  setReviewRound(n: number): void;
  /** Close the loaded match (stays in Review mode, back to the loader). */
  exitReview(): void;
  setReviewSpoilers(on: boolean): void;
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
    overlays: loadJson<Record<Overlay, boolean>>(LS_OVERLAYS, VIEW_PRESETS.standard),
    folded: loadJson<Record<string, boolean>>(LS_FOLDED, {}),
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
    mode: 'tactical',
    review: null,
    report: null,
    parked: null,
    reviewSpoilers: false,
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
        const overlays = { ...s.overlays, [o]: on, ...(on ? other : {}) };
        saveJson(LS_OVERLAYS, overlays);
        return { overlays };
      }),
    setView: v =>
      set(s => {
        const pr = VIEW_PRESETS[v];
        const overlays = { ...s.overlays };
        for (const l of NOISE_LAYERS) overlays[l] = pr[l];
        if (overlays.killmap) overlays.control = false; // Best spots replaces the heat-map
        saveJson(LS_OVERLAYS, overlays);
        return { overlays };
      }),
    toggleFold: (id, collapsedNow) =>
      set(s => {
        const folded = { ...s.folded, [id]: !collapsedNow };
        saveJson(LS_FOLDED, folded);
        return { folded };
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
    setMode: mode =>
      set(s => {
        if (mode === s.mode) return s;
        const common = { mode, selectedId: null, draftRoute: null, draftLineup: null, playing: false, past: [], future: [], tool: 'select' as Tool };
        if (mode === 'review') {
          const parked = { board: s.board, mapId: s.mapId, level: s.level };
          return { ...common, parked, time: 0, ...(s.review ? { mapId: s.review.data.map, level: 0 } : {}) };
        }
        // back to tactical: restore the board exactly as it was
        const p = s.parked;
        return { ...common, parked: null, time: 10, ...(p ? { board: p.board, mapId: p.mapId, level: p.level } : {}) };
      }),
    startReview: data =>
      set(s => ({
        mode: 'review',
        parked: s.mode === 'review' ? s.parked : { board: s.board, mapId: s.mapId, level: s.level },
        review: { data, round: 0 },
        report: null,
        mapId: data.map, level: 0, selectedId: null, draftRoute: null, playing: false, time: 0, past: [], future: [],
        tool: 'select',
      })),
    setReviewRound: n => set(s => (s.review ? { review: { ...s.review, round: n }, time: 0, playing: false, selectedId: null } : s)),
    setReviewSpoilers: reviewSpoilers => set({ reviewSpoilers }),
    exitReview: () => set({ review: null, report: null, time: 0, playing: false, selectedId: null }),
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

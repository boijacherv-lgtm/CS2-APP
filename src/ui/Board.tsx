import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Arrow, Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text, Wedge } from 'react-konva';
import type { ControlMap } from '../engine/control';
import { FOV, type Analysis, type TacticalEngine } from '../engine/predict';
import { activeSmokes, distToSegment, smokeOpenAt, SMOKE_RADIUS_UNITS } from '../engine/grid';
import { radarToWorld, worldToRadar } from '../engine/coords';
import { simStateAt, type Simulation } from '../engine/combat';
import type { BatchStats } from '../engine/batch';
import type { SpotMap } from '../engine/spots';
import { bombAt, evalAt, type Review } from '../engine/recap';
import { moveLook } from './NoteMark';
import { gunOf } from '../engine/guns';
import { NadeAtLanding, NadeFlight } from './Nades';
import { Gunfire } from './Shots';
import { KillFeed, MoveFeed } from './MoveFeed';
import { useShown } from './shown';
import { SIDE_COLOR, T as TOK, UTIL_COLOR } from './tokens';
import { MomentNav } from './Recap';
import { LayersBar } from './Layers';
import { PlaybackBar, RoundHud, ScoreBug, scoreBefore, sideSwitches } from './Playback';
import { FOV as VISION_FOV } from '../engine/predict';
import { ENTRY_COLOR, entryClock, entryReports } from '../engine/entries';
import { BUILTIN_LINEUPS } from '../map/lineups';
import { bakeRoute, liveState, type BakedRoute } from '../engine/timeline';
import type { BoardState, Player, Utility, Vec2 } from '../engine/types';
import { Icon } from './Icon';
import { useAvatars } from './avatars';
import { TeamRoster } from './Roster';
import { proSpots } from '../map/positions';
import { phaseOf } from '../engine/situations';
import { SEARCH_COLOR } from '../engine/search';
import { useStore, whoAmI } from '../store';

Konva.dragDistance = 4;

const COLORS = { ...SIDE_COLOR, bg: TOK.bg0 };
/** A #rrggbb colour mixed toward white / black by `t` (0–1). */
const mixTo = (hex: string, to: number, t: number) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + to * t).toString(16).padStart(2, '0')).join('');
const mixWhite = (hex: string, t: number) => mixTo(hex, 255, t);
const mixBlack = (hex: string, t: number) => mixTo(hex, 0, t);
const TOKEN_R = 11;
/** On-screen size of the nickname under a player in Review. */
const NAME_PX = 10;
const NAME_MAX = 14;

const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const textWidth = (text: string, fs: number) => {
  if (!measureCtx) return text.length * fs * 0.6;
  measureCtx.font = `bold ${fs}px Arial`; // Konva's default face
  return measureCtx.measureText(text).width;
};

/** A player's nickname in a small dark tag under their token, with their side's colour on the left. */
function NameTag({ name, side, fs, y, strong, dead }: { name: string; side: 'CT' | 'T'; fs: number; y: number; strong?: boolean; dead?: boolean }) {
  const text = name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
  const padX = fs * 0.45, bar = fs * 0.22, h = fs * 1.45;
  const w = textWidth(text, fs) + padX * 2 + bar;
  return (
    <Group y={y} x={-w / 2} listening={false} opacity={dead ? 0.6 : strong ? 1 : 0.88}>
      <Rect width={w} height={h} cornerRadius={h * 0.3} fill={strong ? 'rgba(0,0,0,0.95)' : 'rgba(11,14,18,0.82)'} stroke={strong ? '#fff' : undefined} strokeWidth={fs * 0.1} />
      <Rect width={bar} height={h} cornerRadius={[h * 0.3, 0, 0, h * 0.3]} fill={SIDE_COLOR[side]} />
      <Text text={text} x={bar + padX} y={(h - fs) / 2 + fs * 0.05} fontSize={fs} fontStyle="bold" fill={dead ? '#8a929e' : '#fff'}
        textDecoration={dead ? 'line-through' : ''} wrap="none" />
    </Group>
  );
}
const PICK_SCREEN_PX = 14;
const ERASE = TOK.bad;
const FOV_DEG = (FOV * 180) / Math.PI;
const deg = (r: number) => (r * 180) / Math.PI;

export function Board({ analysis, engine, control, sim, spots, batch, recap, timelineEnd }: {
  timelineEnd: number; analysis: Analysis; engine: TacticalEngine; control: ControlMap | null; sim: Simulation | null; spots: SpotMap | null; batch: BatchStats | null;
  recap?: Review | null;
}) {
  const MAP = engine.map;
  const UNITS_PER_PX = MAP.radar.scale;
  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 800 });
  const [view, setView] = useState({ scale: 0.8, x: 0, y: 0 });
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [eraseTarget, setEraseTarget] = useState<string | null>(null);
  /** Live position/facing while dragging; committed to the store only on drop. */
  const [drag, setDrag] = useState<{ id: string; pos?: Vec2; facing?: number } | null>(null);
  const raf = useRef(0);
  /** Two-click move: double-click picks an item up, the next click puts it down. */
  const [carry, setCarry] = useState<string | null>(null);
  const carryRef = useRef<string | null>(null);
  carryRef.current = carry;
  const preview = (d: typeof drag) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setDrag(d));
  };
  const erasing = useRef(false);
  const lastFinish = useRef(0);
  /** Click-to-aim: after clicking the white dot, the player faces the cursor until the next click. */
  const [aiming, setAiming] = useState<string | null>(null);
  const aimingRef = useRef<string | null>(null);
  aimingRef.current = aiming;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const [hoverPlayer, setHoverPlayer] = useState<string | null>(null);
  // the tip under the HUD fades after a few seconds; it comes back when the tool or the task changes
  const [hintSeen, setHintSeen] = useState(false);
  /** Review: the players an open move card is about (the rest of the map dims). */
  const [focus, setFocus] = useState<string[] | null>(null);
  const s = useStore();
  // Everything on the map (tokens, badges, labels) is sized for the screen, not the radar: a player token is about
  // 1.6 % of the map's on-screen size, between 7.5 and 11 px, so a small map isn't buried under its own markers and
  // zooming in doesn't make them huge.
  const tokenPx = Math.max(7.5, Math.min(11, 1024 * view.scale * 0.016));
  const k = tokenPx / (TOKEN_R * view.scale);
  // zoomed in (1.6× the whole-map view or more): room for names, guns and the detailed callouts
  // Review shows each team's panel down the sides: the map fits between them
  const rosters = s.mode === 'review' && !!s.review;
  const rostersRef = useRef(rosters);
  rostersRef.current = rosters;
  const zoomedIn = view.scale >= fitView(size.w, size.h, rosters).scale * ZOOM_DETAIL;
  // a callout the move card on screen names ("smoke at Lamp Room"), as a whole word
  const cardText = s.mode === 'review' ? s.cardText : null;
  const named = (name: string) => !!cardText && new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(cardText);
  // Review: each player's nickname in a tag under their token, always 10 px on screen (sizes below are in token units)
  const names = s.mode === 'review' ? s.review?.data.names ?? null : null;
  const nameFs = NAME_PX * TOKEN_R / tokenPx;
  const avatars = useAvatars(names ? s.board.players.map(p => p.id) : []);
  const utilR = (u: Utility) =>
    u.type === 'smoke' ? SMOKE_RADIUS_UNITS / UNITS_PER_PX : u.type === 'molotov' ? 120 / UNITS_PER_PX : u.type === 'he' ? 8 * k : 7 * k;

  useEffect(() => {
    setHintSeen(false);
    const t = setTimeout(() => setHintSeen(true), 6000);
    return () => clearTimeout(t);
  }, [s.tool]);

  useEffect(() => {
    if (!s.notice) return;
    const t = setTimeout(() => useStore.setState({ notice: null }), 5000);
    return () => clearTimeout(t);
  }, [s.notice]);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const w = Math.max(el.clientWidth, 100), h = Math.max(el.clientHeight, 100);
      setSize({ w, h });
      setView(fitView(w, h, rostersRef.current));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const st = useStore.getState();
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedId) st.remove(st.selectedId);
      if (e.key === 'Escape' && aimingRef.current) { setAiming(null); setDrag(null); return; }
      if ((e.key === '[' || e.key === ']') && st.selectedId) {
        const p = st.board.players.find(q => q.id === st.selectedId);
        if (p) {
          const f = p.facing ?? engineRef.current.facing(p);
          st.updatePlayer(p.id, { facing: f + (e.key === ']' ? 1 : -1) * (Math.PI / 12) });
        }
        return;
      }
      if (e.key === 'Escape' && carryRef.current) { setCarry(null); return; }
      if (e.key === 'Escape' && st.draftRoute) { st.cancelRoute(); return; }
      if (e.key === 'Enter') st.finishRoute();
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.shiftKey ? st.redo() : st.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pointer = (): Vec2 | null => stageRef.current?.getRelativePointerPosition() ?? null;

  const pick = (p: Vec2) => pickItem(useStore.getState().board, p, PICK_SCREEN_PX / view.scale, TOKEN_R * k, utilR, pl => bakeRoute(engine, pl));

  const eraseAt = (p: Vec2) => {
    const id = pick(p);
    if (id) { useStore.getState().remove(id); setEraseTarget(null); }
  };

  const onMouseDown = () => {
    const p = pointer();
    if (s.tool !== 'erase' || !p) return;
    erasing.current = true;
    eraseAt(p);
  };

  const pickUp = (id: string) => { if (s.tool === 'select') { setCarry(id); s.select(id); setHover(pointer()); } };
  const drop = (p: Vec2) => { if (carry) s.move(carry, p); setCarry(null); setHover(null); };

  const aimAt = (q: Vec2) => {
    const pl = s.board.players.find(x => x.id === aiming);
    return pl ? Math.atan2(q.y - pl.pos.y, q.x - pl.pos.x) : 0;
  };
  const commitAim = () => {
    const q = pointer();
    if (aiming && q) s.updatePlayer(aiming, { facing: aimAt(q) });
    setAiming(null);
    cancelAnimationFrame(raf.current);
    setDrag(null);
  };

  const onMouseMove = () => {
    if (aiming) { const q = pointer(); if (q) preview({ id: aiming, facing: aimAt(q) }); return; }
    if (s.draftRoute || carry || (s.tool === 'lineup' && s.draftLineup?.from && !s.draftLineup.to)) setHover(pointer());
    if (s.tool !== 'erase') return;
    const p = pointer();
    if (!p) return;
    if (erasing.current) eraseAt(p);
    else setEraseTarget(pick(p));
  };

  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = pointer();
    if (aiming) { commitAim(); return; }
    if (!p || s.tool === 'erase') return;
    const onEmpty = e.target === e.target.getStage() || e.target.name() === 'floor';
    if (carry) { drop(p); return; }
    switch (s.tool) {
      case 'ct': return s.addPlayer('CT', p);
      case 't': return s.addPlayer('T', p);
      case 'smoke': case 'flash': case 'molotov': case 'he': return s.addUtility(s.tool, p);
      case 'lineup': return s.draftLineup?.to ? undefined : s.lineupPoint(p);
      case 'path':
        if (s.draftRoute) {
          s.routePoint(p);
          // auto-route: one click = destination; Shift+click keeps adding waypoints
          if (s.autoRoute && !e.evt.shiftKey) { s.finishRoute(); lastFinish.current = performance.now(); }
          return;
        }
        if (performance.now() - lastFinish.current < 500) return; // second half of a double-click
        return useStore.setState({ notice: 'Click a player (T or CT) first to route them.' });
      default: if (onEmpty) s.select(null);
    }
  };

  const zoomAt = (factor: number, at?: { x: number; y: number }) =>
    setView(v => {
      const c = at ?? { x: size.w / 2, y: size.h / 2 };
      const scale = Math.max(0.3, Math.min(8, v.scale * factor));
      const mx = (c.x - v.x) / v.scale, my = (c.y - v.y) / v.scale;
      return { scale, x: c.x - mx * scale, y: c.y - my * scale };
    });

  /**
   * Mac-friendly wheel: two-finger scroll pans, pinch (ctrlKey) or ⌘/Ctrl+wheel zooms smoothly.
   * A classic mouse wheel (line mode / big discrete steps) zooms too.
   */
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    const ev = e.evt;
    ev.preventDefault();
    if (rostersRef.current) return; // Review: the camera frames the map, it doesn't scroll
    const ptr = stageRef.current!.getPointerPosition() ?? undefined;
    const mouseWheel = ev.deltaMode === 1 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 100 && Number.isInteger(ev.deltaY));
    if (ev.ctrlKey || ev.metaKey || mouseWheel) {
      const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoomAt(Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0015)), ptr);
    } else {
      setView(v => ({ ...v, x: v.x - ev.deltaX, y: v.y - ev.deltaY }));
    }
  };

  // Safari reports trackpad pinch as gesture events instead of ctrl+wheel.
  useEffect(() => {
    const el = wrap.current!;
    let last = 1;
    const start = (e: Event) => { e.preventDefault(); last = 1; };
    const change = (e: Event) => {
      e.preventDefault();
      if (rostersRef.current) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const r = el.getBoundingClientRect();
      zoomAt(g.scale / last, { x: g.clientX - r.left, y: g.clientY - r.top });
      last = g.scale;
    };
    el.addEventListener('gesturestart', start);
    el.addEventListener('gesturechange', change);
    return () => { el.removeEventListener('gesturestart', start); el.removeEventListener('gesturechange', change); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const fit = () => setView(fitView(size.w, size.h, rosters));
  // the panels came or went (a match loaded, Review ↔ Tactical): fit again
  useEffect(() => { setView(fitView(size.w, size.h, rosters)); }, [rosters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where each player is at the current round time (routes animate them).
  const baked = useMemo(() => new Map(s.board.players.map(p => [p.id, bakeRoute(engine, p)])), [engine, s.board.players]);
  const live = useMemo(
    () => new Map(s.board.players.map(p => {
      const st = sim && simStateAt(sim, p.id, s.time);
      if (st) return [p.id, { pos: st.pos, facing: st.facing as number | undefined, alive: st.alive, hp: st.hp, blind: st.blind }];
      return [p.id, { ...liveState(p, baked.get(p.id) ?? null, s.time), alive: true, hp: 100, blind: false }];
    })),
    [s.board.players, baked, s.time, sim],
  );
  // Review: the map stays put (no dragging or scrolling it around); a camera frames the fight instead: the whole map
  // while the players are spread out, closer in once everyone alive is on one part of it. It only moves when someone
  // leaves the framed area or the players bunch up a lot more, and it glides there.
  const camTarget = useRef<typeof view | null>(null);
  useEffect(() => {
    if (!rosters) { camTarget.current = null; return; }
    const full = fitView(size.w, size.h, true);
    const area = { x0: full.x, y0: full.y, x1: full.x + 1024 * full.scale, y1: full.y + 1024 * full.scale };
    const pts = [...live.values()].filter(l => l.alive).map(l => l.pos);
    let target = full;
    if (s.autoCam && pts.length) {
      const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const span = Math.max(x1 - x0, y1 - y0, CAM.minSpan) + CAM.pad * 2; // radar px
      if (span < 1024 * CAM.zoomBelow) {
        const scale = Math.min((full.scale * 1024) / span, full.scale * CAM.maxZoom);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ax = (area.x0 + area.x1) / 2, ay = (area.y0 + area.y1) / 2;
        target = { scale, x: ax - cx * scale, y: ay - cy * scale };
      }
    }
    // keep the framing while everyone alive is still well inside it and the zoom would change by under 15%
    const cur = camTarget.current;
    if (cur) {
      const inset = (area.x1 - area.x0) * 0.08;
      const inside = pts.every(q => {
        const sx = cur.x + q.x * cur.scale, sy = cur.y + q.y * cur.scale;
        return sx > area.x0 + inset && sx < area.x1 - inset && sy > area.y0 + inset && sy < area.y1 - inset;
      });
      if (inside && Math.abs(target.scale / cur.scale - 1) < 0.15) return;
    }
    camTarget.current = target;
  }, [live, rosters, s.autoCam, size.w, size.h]);
  // glide the view to the camera's framing
  useEffect(() => {
    if (!rosters) return;
    let raf = 0;
    const step = () => {
      const t = camTarget.current;
      if (t) setView(v => {
        const near = Math.abs(t.scale - v.scale) < 0.002 && Math.abs(t.x - v.x) < 0.5 && Math.abs(t.y - v.y) < 0.5;
        if (near) return v.scale === t.scale && v.x === t.x && v.y === t.y ? v : t;
        const e = CAM.ease;
        return { scale: v.scale + (t.scale - v.scale) * e, x: v.x + (t.x - v.x) * e, y: v.y + (t.y - v.y) * e };
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rosters]);
  // Review: name tags that would sit on top of another player's (spawns, a stack in a fight): only the first one
  // shows; the others come back on hover or selection. The living go first, so a dead player's tag never covers them.
  const crowded = useMemo(() => {
    const out = new Set<string>();
    if (!names) return out;
    const placed: Vec2[] = [];
    const order = [...live].sort((a, b) => Number(b[1].alive) - Number(a[1].alive));
    for (const [id, l] of order) {
      if (placed.some(q => Math.abs(q.x - l.pos.x) * view.scale < NAME_GAP.x && Math.abs(q.y - l.pos.y) * view.scale < NAME_GAP.y)) out.add(id);
      else placed.push(l.pos);
    }
    return out;
  }, [live, names, view.scale]);
  // review: each team's players down the sides with their health and gear (the top bar then only has the clock)
  const rosterRound = recap && s.review ? s.review.data.rounds[s.review.round] ?? null : null;
  const switches = useMemo(() => (s.review ? sideSwitches(s.review.data) : []), [s.review?.data]);
  // kills and deaths in the rounds before this one (this round's are added up to the moment on screen)
  const pastKd = useMemo(() => {
    const out = new Map<string, { k: number; d: number }>();
    if (!s.review) return out;
    for (const r of s.review.data.rounds.slice(0, s.review.round))
      for (const kl of r.kills) {
        const v = out.get(kl.victim) ?? { k: 0, d: 0 }; v.d++; out.set(kl.victim, v);
        if (kl.attacker && kl.attacker !== kl.victim) { const a = out.get(kl.attacker) ?? { k: 0, d: 0 }; a.k++; out.set(kl.attacker, a); }
      }
    return out;
  }, [s.review?.data, s.review?.round]);
  const roster = (side: 'CT' | 'T') => rosterRound && (
    <TeamRoster side={side} round={rosterRound} time={s.time}
      players={s.board.players.filter(p => p.side === side).slice(0, 5).map(p => {
        const now = rosterRound.kills.filter(kl => kl.t <= s.time);
        const roundKills = now.filter(kl => kl.attacker === p.id && kl.victim !== p.id && rosterRound.frames.players[kl.victim]?.side !== side).length;
        return {
          id: p.id, name: s.review?.data.names[p.id] ?? p.label, alive: live.get(p.id)?.alive !== false, hp: live.get(p.id)?.hp ?? 100, avatar: avatars[p.id],
          kills: (pastKd.get(p.id)?.k ?? 0) + now.filter(kl => kl.attacker === p.id && kl.victim !== p.id).length,
          deaths: (pastKd.get(p.id)?.d ?? 0) + now.filter(kl => kl.victim === p.id).length, roundKills,
        };
      })} />
  );
  const livePlayer = (p: Player): Player => {
    if (drag?.id === p.id) return { ...p, pos: drag.pos ?? p.pos, facing: drag.facing ?? p.facing };
    const l = live.get(p.id);
    return l ? { ...p, pos: l.pos, facing: l.facing } : p;
  };
  const displaced = (p: Player) => {
    const l = live.get(p.id);
    return !!l && Math.hypot(l.pos.x - p.pos.x, l.pos.y - p.pos.y) > 1;
  };
  const isDead = (p: Player) => live.get(p.id)?.alive === false;
  const draftPlayer = s.draftRoute && s.board.players.find(p => p.id === s.draftRoute!.playerId);
  const draftLabel = draftPlayer ? `${draftPlayer.side} ${draftPlayer.label}` : '';
  const selectedRaw = s.board.players.find(p => p.id === s.selectedId);
  const selected = selectedRaw && !isDead(selectedRaw) ? livePlayer(selectedRaw) : undefined;
  const smokesNow = activeSmokes(s.board.utility, s.time, UNITS_PER_PX);
  // review: each grenade's letter (when it's evaluated: every move, or only yours), shown on the grenade itself
  const { shown, mine: mineScope } = useShown();
  // the search engine's lines for the player in focus (selected, or you with "Mine"): its best option at this moment and what they did
  const engineFocus = recap?.search && s.engineLines ? s.selectedId ?? (mineScope ? whoAmI(s) : null) : null;
  const engineNow = useMemo(() => {
    if (!engineFocus || !recap?.search) return null;
    // while one of the engine's cards for this player is current (its first 3 s), show that moment, so the map and
    // the card agree; otherwise the latest moment
    const card = recap.moves.find(m => m.kind === 'position' && m.player === engineFocus && m.title.includes('; best was') && m.t <= s.time + 0.01 && s.time - m.t < 3);
    if (card) { const at = recap.search.moments.find(m => m.player === engineFocus && Math.abs(m.t - card.t) < 0.01); if (at) return at; }
    let best: (typeof recap.search.moments)[number] | null = null;
    for (const m of recap.search.moments) if (m.player === engineFocus && m.t <= s.time + 0.01 && s.time - m.t < 2.5 && (!best || m.t > best.t)) best = m;
    return best;
  }, [engineFocus, recap, s.time]);
  const nadeGrades = useMemo(() => new Map((recap?.moves ?? []).filter(m => m.util && shown(m)).map(m => [m.util!, m.note])), [recap, shown]);
  const losPoly = useMemo(
    () => (selected && s.overlays.los ? engine.grid.visibilityPolygon(selected.pos, smokesNow, [engine.facing(selected), FOV]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, selected?.pos.x, selected?.pos.y, selected?.facing, s.overlays.los, JSON.stringify(smokesNow)],
  );
  // Vision of every living player (cone cut by walls and smokes), refreshed 10× a second.
  const visionKey = Math.round(s.time * 10);
  const visionLayer = useMemo(() => {
    if (!s.overlays.vision) return null;
    const alive = s.board.players.filter(p => live.get(p.id)?.alive !== false).map(livePlayer);
    const cones = alive.map(p => ({
      id: p.id, side: p.side,
      poly: engine.grid.visibilityPolygon(p.pos, smokesNow, [p.facing ?? engine.facing(p), VISION_FOV], 360, 900),
    }));
    // who has an enemy in their view cone with a clear line of sight
    const spotted: { a: Vec2; b: Vec2 }[] = [];
    for (const a of alive) for (const b of alive) {
      if (a.side !== 'CT' || b.side !== 'T') continue;
      const ab = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
      if (ab > 900 || !engine.grid.lineOfSight(a.pos, b.pos, smokesNow)) continue;
      const aSees = inViewCone(a.pos, a.facing ?? engine.facing(a), b.pos), bSees = inViewCone(b.pos, b.facing ?? engine.facing(b), a.pos);
      if (aSees || bSees) spotted.push({ a: a.pos, b: b.pos });
    }
    return { cones, spotted };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, s.overlays.vision, s.board.players, visionKey, sim, JSON.stringify(smokesNow), drag]);
  const timingImg = useMemo(() => (s.overlays.timing ? timingCanvas(engine, s.time) : null), [engine, s.overlays.timing, s.time]);
  const entries = useMemo(() => entryReports(engine, analysis, s.board), [engine, analysis, s.board]);
  const controlImg = useMemo(() => (control ? controlCanvas(engine, control) : null), [engine, control]);
  const spotImg = useMemo(() => (spots ? spotCanvas(engine, spots) : null), [engine, spots]);
  const walkImg = useMemo(() => (s.overlays.walkable ? walkableCanvas(engine) : null), [engine, s.overlays.walkable]);
  const radarImg = useRadarImage(MAP.radarImage);

  return (
    <div ref={wrap} className={`board tool-${s.tool}`}>
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable={s.tool === 'select' && !rosters}
        onDragEnd={e => {
          if (e.target !== stageRef.current) return;
          e.target.getStage()!.container().style.cursor = '';
          setView(v => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onWheel={onWheel}
        onClick={onStageClick}
        onDblClick={() => { if (s.tool === 'path' && s.draftRoute) { s.finishRoute(); lastFinish.current = performance.now(); } }}
        onContextMenu={e => {
          // right-click / two-finger click: send the selected player here
          e.evt.preventDefault();
          const p = pointer();
          if (!p || !selectedRaw) return;
          s.routeTo(selectedRaw.id, p);
          useStore.setState({ notice: null });
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={() => { erasing.current = false; }}
        onMouseLeave={() => { erasing.current = false; setEraseTarget(null); setHover(null); }}
        onDragStart={e => { if (e.target === stageRef.current) e.target.getStage()!.container().style.cursor = 'grabbing'; }}
        style={{ cursor: s.tool === 'erase' && eraseTarget ? 'pointer' : undefined }}
      >
        <Layer listening={s.tool !== 'select'}>
          <Rect x={-2000} y={-2000} width={5000} height={5000} fill={COLORS.bg} name="floor" />
          {radarImg && <KImage image={radarImg} width={1024} height={1024} name="floor" />}
          {controlImg && <KImage image={controlImg} width={1024} height={1024} opacity={0.75} listening={false} />}
          {spotImg && <KImage image={spotImg} width={1024} height={1024} listening={false} />}
          {walkImg && <KImage image={walkImg} width={1024} height={1024} imageSmoothingEnabled={false} opacity={0.6} listening={false} />}
          {timingImg && <KImage image={timingImg} width={1024} height={1024} imageSmoothingEnabled={false} opacity={0.75} listening={false} />}
        </Layer>

        <Layer listening={false}>
          {/* where FACEIT level-10 players stand at this point of the round: a circle per callout, sized by their share
              of the time there (CT left, T right), with the share */}
          {engineNow && (() => {
            const from = live.get(engineNow.player)?.pos;
            if (!from || live.get(engineNow.player)?.alive === false) return null;
            const best = engineNow.options[0], did = engineNow.did;
            const same = Math.hypot(best.to.x - did.to.x, best.to.y - did.to.y) < 12 && best.kind === did.kind;
            // a dark outline under each line so it reads on any part of the radar
            // along the route the option takes (around walls), not a straight line
            const line = (to: Vec2, color: string, dash?: number[], path?: Vec2[]) => Math.hypot(to.x - from.x, to.y - from.y) > 8
              ? (() => {
                  const pts = [from, ...(path ?? []).filter(q => Math.hypot(q.x - from.x, q.y - from.y) > 6), to].flatMap(q => [q.x, q.y]);
                  return (
                    <Group>
                      <Arrow points={pts} tension={0.25} stroke="#000" fill="#000" strokeWidth={6 * k} pointerLength={11 * k} pointerWidth={11 * k} opacity={0.55} />
                      <Arrow points={pts} tension={0.25} stroke={color} fill={color} strokeWidth={3.6 * k} pointerLength={9 * k} pointerWidth={9 * k} dash={dash} />
                    </Group>
                  );
                })()
              : <Circle x={to.x} y={to.y} radius={TOKEN_R * 1.7 * k} stroke={color} strokeWidth={3.2 * k} dash={dash} shadowColor="#000" shadowBlur={4} shadowOpacity={0.8} />;
            const tag = (to: Vec2, text: string, color: string, dy: number) => (
              <Text x={to.x + 10 * k} y={to.y + dy * k} text={text} fontSize={12 * k} fontStyle="bold" fill={color} stroke="#000" strokeWidth={3 * k} fillAfterStrokeEnabled />
            );
            const doneColor = SEARCH_COLOR[engineNow.cls];
            return (
              <Group>
                {!same && line(did.to, doneColor, [6 * k, 4 * k], did.path)}
                {!same && did.nade && <ThrowArc from={from} to={did.nade} k={k} color={doneColor} dashed />}
                {line(best.to, SEARCH_COLOR.Best, undefined, best.path)}
                {best.nade && <ThrowArc from={from} to={best.nade} k={k} color={SEARCH_COLOR.Best} />}
                {tag(best.to, `Best: ${best.label}`, SEARCH_COLOR.Best, -16)}
                {!same && tag(did.to, `${engineNow.cls}: ${did.label}`, doneColor, 4)}
              </Group>
            );
          })()}
          {s.overlays.proSpots && (() => {
            const phase = phaseOf(s.time, s.mode === 'review' && s.review ? s.review.data.rounds[s.review.round]?.plant ?? null : null);
            return (['CT', 'T'] as const).flatMap(side => proSpots(MAP.id, side, phase).slice(0, 8).map(sp => {
              const c = MAP.callouts.find(x => x.name === sp.place);
              if (!c) return null;
              const r = (9 + 34 * Math.sqrt(sp.share)) * k;
              const x = c.pos.x + (side === 'CT' ? -1 : 1) * r * 0.8;
              return (
                <Group key={`pro-${side}-${sp.place}`} x={x} y={c.pos.y}>
                  <Circle radius={r} fill={COLORS[side]} opacity={0.35} />
                  <Circle radius={r} stroke={COLORS[side]} strokeWidth={1.5 * k} dash={[3 * k, 2 * k]} />
                  <Text text={`${Math.round(sp.share * 100)}%`} x={-20 * k} y={-r - 12 * k} width={40 * k} align="center" fontSize={11 * k} fontStyle="bold"
                    fill="#fff" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled />
                </Group>
              );
            }));
          })()}
          {/* main callouts with the Callouts layer; detailed ones too once you zoom in (or with "All callout names") */}
          {(s.overlays.callouts || s.overlays.calloutsAll) && MAP.callouts
            .filter(c => !c.minor || s.overlays.calloutsAll || zoomedIn || named(c.name))
            .map((c, i) => {
              // a fixed size on screen (like CS2's radar): small spaced capitals, quieter for the detailed spots;
              // a place the move card on screen names stands out
              const hot = named(c.name);
              const fs = (c.minor && !hot ? 8 : 9.5) / view.scale;
              return (
                <Text key={`${c.name}-${i}`} text={c.name.toUpperCase()} x={c.pos.x - 80} y={c.pos.y - fs / 2} width={160} align="center" fontSize={fs}
                  letterSpacing={0.6 / view.scale} fill={hot ? TOK.highlight : c.minor ? '#b9c1cc' : '#eef1f5'} stroke="#000" strokeWidth={2.2 / view.scale} fillAfterStrokeEnabled
                  fontStyle={c.minor && !hot ? 'normal' : 'bold'} opacity={hot ? 1 : c.minor ? 0.6 : 0.78} />
              );
            })}
          {visionLayer && visionLayer.cones.map(v => (
            <Line key={`vis-${v.id}`} points={v.poly} closed fill={v.side === 'CT' ? 'rgba(78,163,255,0.13)' : 'rgba(232,163,60,0.13)'}
              stroke={v.side === 'CT' ? 'rgba(78,163,255,0.5)' : 'rgba(232,163,60,0.5)'} strokeWidth={0.7 * k} />
          ))}
          {visionLayer && visionLayer.spotted.map((l, i) => (
            <Line key={`spot-${i}`} points={[l.a.x, l.a.y, l.b.x, l.b.y]} stroke={TOK.bad} strokeWidth={1.4 * k} dash={[5 * k, 3 * k]} opacity={0.85} />
          ))}
          {losPoly && <Line points={losPoly} closed fill="rgba(78,163,255,0.13)" stroke="rgba(78,163,255,0.45)" strokeWidth={0.8} />}
          {s.overlays.threat && s.mode !== 'review' && entries.map(e => {
            const col = ENTRY_COLOR[e.level];
            const [a, b] = e.portal;
            const w = 132;
            const pressure = e.pressure >= 0.05 ? ` · ${Math.round(e.pressure * 100)}% of T push` : '';
            return (
              <Group key={e.id} listening={false}>
                <Line points={[a.x, a.y, b.x, b.y]} stroke={col} strokeWidth={3.5 * k} lineCap="round" opacity={0.95} />
                {s.overlays.entryCards && <Group x={e.center.x + 6 * k} y={e.center.y + 6 * k} scaleX={k * 0.75} scaleY={k * 0.75}>
                  <Rect width={w} height={pressure ? 39 : 28} cornerRadius={4} fill={TOK.bg0} opacity={0.86} stroke={col} strokeWidth={1.2} />
                  <Rect width={3} height={pressure ? 39 : 28} cornerRadius={[4, 0, 0, 4]} fill={col} />
                  <Text x={7} y={4} width={w - 10} text={`${e.name} · ${entryClock(e, s.time)}`} fontSize={9.5} fontStyle="bold" fill="#fff" wrap="none" ellipsis />
                  <Text x={7} y={16} width={w - 10} text={e.headline} fontSize={8} fill={col} wrap="none" ellipsis />
                  {pressure && <Text x={7} y={27} width={w - 10} text={pressure.slice(3)} fontSize={8} fill="#c8ced8" wrap="none" ellipsis />}
                </Group>}
              </Group>
            );
          })}
        </Layer>

        <Layer>
          {s.board.players.map(p => {
            const r = baked.get(p.id);
            if (!r || drag?.id === p.id) return null;
            const doomed = eraseTarget === `route:${p.id}`;
            const col = doomed ? ERASE : COLORS[p.side];
            const end = r.pts[r.pts.length - 1];
            return (
              <Group key={`route-${p.id}`} listening={false}>
                <Arrow points={r.pts.flatMap(q => [q.x, q.y])} stroke={col} fill={col} opacity={0.85}
                  strokeWidth={(doomed ? 3.5 : 2.2) * k} dash={[7 * k, 4 * k]} pointerLength={7 * k} pointerWidth={7 * k} lineJoin="round" />
                {p.route!.pts.map((w, i) => <Circle key={i} x={w.x} y={w.y} radius={2.5 * k} fill={col} />)}
                <RouteTicks route={r} k={k} color={col} />
                <Text x={end.x + 6 * k} y={end.y - 14 * k} text={`${p.label} · ${fmtTime(r.end)}${r.unreachable ? ' (off the floor)' : ''}`} fontSize={9 * k}
                  fill="#fff" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled fontStyle="bold" />
              </Group>
            );
          })}
          {s.draftRoute && (() => {
            const pl = s.board.players.find(q => q.id === s.draftRoute!.playerId);
            if (!pl) return null;
            const pts = [pl.pos, ...s.draftRoute.pts, ...(hover ? [hover] : [])];
            return (
              <Group listening={false}>
                <Arrow points={pts.flatMap(q => [q.x, q.y])} stroke="#fff" fill="#fff" strokeWidth={2 * k} dash={[6 * k, 4 * k]}
                  pointerLength={7 * k} pointerWidth={7 * k} opacity={0.85} />
                {s.draftRoute.pts.map((w, i) => <Circle key={i} x={w.x} y={w.y} radius={3 * k} fill="#fff" />)}
              </Group>
            );
          })()}
          {s.overlays.lineups && [...BUILTIN_LINEUPS, ...s.customLineups].filter(l => l.map === MAP.id && l.level === s.level).map(l => (
            <Group key={`lu-${l.id}`} listening={false} opacity={0.75}>
              <ThrowArc from={l.from} to={l.to} k={k} color={UTIL_COLOR[l.type]} dashed />
              <Circle x={l.from.x} y={l.from.y} radius={3 * k} fill={TOK.highlight} stroke="#000" strokeWidth={0.8 * k} />
              <Text x={l.to.x + 5 * k} y={l.to.y - 5 * k} text={l.name} fontSize={8 * k} fill="#fff" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled />
            </Group>
          ))}
          {s.board.utility.filter(u => u.from || u.path).map(u => <NadeFlight key={`fly-${u.id}`} u={u} t={s.time} k={k} />)}
          {s.tool === 'lineup' && s.draftLineup?.from && (
            <Group listening={false}>
              <Circle x={s.draftLineup.from.x} y={s.draftLineup.from.y} radius={4 * k} fill={TOK.highlight} stroke="#000" strokeWidth={1 * k} />
              {(s.draftLineup.to ?? hover) && <ThrowArc from={s.draftLineup.from} to={(s.draftLineup.to ?? hover)!} k={k} color={TOK.highlight} />}
            </Group>
          )}
          {s.board.utility.map(u => {
            const doomed = eraseTarget === u.id;
            return (
              <Group key={u.id} x={u.pos.x} y={u.pos.y} draggable={s.tool === 'select' && !carry} opacity={carry === u.id ? 0.35 : 1}
                onDblClick={e => { e.cancelBubble = true; pickUp(u.id); }} onDblTap={e => { e.cancelBubble = true; pickUp(u.id); }}
                onDragEnd={e => s.move(u.id, { x: e.target.x(), y: e.target.y() })}
                onClick={e => { e.cancelBubble = true; if (aiming) commitAim(); else if (carry) { const q = pointer(); if (q) drop(q); } else if (s.tool === 'select') s.select(u.id); }}>
                <NadeAtLanding u={u} t={s.time} k={k} unitsPerPx={UNITS_PER_PX} selected={s.selectedId === u.id} doomed={doomed} editable={s.mode !== 'review'} grade={nadeGrades.get(u.id)}
                  opened={u.type === 'smoke' ? smokeOpenAt(u, s.board.utility, s.time, UNITS_PER_PX) : undefined} />
              </Group>
            );
          })}
          {s.board.players.map(p => displaced(p) && (
            // start marker for players who have walked away along their route
            <Group key={`start-${p.id}`} x={p.pos.x} y={p.pos.y} draggable={s.tool === 'select' && !carry}
              onDragEnd={e => s.move(p.id, { x: e.target.x(), y: e.target.y() })}
              onClick={e => { e.cancelBubble = true; if (s.tool === 'select') s.select(p.id); }}>
              <Circle radius={TOKEN_R * 0.7 * k} stroke={COLORS[p.side]} strokeWidth={1.5 * k} dash={[3 * k, 2 * k]} fill="#0008" hitStrokeWidth={10 * k} />
              <Text text={p.label} fontSize={8 * k} fill={COLORS[p.side]} width={16 * k} x={-8 * k} y={-4 * k} align="center" fontStyle="bold" />
            </Group>
          ))}
          {s.board.players.filter(isDead).map(lp => {
            const p = livePlayer(lp);
            return (
              <Group key={`dead-${p.id}`} x={p.pos.x} y={p.pos.y} scaleX={k} scaleY={k} listening={false} opacity={focus && !focus.includes(p.id) ? 0.3 : 0.8}>
                <Circle radius={TOKEN_R * 0.85} fill="#2a2f36" stroke={COLORS[p.side]} strokeWidth={1.5} />
                <Line points={[-5, -5, 5, 5]} stroke={COLORS[p.side]} strokeWidth={2.2} lineCap="round" />
                <Line points={[-5, 5, 5, -5]} stroke={COLORS[p.side]} strokeWidth={2.2} lineCap="round" />
                {names ? (!crowded.has(p.id) || hoverPlayer === p.id) && <NameTag name={names[p.id] ?? p.label} side={p.side} fs={nameFs} y={TOKEN_R * 0.85 + 3} dead />
                  : <Text text={p.label} fontSize={8} fill={COLORS[p.side]} x={7} y={-12} fontStyle="bold" />}
              </Group>
            );
          })}
          {s.board.players.filter(p => !isDead(p)).map(lp => {
            const p = livePlayer(lp);
            const moved = displaced(lp);
            return (
            <Group key={p.id} x={p.pos.x} y={p.pos.y} draggable={s.tool === 'select' && !carry && !moved}
              opacity={carry === p.id || (focus && !focus.includes(p.id)) ? 0.35 : 1}
              onDblClick={e => { e.cancelBubble = true; if (s.tool !== 'path') pickUp(p.id); }} onDblTap={e => { e.cancelBubble = true; if (s.tool !== 'path') pickUp(p.id); }}
              onMouseEnter={e => { setHoverPlayer(p.id); e.target.getStage()!.container().style.cursor = 'pointer'; }}
              onMouseLeave={e => { setHoverPlayer(h => (h === p.id ? null : h)); e.target.getStage()!.container().style.cursor = ''; }}
              onDragStart={() => { s.select(p.id); setDrag({ id: p.id, pos: p.pos }); }}
              onDragMove={e => preview({ id: p.id, pos: { x: e.target.x(), y: e.target.y() } })}
              onDragEnd={e => { cancelAnimationFrame(raf.current); setDrag(null); s.move(p.id, { x: e.target.x(), y: e.target.y() }); }}
              onClick={e => {
                e.cancelBubble = true;
                if (aiming) { commitAim(); return; }
                if (carry) { const q = pointer(); if (q) drop(q); }
                else if (s.tool === 'path') {
                  // clicking the player being routed finishes; any other player switches to them
                  if (s.draftRoute?.playerId === p.id) { if (s.draftRoute.pts.length) s.finishRoute(); }
                  else s.startRoute(p.id);
                }
                else if (s.tool !== 'erase') s.select(p.id);
              }}>
              <Group scaleX={k} scaleY={k}>
                <Wedge radius={26} angle={FOV_DEG} rotation={deg(p.facing ?? engine.facing(p)) - FOV_DEG / 2} listening={false}
                  fill={COLORS[p.side]} opacity={p.facing === undefined ? 0.16 : 0.26} />
                {(hoverPlayer === p.id || s.draftRoute?.playerId === p.id) && s.tool === 'path' && (
                  <Circle radius={TOKEN_R + 5} stroke="#fff" strokeWidth={2} dash={[4, 3]} listening={false} />
                )}
                {live.get(lp.id)?.blind && (
                  <Circle radius={TOKEN_R + 7} fill="rgba(255,246,168,0.4)" shadowColor="#fff6a8" shadowBlur={10} shadowOpacity={0.9} listening={false} />
                )}
                {/* selected: a thin glowing white ring outside the token */}
                {s.selectedId === p.id && <Circle radius={TOKEN_R + 7} stroke="#fff" strokeWidth={1.4} shadowColor="#fff" shadowBlur={8} shadowOpacity={0.7} listening={false} />}
                {(() => {
                  const hp = Math.max(0, Math.min(100, live.get(lp.id)?.hp ?? 100));
                  const base = eraseTarget === p.id ? ERASE : COLORS[p.side];
                  return (
                    <>
                      {/* a dark bezel with the health ring on it: the team colour all the way round at full health,
                          shrinking from 12 o'clock as they take damage, red when low */}
                      <Circle radius={TOKEN_R + 3.6} hitStrokeWidth={18} fill="#0b0e12" opacity={0.92} shadowColor="#000" shadowBlur={6} shadowOpacity={0.7} />
                      <Arc innerRadius={TOKEN_R + 0.9} outerRadius={TOKEN_R + 3} angle={360} fill={base} opacity={0.18} listening={false} />
                      {hp > 0 && <Arc innerRadius={TOKEN_R + 0.9} outerRadius={TOKEN_R + 3} angle={3.6 * hp} rotation={-90}
                        fill={hp <= 30 ? TOK.bad : mixWhite(base, 0.25)} listening={false} />}
                      {/* the body: lighter in the middle, like a lit token */}
                      <Circle radius={TOKEN_R - 0.2} listening={false}
                        fillRadialGradientStartPoint={{ x: -3, y: -3 }} fillRadialGradientStartRadius={0}
                        fillRadialGradientEndPoint={{ x: 0, y: 0 }} fillRadialGradientEndRadius={TOKEN_R}
                        fillRadialGradientColorStops={[0, mixWhite(base, 0.45), 0.65, base, 1, mixBlack(base, 0.25)]} />
                      {/* where they're looking, like the arrow on CS2's radar, outside the ring */}
                      <Line points={[TOKEN_R + 3.4, -4.2, TOKEN_R + 9, 0, TOKEN_R + 3.4, 4.2]} closed rotation={deg(p.facing ?? engine.facing(p))}
                        fill="#fff" stroke="#0b0e12" strokeWidth={1} lineJoin="round" listening={false} />
                    </>
                  );
                })()}
                {/* in Review the nickname goes in the tag underneath; the plan's numbers stay in the circle */}
                {!names && <Text text={p.label} fontSize={11} fontStyle="bold" fill="#0d0f12" width={22} x={-11} y={-5.5} align="center" />}
                {names && (!crowded.has(p.id) || hoverPlayer === p.id || s.selectedId === p.id || !!focus?.includes(p.id)) &&
                  <NameTag name={names[p.id] ?? p.label} side={p.side} fs={nameFs} y={TOKEN_R + 5.5} strong={hoverPlayer === p.id || s.selectedId === p.id || !!focus?.includes(p.id)} />}
                {s.overlays.playerInfo && (zoomedIn || hoverPlayer === p.id || s.selectedId === p.id) && <Text text={gunOf(p).short} fontSize={7} fill={gunOf(p).cls === 'awp' ? TOK.highlight : '#fff'} stroke="#000" strokeWidth={2} fillAfterStrokeEnabled
                  width={40} x={-20} y={names ? TOKEN_R + 5 + nameFs * 1.5 : 13} align="center" fontStyle="bold" listening={false} />}
                {s.overlays.playerInfo && batch?.players[p.id] && (
                  <Text text={`${Math.round(batch.players[p.id].pKill * 100)}% K`} fontSize={8} fontStyle="bold" width={40} x={-20} y={names ? TOKEN_R + 13 + nameFs * 1.5 : 21} align="center"
                    fill={killColor(batch.players[p.id].pKill)} stroke="#000" strokeWidth={2.2} fillAfterStrokeEnabled />
                )}
              </Group>
            </Group>
            );
          })}
          {recap && s.review && (() => {
            const b = bombAt(s.review.data.rounds[s.review.round], s.time);
            if (!b) return null;
            if (b.kind === 'carry') {
              const at = live.get(b.id);
              return at && at.alive !== false ? <C4 x={at.pos.x + 11 * k} y={at.pos.y + 10 * k} k={k * 0.9} /> : null;
            }
            const at = worldToRadar(b, engine.map.radar);
            return <BombOnMap at={at} k={k} state={b.kind} age={s.time - b.since} planted={b.plantedAt === null ? null : s.time - b.plantedAt} />;
          })()}
          {recap && sim && s.review && (
            <Gunfire round={s.review.data.rounds[s.review.round]} sim={sim} engine={engine} t={s.time} k={k}
              sideOf={id => s.board.players.find(q => q.id === id)?.side ?? 'CT'} />
          )}
          {sim && sim.kills.filter(kv => kv.killer && s.time >= kv.t && s.time - kv.t < 1.5).map((kv, i) => {
            const killer = sim.ids.indexOf(kv.killer);
            const step = Math.min(sim.steps - 1, Math.floor(kv.t / 0.1));
            const side = s.board.players.find(q => q.id === kv.killer)?.side ?? 'CT';
            return (
              <Line key={`shot-${i}`} points={[sim.x[killer][step], sim.y[killer][step], kv.at.x, kv.at.y]} listening={false}
                stroke={COLORS[side]} strokeWidth={2 * k} opacity={1 - (s.time - kv.t) / 1.5} dash={[2 * k, 3 * k]} />
            );
          })}
          {spots && spots.best.map((sp, i) => (
            <Group key={`spot-${i}`} x={sp.pos.x} y={sp.pos.y} listening={false}>
              <Circle radius={9 * k} fill={TOK.highlight} stroke="#000" strokeWidth={1.5 * k} shadowColor="#000" shadowBlur={5} shadowOpacity={0.6} />
              <Text text={String(i + 1)} fontSize={11 * k} fontStyle="bold" fill="#111" width={18 * k} x={-9 * k} y={-5.5 * k} align="center" />
              <Group x={11 * k} y={-8 * k} scaleX={k * 0.75} scaleY={k * 0.75}>
                <Rect width={86} height={20} cornerRadius={4} fill={TOK.bg0} opacity={0.88} stroke={TOK.highlight} strokeWidth={1} />
                <Text x={5} y={5} text={`${sp.score} · ${sp.where || 'here'}`} fontSize={9.5} fontStyle="bold" fill={TOK.highlight} width={80} wrap="none" ellipsis />
              </Group>
            </Group>
          ))}
          {spots?.current && (() => {
            const pl = s.board.players.find(q => q.id === spots.playerId);
            if (!pl) return null;
            return (
              <Group x={pl.pos.x} y={pl.pos.y} listening={false}>
                <Circle radius={17 * k} stroke={TOK.highlight} strokeWidth={1.5 * k} dash={[4 * k, 3 * k]} />
                <Text x={-40 * k} y={-30 * k} width={80 * k} align="center" fontSize={8.5 * k} fontStyle="bold" fill={TOK.highlight} stroke="#000" strokeWidth={2} fillAfterStrokeEnabled
                  text={`now: ${spots.current.score}${spots.currentRank ? ` · #${spots.currentRank}` : ''}`} />
              </Group>
            );
          })()}
          {recap && sim && recap.moves.filter(m => shown(m) && s.time >= m.t && s.time - m.t < BADGE_SECS).map((m, i) => {
            const pi = sim.ids.indexOf(m.player);
            if (pi < 0) return null;
            const step = Math.min(sim.steps - 1, Math.round((m.kind === 'death' ? m.t : s.time) / 0.1));
            const g = moveLook(m);
            const age = (s.time - m.t) / BADGE_SECS;
            return (
              <Group key={`badge-${i}`} x={sim.x[pi][step] + 13 * k} y={sim.y[pi][step] - 13 * k} listening={false}
                opacity={age < 0.8 ? 1 : (1 - age) * 5} scaleX={age < 0.06 ? 0.6 + age * 7 : 1} scaleY={age < 0.06 ? 0.6 + age * 7 : 1}>
                {/* book moves: a small plain dot; annotated ones: their !! ! ? ?? */}
                <Circle radius={(m.note === 'book' ? 4.5 : 9) * k} fill={g.color} stroke="#000" strokeWidth={1.5 * k} shadowColor="#000" shadowBlur={4} shadowOpacity={0.5} />
                {m.note !== 'book' && <Text text={g.mark} fontSize={(g.mark.length > 1 ? 9.5 : 12) * k} fontStyle="bold" fill="#111" width={18 * k} x={-9 * k} y={-5.5 * k} align="center" />}
              </Group>
            );
          })}
          {carry && hover && (() => {
            const pl = s.board.players.find(q => q.id === carry);
            const u = s.board.utility.find(q => q.id === carry);
            const from = pl?.pos ?? u?.pos;
            if (!from) return null;
            const col = pl ? COLORS[pl.side] : '#fff';
            return (
              <Group listening={false}>
                <Line points={[from.x, from.y, hover.x, hover.y]} stroke={col} strokeWidth={1.5 * k} dash={[5 * k, 4 * k]} opacity={0.8} />
                <Circle x={hover.x} y={hover.y} radius={TOKEN_R * k} fill={col} opacity={0.75} stroke="#fff" strokeWidth={2 * k} />
                {pl && <Text text={pl.label} x={hover.x - 11 * k} y={hover.y - 5.5 * k} width={22 * k} align="center" fontSize={11 * k} fontStyle="bold" fill="#0d0f12" />}
              </Group>
            );
          })()}
          {!carry && selected && selectedRaw && !displaced(selectedRaw) && (s.tool === 'select' || aiming === selected.id) && !(drag?.pos && drag.id === selected.id) && (
            <FacingHandle engine={engine} player={selected} k={k} aiming={aiming === selected.id}
              onAim={() => { setAiming(selected.id); const q = pointer(); if (q) preview({ id: selected.id, facing: Math.atan2(q.y - selected.pos.y, q.x - selected.pos.x) }); }}
              onPreview={f => preview({ id: selected.id, facing: f })}
              onCommit={f => { cancelAnimationFrame(raf.current); setDrag(null); s.updatePlayer(selected.id, { facing: f }); }} />
          )}
        </Layer>
      </Stage>
      {/* everything over the map lives in fixed slots around its edges, so nothing overlaps */}
      <div className={`board-ui ${rosterRound ? 'broadcast' : ''}`}>
        <div className="slot tl"><LayersBar /></div>
        <div className="slot top">
          {rosterRound && s.review && <ScoreBug score={scoreBefore(s.review.data, s.review.round)} round={rosterRound} roundNo={s.review.round + 1} time={s.time}
            switched={switches.includes(s.review.round) ? s.review.data.names[Object.keys(rosterRound.frames.players).find(id => rosterRound.frames.players[id].side === 'CT') ?? ''] ?? 'the other' : null} />}
          {!rosterRound && <RoundHud
            players={rosterRound ? [] : s.board.players.map(p => ({
              id: p.id, side: p.side, label: p.label, name: s.mode === 'review' ? s.review?.data.names[p.id] ?? p.label : `${p.side} ${p.label}`,
              alive: live.get(p.id)?.alive !== false, hp: live.get(p.id)?.hp ?? 100, avatar: avatars[p.id],
            }))}
            score={recap && s.review ? scoreBefore(s.review.data, s.review.round) : null}
            plantedAt={recap && s.review ? s.review.data.rounds[s.review.round]?.plant ?? null : null} />}
          <div className={`hint ${s.notice ? 'notice' : aiming || carry || s.draftRoute ? 'carry' : ''} ${hintSeen && !s.notice && !aiming && !carry && !s.draftRoute ? 'faded' : ''}`}
            style={recap ? { display: 'none' } : undefined}>
            {s.notice ?? (aiming ? 'Move the mouse to aim · click to set the direction · Esc cancels'
              : carry ? 'Click where to put it · Esc cancels'
              : s.draftRoute
                ? s.autoRoute
                  ? `Route for ${draftLabel}: click the destination (Shift+click adds waypoints) · Esc cancels`
                  : `Route for ${draftLabel}: click waypoints · double-click or Enter to finish · Esc cancels`
                : toolHint(s.tool))}
          </div>
        </div>
        <div className="slot tr">
          <div className="tr-buttons">
          {recap && (
            <button className={`reveal-float ${s.reviewSpoilers ? 'on' : ''}`} onClick={() => s.setReviewSpoilers(!s.reviewSpoilers)} title="Shortcut: R">
              {s.reviewSpoilers ? <><Icon name="prev" /> Live</> : <><Icon name="revealAll" /> Reveal all</>}
            </button>
          )}
          <button className={`drawer-toggle ${s.drawerOpen ? 'on' : ''}`} onClick={() => s.setDrawerOpen(!s.drawerOpen)}
            title={s.drawerOpen ? 'Hide the panel (more room for the map)' : 'Show the panel'}><Icon name={s.drawerOpen ? 'panelClose' : 'panelOpen'} /> Panel</button>
          </div>
          {recap && s.review && (
            <KillFeed recap={recap} round={s.review.data.rounds[s.review.round]} time={s.time} names={s.review.data.names} />
          )}
        </div>
        {rosterRound && <div className="slot team-ct">{roster('CT')}</div>}
        {rosterRound && <div className="slot team-t">{roster('T')}</div>}
        <div className="slot right">
          {rosterRound ? (
            <div className="zoom">
              <button className={s.autoCam ? 'on' : ''} onClick={() => s.setAutoCam(!s.autoCam)} aria-pressed={s.autoCam}
                title={s.autoCam ? 'Auto zoom is on: the map zooms in when everyone is on one part of it. Click for the whole map.' : 'Auto zoom is off: the whole map. Click to follow the fight.'}>
                Auto
              </button>
            </div>
          ) : (
            <div className="zoom">
              <button onClick={() => zoomAt(1.25)} title="Zoom in (pinch, or ⌘ + scroll)">+</button>
              <button onClick={() => zoomAt(0.8)} title="Zoom out">−</button>
              <button onClick={fit} title="Fit map">Fit</button>
            </div>
          )}
        </div>
        <div className="slot bl">
          {recap && sim && s.popups && s.review && (
            <MoveFeed recap={recap} sim={sim} round={s.review.data.rounds[s.review.round]} time={s.time} view={view} boardRef={wrap}
              names={s.review.data.names} onFocus={setFocus} />
          )}
        </div>
        <div className="slot br"><Coords stageRef={stageRef} engine={engine} spots={spots} /></div>
        {recap && <div className="slot eval"><EvalBar ct={evalAt(recap.curve, s.time)} /></div>}
        <div className="slot dock">
          <PlaybackBar end={timelineEnd} recap={recap} round={s.review ? s.review.data.rounds[s.review.round] : null} />
          {recap && <MomentNav recap={recap} />}
        </div>
      </div>
    </div>
  );
}

/** Drag to rotate where the selected player is looking. */
function FacingHandle({ engine, player, k, aiming, onAim, onPreview, onCommit }: {
  engine: TacticalEngine; player: Player; k: number; aiming: boolean; onAim: () => void; onPreview: (f: number) => void; onCommit: (f: number) => void;
}) {
  const f = engine.facing(player);
  const R = 46 * k;
  const angle = (x: number, y: number) => Math.atan2(y - player.pos.y, x - player.pos.x);
  return (
    <Group>
      <Line points={[player.pos.x, player.pos.y, player.pos.x + Math.cos(f) * R, player.pos.y + Math.sin(f) * R]}
        stroke="#fff" strokeWidth={1.2 * k} dash={[3 * k, 3 * k]} listening={false} />
      <Circle x={player.pos.x + Math.cos(f) * R} y={player.pos.y + Math.sin(f) * R} radius={7 * k} hitStrokeWidth={16 * k}
        fill={aiming ? TOK.highlight : '#fff'} stroke="#000" strokeWidth={1.5 * k} draggable={!aiming} listening={!aiming}
        onClick={e => { e.cancelBubble = true; onAim(); }} onTap={e => { e.cancelBubble = true; onAim(); }}
        onMouseEnter={e => { e.target.getStage()!.container().style.cursor = 'grab'; }}
        onMouseLeave={e => { e.target.getStage()!.container().style.cursor = ''; }}
        // keep the dot on the circle around the player while dragging
        dragBoundFunc={function (this: Konva.Node, pos) {
          const st = this.getStage()!;
          const t = st.getAbsoluteTransform().copy().invert().point(pos);
          const a = angle(t.x, t.y);
          return st.getAbsoluteTransform().point({ x: player.pos.x + Math.cos(a) * R, y: player.pos.y + Math.sin(a) * R });
        }}
        onDragMove={e => onPreview(angle(e.target.x(), e.target.y()))}
        onDragEnd={e => onCommit(angle(e.target.x(), e.target.y()))} />
    </Group>
  );
}

const BADGE_SECS = 3.5;
/** How far zoomed in (× the whole-map view) before the detailed callouts appear on their own. */
const ZOOM_DETAIL = 1.6;

/** Room the overlays take around the map (px): the HUD on top, zoom at the side, the eval bar and the dock below. */
const FIT_PAD = { top: 52, bottom: 92, side: 44 };
/**
 * Review's camera: zooms in once everyone alive fits in under `zoomBelow` of the map (radar px span, plus `pad` on
 * each side, never tighter than `minSpan`), at most `maxZoom`× the whole-map view; `ease` = share of the way per frame.
 */
const CAM = { pad: 90, minSpan: 300, zoomBelow: 0.8, maxZoom: 2.4, ease: 0.08 };
/** Review's team panels down each side (196 px and their margin), hidden on a board under 700 px wide. */
/** How close (screen px, across and down) two players' name tags may be before the second one hides: about a tag's size. */
const NAME_GAP = { x: 64, y: 16 };
/** Review's team panels in the bottom corners: how wide and tall (px) they are on a wide board. */
const TEAMBAR = { w: 300, h: 196 }, ROSTER_MIN_W = 700;
/**
 * The whole radar, as big as fits between the overlays. With Review's team panels in the bottom corners: either the
 * map stays between them (narrower), or above them (shorter), whichever leaves it bigger.
 */
function fitView(w: number, h: number, rosters = false) {
  const fit = (side: number, bottom: number) => {
    const aw = Math.max(200, w * 0.5, w - side * 2), ah = Math.max(200, h - FIT_PAD.top - bottom);
    const scale = Math.min(aw, ah) / 1024;
    return { scale, x: (w - 1024 * scale) / 2, y: FIT_PAD.top + (ah - 1024 * scale) / 2 };
  };
  const plain = fit(FIT_PAD.side, FIT_PAD.bottom);
  if (!rosters || w < ROSTER_MIN_W) return plain;
  const beside = fit(TEAMBAR.w + 12, FIT_PAD.bottom), above = fit(FIT_PAD.side, FIT_PAD.bottom + TEAMBAR.h - 40);
  return beside.scale >= above.scale ? beside : above;
}
const BOMB_FUSE = 40;

/** The bomb, as a small C4 block (with a status light). */
function C4({ x, y, k, light }: { x: number; y: number; k: number; light?: string }) {
  return (
    <Group x={x} y={y} scaleX={k} scaleY={k} listening={false}>
      <Rect x={-9} y={-6} width={18} height={12} cornerRadius={2} fill="#b8963a" stroke="#111" strokeWidth={1.4} shadowColor="#000" shadowBlur={4} shadowOpacity={0.6} />
      <Rect x={-6.5} y={-3.5} width={9} height={5} cornerRadius={1} fill="#1f2a1a" />
      <Text x={-6.5} y={-3} width={9} align="center" text="C4" fontSize={4.5} fontStyle="bold" fill="#9be36b" />
      <Circle x={5.5} y={-1} radius={2} fill={light ?? '#5a1a14'} stroke="#111" strokeWidth={0.6} />
    </Group>
  );
}

/** Dropped (waiting to be picked up), planted (blinking faster as the fuse runs out), defused or exploded. */
function BombOnMap({ at, k, state, age, planted }: { at: Vec2; k: number; state: 'drop' | 'plant' | 'defuse' | 'explode'; age: number; planted: number | null }) {
  if (state === 'explode') {
    const a = Math.min(1, age / 0.6);
    return (
      <Group x={at.x} y={at.y} listening={false}>
        {age < 2.5 && <Circle radius={(14 + 70 * a) * k} fill="#ff7a1a" opacity={0.55 * (1 - age / 2.5)} />}
        {age < 1.2 && <Circle radius={(8 + 34 * a) * k} fill="#ffe08a" opacity={0.9 * (1 - age / 1.2)} />}
        <Circle radius={11 * k} fill="#1a1410" opacity={0.7} />
      </Group>
    );
  }
  if (state === 'defuse') {
    return (
      <Group listening={false}>
        <Circle x={at.x} y={at.y} radius={17 * k} stroke="#5aa9ff" strokeWidth={2 * k} fill="rgba(90,169,255,0.15)" />
        <C4 x={at.x} y={at.y} k={k * 1.35} light="#5aa9ff" />
      </Group>
    );
  }
  if (state === 'plant') {
    const left = Math.max(0, BOMB_FUSE - (planted ?? 0));
    const rate = left > 10 ? 1 : left > 5 ? 2 : 4; // beeps per second, like the real bomb
    const on = ((planted ?? 0) * rate) % 1 < 0.35;
    const pulse = ((planted ?? 0) * rate) % 1;
    return (
      <Group listening={false}>
        <Circle x={at.x} y={at.y} radius={(16 + 20 * pulse) * k} stroke="#ff3b30" strokeWidth={2.5 * k} opacity={0.8 * (1 - pulse)} />
        <C4 x={at.x} y={at.y} k={k * 1.35} light={on ? '#ff3b30' : '#5a1a14'} />
      </Group>
    );
  }
  return (
    <Group listening={false}>
      <Circle x={at.x} y={at.y} radius={16 * k} stroke={TOK.highlight} strokeWidth={1.5 * k} dash={[3 * k, 2.5 * k]} />
      <C4 x={at.x} y={at.y} k={k * 1.35} />
    </Group>
  );
}

/** Win chance as a bar along the bottom of the map: CT share from the left, T from the right. */
function EvalBar({ ct }: { ct: number }) {
  const pctCT = Math.round(ct * 100);
  return (
    <div className="evalbar" title={`Win chance: CT ${pctCT}% · T ${100 - pctCT}%`}>
      <div className="evalbar-ct" style={{ width: `${ct * 100}%` }}><span>CT {pctCT}%</span></div>
      <div className="evalbar-t" style={{ width: `${100 - ct * 100}%` }}><span>{100 - pctCT}% T</span></div>
      <i className="evalbar-mid" />
    </div>
  );
}

function inViewCone(from: Vec2, facing: number, to: Vec2) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  return Math.abs(Math.atan2(Math.sin(a - facing), Math.cos(a - facing))) <= VISION_FOV / 2;
}

/** Grenade flight drawn as a lob from the thrower to the landing spot. */
function ThrowArc({ from, to, k, color, dashed }: { from: Vec2; to: Vec2; k: number; color: string; dashed?: boolean }) {
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  // bow the line sideways a little so it reads as a throw, not a path
  const nx = -(to.y - from.y) / (d || 1), ny = (to.x - from.x) / (d || 1);
  const c = { x: mx + nx * d * 0.18, y: my + ny * d * 0.18 };
  return (
    <Arrow points={[from.x, from.y, c.x, c.y, to.x, to.y]} tension={0.5} stroke={color} fill={color}
      strokeWidth={1.6 * k} dash={dashed ? [2 * k, 3 * k] : [6 * k, 3 * k]} pointerLength={5 * k} pointerWidth={5 * k} opacity={0.9} />
  );
}

/** Small marks every 5 s along a route so timings can be read off the map. */
function RouteTicks({ route, k, color }: { route: BakedRoute; k: number; color: string }) {
  const marks: Vec2[] = [];
  const first = Math.ceil(route.start / 5) * 5 || 5;
  for (let t = first; t < route.end; t += 5) {
    let i = 1;
    while (route.times[i] < t) i++;
    const f = (t - route.times[i - 1]) / (route.times[i] - route.times[i - 1] || 1);
    const a = route.pts[i - 1], b = route.pts[i];
    marks.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return <>{marks.map((m, i) => <Circle key={i} x={m.x} y={m.y} radius={1.8 * k} fill="#fff" stroke={color} strokeWidth={1 * k} />)}</>;
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Red (bad spot) → yellow → green (good spot). */
export function killColor(v: number) {
  const [r, g, b] = killRGB(v);
  return `rgb(${r},${g},${b})`;
}
function killRGB(v: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, v));
  return x < 0.5 ? [230, Math.round(60 + 340 * x), 50] : [Math.round(230 - 300 * (x - 0.5)), 230, Math.round(50 + 60 * (x - 0.5))];
}

/** Spot scores as a smooth red→green field over the area the selected CT can reach in time. */
function spotCanvas(engine: TacticalEngine, sp: SpotMap) {
  const g = engine.grid;
  const lo = document.createElement('canvas');
  lo.width = g.w; lo.height = g.h;
  const lctx = lo.getContext('2d')!;
  const img = lctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const v = sp.value[i];
    if (Number.isNaN(v)) continue;
    img.data.set([...killRGB(v), 150], i * 4);
  }
  lctx.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.filter = 'blur(2px)';
  ctx.drawImage(lo, 0, 0, 1024, 1024);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(floorMask(engine), 0, 0, 1024, 1024);
  return c;
}

/**
 * Territory map: smooth CT-blue / T-orange ground (stronger = firmer hold), slightly brighter
 * where someone is watching, clipped to the floor, with a crisp yellow front line on top.
 */
function controlCanvas(engine: TacticalEngine, control: ControlMap) {
  const g = engine.grid;
  const SIZE = 1024;
  // 1. territory at grid resolution
  const lo = document.createElement('canvas');
  lo.width = g.w; lo.height = g.h;
  const lctx = lo.getContext('2d')!;
  const img = lctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const o = control.owner[i];
    if (!g.walk[i] || Number.isNaN(o)) continue;
    const ct = o >= 0;
    const strength = Math.abs(o);
    const eyes = control.watched[i] & (ct ? 1 : 2) ? 1 : 0;
    const [r, gg, b] = ct ? (eyes ? [110, 185, 255] : [55, 140, 255]) : (eyes ? [255, 165, 80] : [235, 120, 35]);
    const alpha = strength < 0.15 ? 25 : Math.round(30 + 120 * strength + (eyes ? 30 : 0));
    img.data.set([r, gg, b, alpha], i * 4);
  }
  lctx.putImageData(img, 0, 0);
  // 2. upscale smoothly, then keep it on the floor only
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.filter = 'blur(3px)';
  ctx.drawImage(lo, 0, 0, SIZE, SIZE);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(floorMask(engine), 0, 0, SIZE, SIZE);
  // 3. front line
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(255, 214, 64, 0.9)';
  const cell = SIZE / g.w;
  for (let i = 0; i < g.w * g.h; i++) {
    if (!control.front[i]) continue;
    ctx.beginPath();
    ctx.arc(((i % g.w) + 0.5) * cell, (((i / g.w) | 0) + 0.5) * cell, cell * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

const maskCache = new WeakMap<TacticalEngine, HTMLCanvasElement>();
/** Walkable floor as an opaque mask (slightly softened so the territory edge isn't jagged). */
function floorMask(engine: TacticalEngine) {
  let m = maskCache.get(engine);
  if (m) return m;
  const g = engine.grid;
  const lo = document.createElement('canvas');
  lo.width = g.w; lo.height = g.h;
  const ctx = lo.getContext('2d')!;
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) if (g.walk[i]) img.data.set([255, 255, 255, 255], i * 4);
  ctx.putImageData(img, 0, 0);
  m = document.createElement('canvas');
  m.width = 1024; m.height = 1024;
  const mctx = m.getContext('2d')!;
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(lo, 0, 0, 1024, 1024);
  maskCache.set(engine, m);
  return m;
}

/** Id of the board item nearest to p, within `radius` (radar px) of its edge. Players win ties over utility. */
function pickItem(
  b: BoardState, p: Vec2, radius: number, tokenR: number, utilR: (u: Utility) => number, route: (pl: Player) => BakedRoute | null,
): string | null {
  let best: string | null = null, bestD = Infinity;
  const consider = (id: string, d: number) => { if (d < radius && d < bestD) { best = id; bestD = d; } };
  const dist = (a: Vec2) => Math.hypot(a.x - p.x, a.y - p.y);
  for (const pl of b.players) consider(pl.id, Math.max(0, dist(pl.pos) - tokenR) - 0.01);
  for (const pl of b.players) {
    const r = route(pl);
    if (r) for (let i = 0; i < r.pts.length - 1; i++) consider(`route:${pl.id}`, distToSegment(p, r.pts[i], r.pts[i + 1]) + 0.2);
  }
  for (const u of b.utility) consider(u.id, Math.max(0, dist(u.pos) - utilR(u)) + 0.5);
  return best;
}

/** Pointer readout; tracks the mouse itself so the board doesn't re-render on every move. */
function Coords({ stageRef, engine, spots }: { stageRef: React.RefObject<Konva.Stage>; engine: TacticalEngine; spots: SpotMap | null }) {
  const [p, setP] = useState<Vec2 | null>(null);
  useEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    let raf = 0;
    st.on('mousemove.coords', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setP(st.getRelativePointerPosition()));
    });
    st.on('mouseleave.coords', () => setP(null));
    return () => { st.off('.coords'); cancelAnimationFrame(raf); };
  }, [stageRef]);
  if (!p) return null;
  const w = radarToWorld(p, engine.map.radar);
  const t = engine.grid.at(engine.tTime, p), ct = engine.grid.at(engine.ctTime, p);
  const walk = engine.grid.isWalkable(p);
  return (
    <div className="coords">
      world {w.x.toFixed(0)}, {w.y.toFixed(0)}
      {walk && <> · <span style={{ color: COLORS.T }}>T {t.toFixed(1)}s</span> · <span style={{ color: COLORS.CT }}>CT {ct.toFixed(1)}s</span></>}
      {walk && spots && (() => {
        const v = spots.value[engine.grid.idx(p)];
        return Number.isNaN(v) ? null : <> · <b style={{ color: killColor(v) }}>spot score {Math.round(v * 100)}</b></>;
      })()}
    </div>
  );
}

/** Who controls each cell at round time t: whichever side can get there first. */
function timingCanvas(engine: TacticalEngine, time: number) {
  const g = engine.grid;
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    if (!g.walk[i]) continue;
    const t = engine.tTime[i], ct = engine.ctTime[i];
    const tIn = t <= time, ctIn = ct <= time;
    if (!tIn && !ctIn) continue;
    const tWins = tIn && (!ctIn || t < ct);
    const [r, gg, b] = tWins ? [232, 163, 60] : [78, 163, 255];
    const edge = Math.abs(t - ct) < 1.2 && tIn && ctIn; // contested band
    img.data.set(edge ? [255, 80, 80, 200] : [r, gg, b, 110], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Debug view of what the engine treats as walkable floor. */
function walkableCanvas(engine: TacticalEngine) {
  const g = engine.grid;
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) img.data.set(g.walk[i] ? [61, 220, 132, 90] : [255, 60, 60, 0], i * 4);
  ctx.putImageData(img, 0, 0);
  return c;
}

function useRadarImage(src?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!src) return;
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);
  return img;
}

export function threatColor(x: number) {
  if (x > 0.66) return TOK.bad;
  if (x > 0.4) return '#ffb020';
  return TOK.good;
}

function toolHint(t: string) {
  switch (t) {
    case 'select': return 'Drag to move · right-click sends the selected player there · click the white dot (or [ ]) to turn · pinch zooms';
    case 'ct': case 't': return 'Click on the map to place a player (max 5 per side)';
    case 'path': return 'Route: click a player, then click where they should go (Shift+click for waypoints)';
    case 'lineup': return 'Line-up: click where you stand to throw, then where it lands, then fill in the form on the left';
    case 'erase': return 'Click or drag over players, utility and routes to delete them (red = will be deleted)';
    default: return 'Click to place utility. It is thrown at the current round time on the slider';
  }
}

import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Arrow, Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text, Wedge } from 'react-konva';
import type { ControlMap } from '../engine/control';
import { FOV, type Analysis, type TacticalEngine } from '../engine/predict';
import { activeSmokes, distToSegment, SMOKE_RADIUS_UNITS } from '../engine/grid';
import { radarToWorld } from '../engine/coords';
import { simStateAt, type Simulation } from '../engine/combat';
import type { BatchStats } from '../engine/batch';
import type { SpotMap } from '../engine/spots';
import { evalAt, GRADE_INFO, isMarked, TAG_INFO, type Review } from '../engine/recap';
import { gunOf } from '../engine/guns';
import { NadeAtLanding, NadeFlight } from './Nades';
import { MomentNav } from './Recap';
import { LayersBar } from './Layers';
import { PlaybackBar, RoundHud } from './Playback';
import { FOV as VISION_FOV } from '../engine/predict';
import { ENTRY_COLOR, entryClock, entryReports } from '../engine/entries';
import { BUILTIN_LINEUPS } from '../map/lineups';
import { bakeRoute, liveState, type BakedRoute } from '../engine/timeline';
import type { BoardState, Player, Utility, Vec2 } from '../engine/types';
import { useStore } from '../store';

Konva.dragDistance = 4;

const COLORS = { T: '#e8a33c', CT: '#4ea3ff', bg: '#0f1216' };
const TOKEN_R = 11;
const PICK_SCREEN_PX = 14;
const ERASE = '#ff4d4d';
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
  const s = useStore();
  // Tokens keep roughly the same on-screen size at any zoom.
  const k = Math.min(2.6, Math.max(0.7, 1.3 / view.scale));
  const utilR = (u: Utility) =>
    u.type === 'smoke' ? SMOKE_RADIUS_UNITS / UNITS_PER_PX : u.type === 'molotov' ? 120 / UNITS_PER_PX : u.type === 'he' ? 8 * k : 7 * k;

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
      const scale = Math.min(w, h) / 1024 * 0.98;
      setView({ scale, x: (w - 1024 * scale) / 2, y: (h - 1024 * scale) / 2 });
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

  const fit = () => {
    const scale = (Math.min(size.w, size.h) / 1024) * 0.98;
    setView({ scale, x: (size.w - 1024 * scale) / 2, y: (size.h - 1024 * scale) / 2 });
  };

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
  // review: each grenade's grade (not 'book'), shown on the grenade itself
  const nadeGrades = useMemo(() => new Map((recap?.moves ?? []).filter(m => m.util && m.grade !== 'book').map(m => [m.util!, m.grade])), [recap]);
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
        draggable={s.tool === 'select'}
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
          {s.overlays.callouts && MAP.callouts.map(c => (
            <Text key={c.name} text={c.name} x={c.pos.x - 60} y={c.pos.y - (c.size ?? 10) / 2} width={120} align="center"
              fontSize={c.size ?? 10} fill="#fff" stroke="#000" strokeWidth={2.5} fillAfterStrokeEnabled fontStyle="bold" opacity={0.6} />
          ))}
          {visionLayer && visionLayer.cones.map(v => (
            <Line key={`vis-${v.id}`} points={v.poly} closed fill={v.side === 'CT' ? 'rgba(78,163,255,0.13)' : 'rgba(232,163,60,0.13)'}
              stroke={v.side === 'CT' ? 'rgba(78,163,255,0.5)' : 'rgba(232,163,60,0.5)'} strokeWidth={0.7 * k} />
          ))}
          {visionLayer && visionLayer.spotted.map((l, i) => (
            <Line key={`spot-${i}`} points={[l.a.x, l.a.y, l.b.x, l.b.y]} stroke="#ff4d4d" strokeWidth={1.4 * k} dash={[5 * k, 3 * k]} opacity={0.85} />
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
                  <Rect width={w} height={pressure ? 39 : 28} cornerRadius={4} fill="#0b0e12" opacity={0.86} stroke={col} strokeWidth={1.2} />
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
                <Text x={end.x + 6 * k} y={end.y - 14 * k} text={`${p.label} · ${fmtTime(r.end)}${r.unreachable ? ' ⚠' : ''}`} fontSize={9 * k}
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
              <Circle x={l.from.x} y={l.from.y} radius={3 * k} fill="#ffd23f" stroke="#000" strokeWidth={0.8 * k} />
              <Text x={l.to.x + 5 * k} y={l.to.y - 5 * k} text={l.name} fontSize={8 * k} fill="#fff" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled />
            </Group>
          ))}
          {s.board.utility.filter(u => u.from || u.path).map(u => <NadeFlight key={`fly-${u.id}`} u={u} t={s.time} k={k} />)}
          {s.tool === 'lineup' && s.draftLineup?.from && (
            <Group listening={false}>
              <Circle x={s.draftLineup.from.x} y={s.draftLineup.from.y} radius={4 * k} fill="#ffd23f" stroke="#000" strokeWidth={1 * k} />
              {(s.draftLineup.to ?? hover) && <ThrowArc from={s.draftLineup.from} to={(s.draftLineup.to ?? hover)!} k={k} color="#ffd23f" />}
            </Group>
          )}
          {s.board.utility.map(u => {
            const doomed = eraseTarget === u.id;
            return (
              <Group key={u.id} x={u.pos.x} y={u.pos.y} draggable={s.tool === 'select' && !carry} opacity={carry === u.id ? 0.35 : 1}
                onDblClick={e => { e.cancelBubble = true; pickUp(u.id); }} onDblTap={e => { e.cancelBubble = true; pickUp(u.id); }}
                onDragEnd={e => s.move(u.id, { x: e.target.x(), y: e.target.y() })}
                onClick={e => { e.cancelBubble = true; if (aiming) commitAim(); else if (carry) { const q = pointer(); if (q) drop(q); } else if (s.tool === 'select') s.select(u.id); }}>
                <NadeAtLanding u={u} t={s.time} k={k} unitsPerPx={UNITS_PER_PX} selected={s.selectedId === u.id} doomed={doomed} editable={s.mode !== 'review'} grade={nadeGrades.get(u.id)} />
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
              <Group key={`dead-${p.id}`} x={p.pos.x} y={p.pos.y} scaleX={k} scaleY={k} listening={false} opacity={0.8}>
                <Circle radius={TOKEN_R * 0.85} fill="#2a2f36" stroke={COLORS[p.side]} strokeWidth={1.5} />
                <Line points={[-5, -5, 5, 5]} stroke={COLORS[p.side]} strokeWidth={2.2} lineCap="round" />
                <Line points={[-5, 5, 5, -5]} stroke={COLORS[p.side]} strokeWidth={2.2} lineCap="round" />
                <Text text={p.label} fontSize={8} fill={COLORS[p.side]} x={7} y={-12} fontStyle="bold" />
              </Group>
            );
          })}
          {s.board.players.filter(p => !isDead(p)).map(lp => {
            const p = livePlayer(lp);
            const moved = displaced(lp);
            return (
            <Group key={p.id} x={p.pos.x} y={p.pos.y} draggable={s.tool === 'select' && !carry && !moved} opacity={carry === p.id ? 0.35 : 1}
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
                <Wedge radius={34} angle={FOV_DEG} rotation={deg(p.facing ?? engine.facing(p)) - FOV_DEG / 2} listening={false}
                  fill={COLORS[p.side]} opacity={p.facing === undefined ? 0.22 : 0.38} />
                {(hoverPlayer === p.id || s.draftRoute?.playerId === p.id) && s.tool === 'path' && (
                  <Circle radius={TOKEN_R + 5} stroke="#fff" strokeWidth={2} dash={[4, 3]} listening={false} />
                )}
                {live.get(lp.id)?.blind && (
                  <Circle radius={TOKEN_R + 6} fill="rgba(255,246,168,0.55)" stroke="#fff6a8" strokeWidth={2} listening={false} />
                )}
                {(live.get(lp.id)?.hp ?? 100) < 100 && (
                  <Arc innerRadius={TOKEN_R + 1.5} outerRadius={TOKEN_R + 4} angle={(360 * (live.get(lp.id)!.hp)) / 100} rotation={-90}
                    fill={live.get(lp.id)!.hp > 50 ? '#3ddc84' : live.get(lp.id)!.hp > 25 ? '#ffb020' : '#ff4d4d'} listening={false} />
                )}
                <Circle radius={TOKEN_R} hitStrokeWidth={18} fill={eraseTarget === p.id ? ERASE : COLORS[p.side]}
                  stroke={s.selectedId === p.id ? '#fff' : '#000a'} strokeWidth={s.selectedId === p.id ? 2.5 : 1.5} />
                <Text text={p.label} fontSize={11} fontStyle="bold" fill="#0d0f12" width={22} x={-11} y={-5.5} align="center" />
                {s.mode === 'review' && s.review && <Text text={s.review.data.names[p.id] ?? ''} fontSize={7} fill="#c8ced8" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled width={60} x={-30} y={21} align="center" fontStyle="bold" listening={false} />}
                {s.overlays.playerInfo && <Text text={gunOf(p).short} fontSize={7} fill={gunOf(p).cls === 'awp' ? '#ffd23f' : '#fff'} stroke="#000" strokeWidth={2} fillAfterStrokeEnabled
                  width={40} x={-20} y={13} align="center" fontStyle="bold" listening={false} />}
                {s.overlays.playerInfo && batch?.players[p.id] && (
                  <Text text={`${Math.round(batch.players[p.id].pKill * 100)}% K`} fontSize={8} fontStyle="bold" width={40} x={-20} y={s.mode === 'review' ? 29 : 21} align="center"
                    fill={killColor(batch.players[p.id].pKill)} stroke="#000" strokeWidth={2.2} fillAfterStrokeEnabled />
                )}
              </Group>
            </Group>
            );
          })}
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
              <Circle radius={9 * k} fill="#ffd23f" stroke="#000" strokeWidth={1.5 * k} shadowColor="#000" shadowBlur={5} shadowOpacity={0.6} />
              <Text text={String(i + 1)} fontSize={11 * k} fontStyle="bold" fill="#111" width={18 * k} x={-9 * k} y={-5.5 * k} align="center" />
              <Group x={11 * k} y={-8 * k} scaleX={k * 0.75} scaleY={k * 0.75}>
                <Rect width={86} height={20} cornerRadius={4} fill="#0b0e12" opacity={0.88} stroke="#ffd23f" strokeWidth={1} />
                <Text x={5} y={5} text={`${sp.score} · ${sp.where || 'here'}`} fontSize={9.5} fontStyle="bold" fill="#ffd23f" width={80} wrap="none" ellipsis />
              </Group>
            </Group>
          ))}
          {spots?.current && (() => {
            const pl = s.board.players.find(q => q.id === spots.playerId);
            if (!pl) return null;
            return (
              <Group x={pl.pos.x} y={pl.pos.y} listening={false}>
                <Circle radius={17 * k} stroke="#ffd23f" strokeWidth={1.5 * k} dash={[4 * k, 3 * k]} />
                <Text x={-40 * k} y={-30 * k} width={80 * k} align="center" fontSize={8.5 * k} fontStyle="bold" fill="#ffd23f" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled
                  text={`now: ${spots.current.score}${spots.currentRank ? ` · #${spots.currentRank}` : ''}`} />
              </Group>
            );
          })()}
          {recap && sim && recap.moves.filter(m => isMarked(m) && s.time >= m.t && s.time - m.t < BADGE_SECS).map((m, i) => {
            const pi = sim.ids.indexOf(m.player);
            if (pi < 0) return null;
            const step = Math.min(sim.steps - 1, Math.round((m.kind === 'death' ? m.t : s.time) / 0.1));
            const g = GRADE_INFO[m.grade];
            const age = (s.time - m.t) / BADGE_SECS;
            return (
              <Group key={`badge-${i}`} x={sim.x[pi][step] + 13 * k} y={sim.y[pi][step] - 13 * k} listening={false}
                opacity={age < 0.8 ? 1 : (1 - age) * 5} scaleX={age < 0.06 ? 0.6 + age * 7 : 1} scaleY={age < 0.06 ? 0.6 + age * 7 : 1}>
                <Circle radius={9 * k} fill={g.color} stroke="#000" strokeWidth={1.5 * k} shadowColor="#000" shadowBlur={4} shadowOpacity={0.5} />
                <Text text={g.mark} fontSize={(g.mark.length > 1 ? 9 : 11) * k} fontStyle="bold" fill="#111" width={18 * k} x={-9 * k} y={-5 * k} align="center" />
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
      <Coords stageRef={stageRef} engine={engine} spots={spots} />
      <LayersBar />
      <RoundHud
        ctAlive={s.board.players.filter(p => p.side === 'CT' && live.get(p.id)?.alive !== false).length}
        tAlive={s.board.players.filter(p => p.side === 'T' && live.get(p.id)?.alive !== false).length} />
      <PlaybackBar end={timelineEnd} />
      <div className="zoom">
        <button onClick={() => zoomAt(1.25)} title="Zoom in (pinch, or ⌘ + scroll)">+</button>
        <button onClick={() => zoomAt(0.8)} title="Zoom out">−</button>
        <button onClick={fit} title="Fit map">Fit</button>
      </div>
      {recap && <EvalBar ct={evalAt(recap.curve, s.time)} />}
      {recap && (
        <button className={`reveal-float ${s.reviewSpoilers ? 'on' : ''}`} onClick={() => s.setReviewSpoilers(!s.reviewSpoilers)} title="Shortcut: R">
          {s.reviewSpoilers ? '◀ Live' : '⏭ Reveal all'}
        </button>
      )}
      {recap && <MoveBanner recap={recap} time={s.time} />}
      {recap && <MomentNav recap={recap} />}
      <div className={`hint ${s.notice ? 'notice' : aiming || carry || s.draftRoute ? 'carry' : ''}`} style={recap ? { display: 'none' } : undefined}>
        {s.notice ?? (aiming ? 'Move the mouse to aim · click to set the direction · Esc cancels'
          : carry ? 'Click where to put it · Esc cancels'
          : s.draftRoute
            ? s.autoRoute
              ? `Route for ${draftLabel}: click the destination (Shift+click adds waypoints) · Esc cancels`
              : `Route for ${draftLabel}: click waypoints · double-click or Enter to finish · Esc cancels`
            : toolHint(s.tool))}
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
        fill={aiming ? '#ffd23f' : '#fff'} stroke="#000" strokeWidth={1.5 * k} draggable={!aiming} listening={!aiming}
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

/** Chess.com-style eval bar: CT share from the bottom, T from the top. */
function EvalBar({ ct }: { ct: number }) {
  const pctCT = Math.round(ct * 100);
  return (
    <div className="evalbar" title={`CT ${pctCT}% · T ${100 - pctCT}%`}>
      <div className="evalbar-t" style={{ height: `${100 - ct * 100}%` }}><span>{100 - pctCT}</span></div>
      <div className="evalbar-ct" style={{ height: `${ct * 100}%` }}><span>{pctCT}</span></div>
    </div>
  );
}

/** The latest graded move, announced over the board as it happens. */
function MoveBanner({ recap, time }: { recap: Review; time: number }) {
  const m = [...recap.moves].reverse().find(x => isMarked(x) && time >= x.t && time - x.t < BADGE_SECS);
  if (!m) return null;
  const g = GRADE_INFO[m.grade];
  return (
    <div className="move-banner" key={`${m.t}-${m.player}-${m.kind}`} style={{ borderColor: g.color }}>
      <span className="badge" style={{ background: g.color }}>{g.mark}</span>
      <b>{g.label}</b>
      <span>{m.title}</span>
      {m.tags.slice(0, 3).map(t => <span key={t} className="tag" style={{ color: TAG_INFO[t].color, borderColor: TAG_INFO[t].color }}>{t}</span>)}
      <b style={{ color: m.gain >= 0 ? '#7fbf4d' : '#e5483a' }}>{m.gain >= 0 ? '+' : '−'}{Math.abs(Math.round(m.gain * 100))}%</b>
    </div>
  );
}

const UTIL_COLOR: Record<Utility['type'], string> = { smoke: '#c9d1d9', flash: '#fff6a8', molotov: '#ff5a1f', he: '#7bd88f' };

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
  if (x > 0.66) return '#ff4d4d';
  if (x > 0.4) return '#ffb020';
  return '#3ddc84';
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

import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Arrow, Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text, Wedge } from 'react-konva';
import { CTL_COLORS, type ControlMap } from '../engine/control';
import { FOV, type Analysis, type TacticalEngine } from '../engine/predict';
import { activeSmokes, distToSegment, MOLLY_DURATION, popAt, SMOKE_DURATION, SMOKE_RADIUS_UNITS } from '../engine/grid';
import { radarToWorld } from '../engine/coords';
import { HE_RADIUS_U, simStateAt, type Simulation } from '../engine/combat';
import type { BatchStats } from '../engine/batch';
import type { KillMap } from '../engine/killmap';
import type { KillMetric } from '../store';
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

export function Board({ analysis, engine, control, sim, killMap, batch }: {
  analysis: Analysis; engine: TacticalEngine; control: ControlMap | null; sim: Simulation | null; killMap: KillMap | null; batch: BatchStats | null;
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
    const t = setTimeout(() => useStore.setState({ notice: null }), 2500);
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
  const losPoly = useMemo(
    () => (selected && s.overlays.los ? engine.grid.visibilityPolygon(selected.pos, smokesNow, [engine.facing(selected), FOV]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, selected?.pos.x, selected?.pos.y, selected?.facing, s.overlays.los, JSON.stringify(smokesNow)],
  );
  const timingImg = useMemo(() => (s.overlays.timing ? timingCanvas(engine, s.time) : null), [engine, s.overlays.timing, s.time]);
  const controlImg = useMemo(() => (control ? controlCanvas(engine, control) : null), [engine, control]);
  const killImg = useMemo(() => (killMap ? killMapCanvas(engine, killMap, s.killMetric) : null), [engine, killMap, s.killMetric]);
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
          {controlImg && <KImage image={controlImg} width={1024} height={1024} listening={false} />}
          {killImg && <KImage image={killImg} width={1024} height={1024} listening={false} />}
          {walkImg && <KImage image={walkImg} width={1024} height={1024} imageSmoothingEnabled={false} opacity={0.6} listening={false} />}
          {timingImg && <KImage image={timingImg} width={1024} height={1024} imageSmoothingEnabled={false} opacity={0.75} listening={false} />}
        </Layer>

        <Layer listening={false}>
          {s.overlays.callouts && MAP.callouts.map(c => (
            <Text key={c.name} text={c.name} x={c.pos.x - 60} y={c.pos.y - (c.size ?? 10) / 2} width={120} align="center"
              fontSize={c.size ?? 10} fill="#fff" stroke="#000" strokeWidth={2.5} fillAfterStrokeEnabled fontStyle="bold" opacity={0.85} />
          ))}
          {losPoly && <Line points={losPoly} closed fill="rgba(78,163,255,0.13)" stroke="rgba(78,163,255,0.45)" strokeWidth={0.8} />}
          {s.overlays.threat && analysis.chokes.map(c => {
            const col = threatColor(c.threat);
            const [a, b] = c.choke.portal;
            const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return (
              <Group key={c.choke.id}>
                <Circle x={m.x} y={m.y} radius={14 + c.threat * 16} fill={col} opacity={0.18} />
                <Line points={[a.x, a.y, b.x, b.y]} stroke={col} strokeWidth={4} lineCap="round" />
                <Text x={m.x - 30} y={m.y + 10} width={60} align="center" fontSize={9} fill={col} fontStyle="bold"
                  text={`${Math.round(c.threat * 100)}% · ${c.tArrival.min.toFixed(0)}s`} />
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
          {s.board.utility.filter(u => u.from && s.time <= popAt(u) + 0.5).map(u => (
            <Group key={`arc-${u.id}`} listening={false}>
              <ThrowArc from={u.from!} to={u.pos} k={k} color={UTIL_COLOR[u.type]} />
              <Circle x={u.from!.x} y={u.from!.y} radius={3.5 * k} fill="#ffd23f" stroke="#000" strokeWidth={0.8 * k} />
            </Group>
          ))}
          {s.tool === 'lineup' && s.draftLineup?.from && (
            <Group listening={false}>
              <Circle x={s.draftLineup.from.x} y={s.draftLineup.from.y} radius={4 * k} fill="#ffd23f" stroke="#000" strokeWidth={1 * k} />
              {(s.draftLineup.to ?? hover) && <ThrowArc from={s.draftLineup.from} to={(s.draftLineup.to ?? hover)!} k={k} color="#ffd23f" />}
            </Group>
          )}
          {s.board.utility.map(u => {
            const active = isUtilActive(u, s.time);
            const fill = u.type === 'smoke' ? '#c9d1d9' : u.type === 'molotov' ? '#ff5a1f' : u.type === 'he' ? '#7bd88f' : '#fff6a8';
            const boom = u.type === 'he' && s.time >= popAt(u) && s.time < popAt(u) + 0.6;
            const doomed = eraseTarget === u.id;
            return (
              <Group key={u.id} x={u.pos.x} y={u.pos.y} draggable={s.tool === 'select' && !carry} opacity={carry === u.id ? 0.35 : 1}
                onDblClick={e => { e.cancelBubble = true; pickUp(u.id); }} onDblTap={e => { e.cancelBubble = true; pickUp(u.id); }}
                onDragEnd={e => s.move(u.id, { x: e.target.x(), y: e.target.y() })}
                onClick={e => { e.cancelBubble = true; if (aiming) commitAim(); else if (carry) { const q = pointer(); if (q) drop(q); } else if (s.tool === 'select') s.select(u.id); }}>
                <Circle radius={utilR(u)} fill={doomed ? ERASE : fill} opacity={doomed ? 0.6 : active ? 0.55 : 0.15}
                  stroke={doomed ? ERASE : fill} strokeWidth={(s.selectedId === u.id ? 2 : 1) * k} dash={active ? undefined : [4 * k, 3 * k]} />
                {boom && <Circle radius={HE_RADIUS_U / UNITS_PER_PX} stroke="#ffb020" strokeWidth={3 * k} fill="rgba(255,176,32,0.18)" listening={false} />}
                <Text text={u.type === 'smoke' ? 'S' : u.type === 'molotov' ? 'M' : u.type === 'he' ? 'H' : 'F'} fontSize={9 * k} x={-3 * k} y={-4.5 * k} fill="#111" fontStyle="bold" />
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
                {s.review && <Text text={s.review.data.names[p.id] ?? ''} fontSize={7} fill="#fff" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled width={60} x={-30} y={13} align="center" fontStyle="bold" />}
                {p.weapon === 'awp' && <Text text="AWP" fontSize={7} fill="#fff" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled width={30} x={-15} y={13} align="center" fontStyle="bold" />}
                {batch?.players[p.id] && (
                  <Text text={`${Math.round(batch.players[p.id].pKill * 100)}% K`} fontSize={8} fontStyle="bold" width={40} x={-20} y={p.weapon === 'awp' ? 21 : 13} align="center"
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
      <Coords stageRef={stageRef} engine={engine} killMap={killMap} />
      <div className="zoom">
        <button onClick={() => zoomAt(1.25)} title="Zoom in (pinch, or ⌘ + scroll)">+</button>
        <button onClick={() => zoomAt(0.8)} title="Zoom out">−</button>
        <button onClick={fit} title="Fit map">Fit</button>
      </div>
      <div className={`hint ${s.notice ? 'notice' : aiming || carry || s.draftRoute ? 'carry' : ''}`}>
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

const UTIL_COLOR: Record<Utility['type'], string> = { smoke: '#c9d1d9', flash: '#fff6a8', molotov: '#ff5a1f', he: '#7bd88f' };

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

function killMapCanvas(engine: TacticalEngine, km: KillMap, metric: KillMetric) {
  const g = engine.grid;
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.w, g.h);
  const arr = km[metric];
  for (let i = 0; i < g.w * g.h; i++) {
    if (!g.walk[i]) continue;
    const v = arr[i];
    if (Number.isNaN(v)) { img.data.set([120, 130, 140, 40], i * 4); continue; }
    img.data.set([...killRGB(metric === 'expKills' ? v / 1.5 : v), 140], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function controlCanvas(engine: TacticalEngine, control: ControlMap) {
  const g = engine.grid;
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const col = CTL_COLORS[control.cls[i] as keyof typeof CTL_COLORS];
    if (col) img.data.set(col, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
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
function Coords({ stageRef, engine, killMap }: { stageRef: React.RefObject<Konva.Stage>; engine: TacticalEngine; killMap: KillMap | null }) {
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
      {walk && killMap && (() => {
        const i = engine.grid.idx(p);
        const pk = killMap.pKill[i];
        return Number.isNaN(pk)
          ? <> · <span className="muted">no T in sight from here</span></>
          : <> · <b style={{ color: killColor(pk) }}>CT here: {Math.round(pk * 100)}% kill</b> · {killMap.expKills[i].toFixed(2)} exp. kills · {Math.round(killMap.survive[i] * 100)}% survive</>;
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

function isUtilActive(u: Utility, t: number) {
  if (u.type === 'he') return t < popAt(u) + 0.6;
  const dur = u.type === 'smoke' ? SMOKE_DURATION : u.type === 'molotov' ? MOLLY_DURATION : 0.5;
  return t >= popAt(u) && t <= popAt(u) + dur;
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

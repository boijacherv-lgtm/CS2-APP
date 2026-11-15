import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Circle, Group, Image as KImage, Layer, Rect, RegularPolygon, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { BUILDINGS, campIcon, CAMPS, mapImage, SIGHTS, TEAM_COLOR, TREES, type Building, type MapStyle, type Pt } from './data';

/** Hero icons loaded once (Steam's image server doesn't allow reading them back, and nothing here needs to). */
export function useImages(urls: (string | null)[]) {
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement>>({});
  const key = urls.filter(Boolean).join('|');
  useEffect(() => {
    for (const u of urls) {
      if (!u || imgs[u]) continue;
      const i = new window.Image();
      i.onload = () => setImgs(m => ({ ...m, [u]: i }));
      i.src = u;
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return imgs;
}

function BuildingMark({ b, S, k, up }: { b: Building; S: number; k: number; up: boolean }) {
  const c = TEAM_COLOR[b.team], at = { x: b.x * S, y: b.y * S };
  const stroke = up ? '#0b0e12' : c, fill = up ? c : 'rgba(11, 14, 18, .75)';
  if (b.kind === 'fort') return <RegularPolygon {...at} sides={6} radius={11 * k} fill={fill} stroke={stroke} strokeWidth={1.6 * k} />;
  if (b.kind === 'rax') return <Rect x={at.x - 3.5 * k} y={at.y - 3.5 * k} width={7 * k} height={7 * k} fill={fill} stroke={stroke} strokeWidth={1 * k} />;
  return <RegularPolygon {...at} sides={4} radius={6.5 * k} fill={fill} stroke={stroke} strokeWidth={1.2 * k} />;
}

/** Each side's pines: outline, shaded side, lit side. */
const PINE = [['#0c1a10', '#2c6b38', '#4f9a4e'], ['#11131c', '#39435f', '#5d6a8c']];

/** A forest of small pines, drawn rather than pictured so they stay sharp under zoom. */
function Trees({ S, k }: { S: number; k: number }) {
  const draw = useCallback((ctx: Konva.Context) => {
    const w = 4.6 * k, h = 6.4 * k;
    const half = (x: number, y: number, side: number, grow: number) => {
      ctx.moveTo(x, y - h - grow);
      ctx.lineTo(x + side * (w * 0.68 + grow), y - h * 0.25);
      ctx.lineTo(x + side * (w * 0.42 + grow), y - h * 0.25);
      ctx.lineTo(x + side * (w + grow), y + h * 0.55 + grow);
      ctx.lineTo(x, y + h * 0.55 + grow);
      ctx.closePath();
    };
    for (const [tx, ty, dire] of TREES) {
      const x = (tx / 1000) * S, y = (ty / 1000) * S, c = PINE[dire];
      ctx.beginPath(); half(x, y, -1, 0.9 * k); half(x, y, 1, 0.9 * k); ctx.fillStyle = c[0]; ctx.fill();
      ctx.beginPath(); half(x, y, 1, 0); ctx.fillStyle = c[1]; ctx.fill();
      ctx.beginPath(); half(x, y, -1, 0); ctx.fillStyle = c[2]; ctx.fill();
    }
  }, [S, k]);
  return <Shape sceneFunc={draw} listening={false} />;
}

/** The neutral camps with the game's own mark for each tier, faint while it stands empty. Without `counts`, simply where they are. */
export function drawCamps(ctx: Konva.Context, S: number, k: number, icons: Record<string, HTMLImageElement>, counts?: number[]) {
  const size = 15 * k;
  CAMPS.forEach((c, i) => {
    const icon = icons[campIcon(c.tier)];
    if (!icon) return;
    ctx.globalAlpha = counts?.[i] === 0 ? 0.3 : 1;
    ctx.drawImage(icon, c.x * S - size / 2, c.y * S - size / 2, size, size);
  });
  ctx.globalAlpha = 1;
}

const SIGHT_ICONS = [campIcon('wisdom'), campIcon('lotus')];
const SIGHT_COLOR = { gate: '#b79cff', wisdom: '#ffd76a', lotus: '#ff9ccf' };

/** The Twin Gates, Wisdom fountains and Lotus Pools, marked and named. The Twin Gates have no mark to borrow: a drawn portal. */
function Sights({ S, k }: { S: number; k: number }) {
  const icons = useImages(SIGHT_ICONS);
  return (
    <Group listening={false}>
      {SIGHTS.map(s => {
        const icon = s.kind === 'gate' ? undefined : icons[campIcon(s.kind)];
        return (
          <Group key={`${s.kind}${s.at.x}`} x={inside(s.at.x) * S} y={inside(s.at.y) * S}>
            <Circle radius={9 * k} fill="#0b0e12" opacity={0.72} stroke={SIGHT_COLOR[s.kind]} strokeWidth={1.1 * k} />
            {s.kind === 'gate' && <>
              <Circle radius={5.2 * k} stroke={SIGHT_COLOR.gate} strokeWidth={1.6 * k} />
              <Circle radius={2 * k} fill={SIGHT_COLOR.gate} />
            </>}
            {icon && <KImage image={icon} x={-7.5 * k} y={-7.5 * k} width={15 * k} height={15 * k} />}
            <Text text={s.name} x={-40 * k} y={10.5 * k} width={80 * k} align="center" fontSize={Math.max(8, 8 * k)} fontStyle="bold" fill={SIGHT_COLOR[s.kind]} stroke="#000" strokeWidth={2 * k} fillAfterStrokeEnabled />
          </Group>
        );
      })}
    </Group>
  );
}
/** Sights at the very edge still have to fit their mark and name. */
const inside = (v: number) => Math.max(0.03, Math.min(0.97, v));

/** The map image with its woods and buildings on it (hollow once down). */
function MapArt({ S, k, up, style }: { S: number; k: number; up: (uid: string) => boolean; style: MapStyle }) {
  const m = mapImage(style), img = useImages([m.src])[m.src];
  return (
    <Group listening={false}>
      <Rect width={S} height={S} fill="#141a1f" />
      {img && <KImage image={img} x={m.x * S} y={m.y * S} width={m.w * S} height={m.h * S} />}
      {/* the game's own art has its trees painted in */}
      {style === 'simple' && <Trees S={S} k={k} />}
      <Sights S={S} k={k} />
      {BUILDINGS.map(b => <BuildingMark key={b.uid} b={b} S={S} k={k} up={up(b.uid)} />)}
    </Group>
  );
}

const STYLE_KEY = 'stratboard.d2.map';
const readStyle = (): MapStyle => { try { return localStorage.getItem(STYLE_KEY) === 'game' ? 'game' : 'simple'; } catch { return 'simple'; } };

/**
 * The map on a Konva stage that fills its box (square), with zoom (wheel) and pan (drag the background).
 * `children(S, k)` draws on top: S = the map's size in px, k = a scale for line widths and icons (1 at 640 px).
 */
export function D2Map({ up = () => true, children, onBackground, overlay, clickableAt }: {
  up?: (uid: string) => boolean;
  /** Whether a click at this spot would do something: shows a hand. */
  clickableAt?: (at: Pt) => boolean;
  /** Controls laid on the map itself. */
  overlay?: ReactNode;
  children: (S: number, k: number, style: MapStyle) => ReactNode;
  /** A click / tap on the map itself (not a token): where, in map coordinates (0–1). */
  onBackground?: (at: Pt) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState(600);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [style, setStyle] = useState<MapStyle>(readStyle);
  const pickStyle = (s: MapStyle) => { setStyle(s); try { localStorage.setItem(STYLE_KEY, s); } catch { /* private mode */ } };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setSize(Math.max(200, Math.min(el.clientWidth, el.clientHeight)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const S = size, k = S / 640;
  const zoom = (by: number, at: Pt) => setView(v => {
    const scale = Math.max(1, Math.min(5, v.scale * by));
    if (scale === 1) return { scale: 1, x: 0, y: 0 };
    return { scale, x: at.x - ((at.x - v.x) / v.scale) * scale, y: at.y - ((at.y - v.y) / v.scale) * scale };
  });
  const clicked = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = stage.current?.getPointerPosition();
    if (e.target.name() === 'bg' && onBackground && p) onBackground({ x: (p.x - view.x) / view.scale / S, y: (p.y - view.y) / view.scale / S });
  };
  return (
    <div className="dl-map" ref={wrap}>
      <div className="d2-map-box" style={{ width: S, height: S }}>
      <Stage ref={stage} width={S} height={S} scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
        draggable={view.scale > 1} onDragEnd={e => { if (e.target === e.target.getStage()) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })); }}
        onWheel={e => { e.evt.preventDefault(); zoom(e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, stage.current!.getPointerPosition()!); }}
        onMouseMove={e => {
          const p = stage.current?.getPointerPosition();
          if (clickableAt && p) e.target.getStage()!.container().style.cursor = clickableAt({ x: (p.x - view.x) / view.scale / S, y: (p.y - view.y) / view.scale / S }) ? 'pointer' : '';
        }}
        onClick={clicked} onTap={clicked}>
        <Layer>
          <MapArt S={S} k={k} up={up} style={style} />
          <Rect name="bg" width={S} height={S} fill="rgba(0,0,0,0.001)" />
        </Layer>
        {children(S, k, style)}
      </Stage>
      <div className="seg-mini d2-map-style" role="group" aria-label="Map">
        <button className={style === 'simple' ? 'on' : ''} onClick={() => pickStyle('simple')}>Simple</button>
        <button className={style === 'game' ? 'on' : ''} onClick={() => pickStyle('game')}>Game</button>
      </div>
      {view.scale > 1 && <button className="ghost small-btn dl-zoom-reset" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>Fit map</button>}
      {overlay}
      </div>
    </div>
  );
}

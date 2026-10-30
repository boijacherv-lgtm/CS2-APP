import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Image as KImage, Layer, Rect, RegularPolygon, Stage } from 'react-konva';
import type Konva from 'konva';
import { BUILDINGS, mapImage, TEAM_COLOR, type Building, type MapStyle, type Pt } from './data';

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

/** The map image with its buildings on it (hollow once down). */
function MapArt({ S, k, up, style }: { S: number; k: number; up: (uid: string) => boolean; style: MapStyle }) {
  const m = mapImage(style), img = useImages([m.src])[m.src];
  return (
    <Group listening={false}>
      <Rect width={S} height={S} fill="#141a1f" />
      {img && <KImage image={img} x={m.x * S} y={m.y * S} width={m.w * S} height={m.h * S} />}
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
export function D2Map({ up = () => true, children, onBackground }: {
  up?: (uid: string) => boolean;
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
    const ro = new ResizeObserver(() => setSize(Math.max(200, Math.min(el.clientWidth, el.clientHeight))));
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
      <Stage ref={stage} width={S} height={S} scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
        draggable={view.scale > 1} onDragEnd={e => { if (e.target === e.target.getStage()) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })); }}
        onWheel={e => { e.evt.preventDefault(); zoom(e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, stage.current!.getPointerPosition()!); }}
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
    </div>
  );
}

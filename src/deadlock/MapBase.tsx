import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Circle, Group, Image as KImage, Layer, Line, Rect, RegularPolygon, Stage } from 'react-konva';
import type Konva from 'konva';
import { DL_MAP, DL_MAP_IMAGE, TEAM_COLOR, type DlTeam } from './data';

/** The minimap in the site's colours: walkable ground mid-grey, buildings dark, outside clear. */
export function useThemedMap(src = DL_MAP_IMAGE) {
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.onload = () => {
      const c = document.createElement('canvas');
      c.width = i.width; c.height = i.height;
      const g = c.getContext('2d')!;
      g.drawImage(i, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      for (let k = 0; k < d.data.length; k += 4) {
        if (d.data[k + 3] < 20) continue;
        const [r, gg, b] = d.data[k] > 160 ? [24, 27, 33] : [58, 64, 74];
        d.data[k] = r; d.data[k + 1] = gg; d.data[k + 2] = b;
      }
      g.putImageData(d, 0, 0);
      setImg(c);
    };
    i.src = src;
  }, [src]);
  return img;
}
/** Hero icons (and any image URL) loaded once. */
export function useImages(urls: (string | null)[]) {
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement>>({});
  const key = urls.filter(Boolean).join('|');
  useEffect(() => {
    for (const u of urls) {
      if (!u || imgs[u]) continue;
      const i = new window.Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => setImgs(m => ({ ...m, [u]: i }));
      i.src = u;
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return imgs;
}

export type MapLayer = 'lanes' | 'objectives' | 'camps' | 'urn' | 'shops' | 'teleporters' | 'buffs';
export const LAYER_LABEL: Record<MapLayer, string> = {
  lanes: 'Lanes', objectives: 'Objectives', camps: 'Camps', urn: 'Urn', shops: 'Shops', teleporters: 'Teleporters', buffs: 'Buffs & rifts',
};

/**
 * The Deadlock map on a Konva stage that fills its box (square), with the chosen layers drawn on it, zoom (wheel,
 * pinch) and pan (drag the background). `children(S, k)` draws on top: S = the map's size in px, k = a scale for line
 * widths and icons (1 at 640 px).
 */
export function MapBase({ layers, children, onBackground }: {
  layers: Set<MapLayer>;
  children: (S: number, k: number) => ReactNode;
  /** A click / tap on the map itself (not a token): where, in map coordinates (0–1). */
  onBackground?: (at: { x: number; y: number }) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState(600);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.max(200, Math.min(el.clientWidth, el.clientHeight))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const map = useThemedMap();
  const S = size, k = S / 640;
  const P = (p: { x: number; y: number }) => ({ x: p.x * S, y: p.y * S });
  const zoom = (by: number, at: { x: number; y: number }) => setView(v => {
    const scale = Math.max(1, Math.min(5, v.scale * by));
    if (scale === 1) return { scale: 1, x: 0, y: 0 };
    return { scale, x: at.x - ((at.x - v.x) / v.scale) * scale, y: at.y - ((at.y - v.y) / v.scale) * scale };
  });
  const toMap = () => {
    const p = stage.current?.getPointerPosition();
    return p ? { x: (p.x - view.x) / view.scale / S, y: (p.y - view.y) / view.scale / S } : null;
  };
  return (
    <div className="dl-map" ref={wrap}>
      <Stage ref={stage} width={S} height={S} scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
        draggable={view.scale > 1} onDragEnd={e => { if (e.target === e.target.getStage()) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })); }}
        onWheel={e => { e.evt.preventDefault(); const p = stage.current!.getPointerPosition()!; zoom(e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, p); }}
        onClick={e => { if (e.target.name() === 'bg' && onBackground) { const at = toMap(); if (at) onBackground(at); } }}
        onTap={e => { if (e.target.name() === 'bg' && onBackground) { const at = toMap(); if (at) onBackground(at); } }}>
        <Layer>
          <Rect name="bg" width={S} height={S} fill="rgba(0,0,0,0.001)" />
          {map && <KImage name="bg" image={map} width={S} height={S} />}
        </Layer>
        <Layer listening={false}>
          {layers.has('lanes') && DL_MAP.lanes.map((l, i) => <Line key={i} points={l.pts.flatMap(p => [p.x * S, p.y * S])} stroke={l.color} strokeWidth={1.5 * k} opacity={0.5} dash={[6 * k, 5 * k]} />)}
          {layers.has('camps') && DL_MAP.camps.map((c, i) => <Circle key={`c${i}`} {...P(c)} radius={2.6 * k} fill={c.kind === 'vault' ? '#e3b341' : '#8f9aa6'} opacity={0.8} />)}
          {layers.has('urn') && [...DL_MAP.urnSpawns, ...DL_MAP.urnPads].map((u, i) => <Circle key={`u${i}`} {...P(u)} radius={3.4 * k} stroke="#c9a7ff" strokeWidth={1.2 * k} />)}
          {layers.has('shops') && DL_MAP.shops.map((s, i) => <Rect key={`s${i}`} {...P(s)} offsetX={3 * k} offsetY={3 * k} width={6 * k} height={6 * k} fill="#3fb6a8" cornerRadius={1.5 * k} />)}
          {layers.has('teleporters') && DL_MAP.teleporters.map((t, i) => <RegularPolygon key={`t${i}`} {...P(t)} sides={3} radius={4 * k} fill="#5fb0ff" />)}
          {layers.has('buffs') && [...DL_MAP.bridgeBuffs, ...DL_MAP.rifts].map((b, i) => <Circle key={`b${i}`} {...P(b)} radius={3 * k} fill="#ff7a59" />)}
          {layers.has('objectives') && DL_MAP.objectives.filter(o => o.kind !== 'core').map(o => {
            const big = o.kind === 'titan', mid = o.kind === 'tier2', r = (big ? 11 : mid ? 8 : 6) * k;
            return (
              <Group key={o.id} {...P(o)}>
                <RegularPolygon sides={big ? 6 : 4} radius={r} rotation={big ? 0 : 45} fill={TEAM_COLOR[o.team as DlTeam]} stroke="#0b0e12" strokeWidth={1.5 * k} />
              </Group>
            );
          })}
        </Layer>
        {children(S, k)}
      </Stage>
      {view.scale > 1 && <button className="ghost small-btn dl-zoom-reset" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>Fit map</button>}
    </div>
  );
}

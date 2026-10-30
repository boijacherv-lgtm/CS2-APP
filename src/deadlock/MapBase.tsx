import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Layer, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import type { DlTeam } from './data';
import { MapArt, useGameMap, useTunnels } from './MapArt';

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

export type MapLayer = 'lanes' | 'objectives' | 'camps' | 'urn' | 'shops' | 'teleporters' | 'buffs' | 'tunnels';
export const LAYER_LABEL: Record<MapLayer, string> = {
  lanes: 'Lanes', objectives: 'Objectives', camps: 'Camps', urn: 'Urn', shops: 'Shops', teleporters: 'Teleporters', buffs: 'Buffs & rifts', tunnels: 'Underpasses',
};

/**
 * The Deadlock map on a Konva stage that fills its box (square), with the chosen layers drawn on it, zoom (wheel,
 * pinch) and pan (drag the background). `children(S, k)` draws on top: S = the map's size in px, k = a scale for line
 * widths and icons (1 at 640 px).
 */
export function MapBase({ layers, children, onBackground, you = 0 }: {
  layers: Set<MapLayer>;
  /** The team drawn in lane colours, like the game shows your own (the other one red). */
  you?: DlTeam;
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
  const map = useGameMap(), tunnels = useTunnels();
  const S = size, k = S / 640;
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
          <MapArt S={S} k={k} img={map} tunnels={tunnels} you={you} layers={layers} />
        </Layer>
        {children(S, k)}
      </Stage>
      {view.scale > 1 && <button className="ghost small-btn dl-zoom-reset" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>Fit map</button>}
    </div>
  );
}

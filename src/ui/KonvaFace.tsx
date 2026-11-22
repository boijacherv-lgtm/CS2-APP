import { useEffect, useState } from 'react';
import { Image } from 'react-konva';
import type { Annotation } from '../engine/notes';
import { eyeSvg, pageGame, type EyeGame } from './eyes';

/** The eyes as images for the canvas, one per mark and game, drawn from the same SVG as MarkFace. */
const images = new Map<string, HTMLImageElement>();
function eyeImage(note: Annotation, game: EyeGame): HTMLImageElement {
  const key = `${game}:${note}`;
  let img = images.get(key);
  if (!img) {
    img = new window.Image();
    // an explicit size, so every browser rasterises it sharply when the canvas draws it
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(eyeSvg(note, game, 'k').replace('<svg ', '<svg width="96" height="96" '))}`;
    images.set(key, img);
  }
  return img;
}

/** A move mark on the Konva map: its eye, about as wide as a disc of `radius` with its ring. Still (no reveal). */
export function KonvaFace({ note, radius }: { note: Annotation; radius: number }) {
  const img = eyeImage(note, pageGame());
  const [, setLoaded] = useState(img.complete);
  useEffect(() => {
    if (img.complete) return;
    const done = () => setLoaded(true);
    img.addEventListener('load', done);
    return () => img.removeEventListener('load', done);
  }, [img]);
  const s = radius * 2.6;
  return <Image image={img} x={-s / 2} y={-s / 2} width={s} height={s} listening={false} />;
}

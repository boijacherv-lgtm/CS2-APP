import { Group, Path } from 'react-konva';
import type { Annotation } from '../engine/recap';
import { FACE } from './markFaces';

/** A mark's face on the Konva map, filling a disc of `radius` (the disc itself is drawn by the caller). */
export function KonvaFace({ note, radius }: { note: Annotation; radius: number }) {
  const s = (radius * 2) / 24;
  return (
    <Group x={-12 * s} y={-12 * s} scaleX={s} scaleY={s} listening={false}>
      {FACE[note].map((p, i) => <Path key={i} data={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.width} lineCap="round" lineJoin="round" />)}
    </Group>
  );
}

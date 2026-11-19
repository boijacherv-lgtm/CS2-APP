import { Text } from 'react-konva';
import { NOTE_SYMBOL, type Annotation } from '../engine/notes';

/** A move mark's symbol on the Konva map, centred in a disc of `radius` (the disc itself is drawn by the caller). */
export function KonvaFace({ note, radius }: { note: Annotation; radius: number }) {
  const sym = NOTE_SYMBOL[note], fs = radius * (sym.length > 1 ? 0.95 : 1.2);
  return <Text text={sym} x={-radius} y={-fs / 2 + radius * 0.04} width={radius * 2} align="center" fontSize={fs} fontStyle="bold" fill="#0A0C10" listening={false} />;
}

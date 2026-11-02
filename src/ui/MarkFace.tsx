import { NOTE_INFO, type Annotation } from '../engine/recap';
import { FACE } from './markFaces';

/** A mark as its face on a disc of the mark's colour (markFaces.ts). The label is there for screen readers. */
export function MarkFace({ note, size = 18, title, className = '' }: { note: Annotation; size?: number; title?: string; className?: string }) {
  const n = NOTE_INFO[note];
  return (
    <svg className={`mark-face ${className}`} viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={n.label}>
      <title>{title ?? n.label}</title>
      <circle cx={12} cy={12} r={11.5} fill={n.color} />
      {FACE[note].map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={p.width} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

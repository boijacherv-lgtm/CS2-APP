import { NOTE_INFO, NOTE_SYMBOL, type Annotation } from '../engine/notes';

/**
 * A move mark: a round badge in the mark's colour with its symbol (!! ! ✓ ?! ? ??), dark ink. Round for moves, square for
 * letter grades (S+ … F), so the two scales never mix. The label is there for screen readers.
 */
export function MarkFace({ note, size = 18, title, className = '' }: { note: Annotation; size?: number; title?: string; className?: string }) {
  const n = NOTE_INFO[note], sym = NOTE_SYMBOL[note];
  return (
    <svg className={`mark-face ${className}`} viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={n.label}>
      <title>{title ?? n.label}</title>
      <circle cx={12} cy={12} r={11.5} fill={n.color} />
      <text x={12} y={12.5} textAnchor="middle" dominantBaseline="central" fill="#0A0C10" fontWeight={800}
        fontSize={sym.length > 1 ? 11 : 14} fontFamily="Inter, system-ui, sans-serif" letterSpacing={sym.length > 1 ? -0.6 : 0}>{sym}</text>
    </svg>
  );
}

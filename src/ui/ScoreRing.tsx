import { NOTE_INFO } from '../engine/recap';

/** A score out of 100 as a ring, coloured by its mark (grey for an average one). */
export function ScoreRing({ score, note, size }: { score: number | null; note: keyof typeof NOTE_INFO; size: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, col = score === null ? 'var(--text-3)' : note === 'book' ? 'var(--text-2)' : NOTE_INFO[note].color;
  return (
    <span className="dl-ring" style={{ width: size, height: size }} title={score === null ? 'Not graded' : `${score} / 100`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="dl-ring-track" strokeWidth={size > 60 ? 7 : 4} />
        {score !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={size > 60 ? 7 : 4} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <b className="num" style={{ fontSize: size > 90 ? 32 : size > 60 ? 26 : size > 38 ? 13 : 12 }}>{score ?? '–'}</b>
    </span>
  );
}

import { useEffect, useId, useState, type CSSProperties } from 'react';
import { NOTE_INFO, type Annotation } from '../engine/notes';
import { eyeSvg, pageGame } from './eyes';

/** Where each move has already played its reveal (card, killfeed, move list, timeline): once per place. */
const revealed = new Map<string, WeakSet<object>>();

/**
 * A move mark: an eye in the page's game colours (eyes.ts), its state saying the mark. The label is there for screen
 * readers. With `reveal`, the eye blinks into its mark the first time that move shows in that place (styles.css,
 * "eye reveal"); `delay` (ms) staggers a list.
 */
export function MarkFace({ note, size = 18, title, className = '', reveal }: {
  note: Annotation; size?: number; title?: string; className?: string;
  reveal?: { move: object; where: string; delay?: number };
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [animate] = useState(() => !!reveal && !revealed.get(reveal.where)?.has(reveal.move));
  useEffect(() => {
    if (!reveal) return;
    if (!revealed.has(reveal.where)) revealed.set(reveal.where, new WeakSet());
    revealed.get(reveal.where)!.add(reveal.move);
  }, [reveal]);
  const label = title ?? NOTE_INFO[note].label;
  // the eye's box has room for its ring around it: draw it a little larger and pull the margins in, so it takes the
  // same space the old round badge did
  const box = Math.round(size * 1.25), pull = (size - box) / 2;
  return (
    <span className={`mark-face ${className}`} role="img" aria-label={label} title={label}
      style={{ width: box, height: box, margin: pull, ...(animate && reveal?.delay ? { '--eye-delay': `${reveal.delay}ms` } : {}) } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: eyeSvg(note, pageGame(), uid, animate) }} />
  );
}

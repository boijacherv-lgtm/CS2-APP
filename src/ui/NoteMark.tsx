import { NOTE_INFO, type Annotation } from '../engine/recap';
import { Icon } from './Icon';

/** A move's chess-style annotation as a chip: !! ! ? ?? in their colour, a book icon for book moves. */
export function NoteMark({ note, className = 'badge', size = 11, title }: { note: Annotation; className?: string; size?: number; title?: string }) {
  const n = NOTE_INFO[note];
  return (
    <span className={`${className} note-${note === 'book' ? 'book' : 'mark'}`} style={{ background: n.color }} title={title ?? `${n.label}: ${n.tip}`}>
      {note === 'book' ? <Icon name="book" size={size} /> : n.mark}
    </span>
  );
}

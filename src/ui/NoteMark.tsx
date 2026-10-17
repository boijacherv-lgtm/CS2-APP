import { NOTE_INFO, type Annotation, type Move } from '../engine/recap';
import { Icon, type IconName } from './Icon';

/** Plain kills and deaths aren't "book" (that's for set plays like a standard smoke): they're just a kill or a death. */
const PLAIN = '#8a919c';

/** How a move's mark looks: its label, colour and what's in the chip (!! ! ? ??, or an icon for plain moves). */
export function moveLook(m: Pick<Move, 'note' | 'kind'>): { label: string; color: string; mark: string; icon?: IconName; tip: string } {
  const n = NOTE_INFO[m.note];
  if (m.note !== 'book') return { label: n.label, color: n.color, mark: n.mark, tip: n.tip };
  if (m.kind === 'kill') return { label: 'Kill', color: PLAIN, mark: '', icon: 'crosshair', tip: 'An ordinary kill: nothing special either way' };
  if (m.kind === 'death') return { label: 'Death', color: PLAIN, mark: '', icon: 'skull', tip: 'An ordinary death: not a mistake' };
  if (m.kind === 'position') return { label: 'Good position', color: PLAIN, mark: '', icon: 'target', tip: 'A sound positioning choice: close to what level-10 players do here' };
  return { label: m.kind === 'objective' ? 'Standard' : 'Book', color: n.color, mark: '', icon: 'book', tip: n.tip };
}

/** A move's chess-style annotation as a chip: !! ! ? ?? in their colour, an icon for plain moves. */
export function NoteMark({ m, className = 'badge', size = 11, title }: { m: Pick<Move, 'note' | 'kind'>; className?: string; size?: number; title?: string }) {
  const l = moveLook(m);
  return (
    <span className={`${className} note-${m.note === 'book' ? 'book' : 'mark'}`} style={{ background: l.color }} title={title ?? `${l.label}: ${l.tip}`}>
      {l.icon ? <Icon name={l.icon} size={size} /> : l.mark}
    </span>
  );
}

export type { Annotation };

import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useStore } from '../store';

/**
 * A panel section whose heading collapses it. The choice is remembered (per section id),
 * so a busy panel can be trimmed down once and stays that way.
 */
export function Fold({ id, title, children, defaultOpen = true, aside }: {
  id: string; title: ReactNode; children: ReactNode; defaultOpen?: boolean;
  /** Small text kept visible on the heading even when collapsed (e.g. a headline number). */
  aside?: ReactNode;
}) {
  const stored = useStore(s => s.folded[id]);
  const toggleFold = useStore(s => s.toggleFold);
  const collapsed = stored ?? !defaultOpen;
  return (
    <section className={`fold ${collapsed ? 'closed' : ''}`}>
      <h3 className="fold-head" role="button" tabIndex={0} aria-expanded={!collapsed}
        onClick={() => toggleFold(id, collapsed)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFold(id, collapsed); } }}>
        <span className="chev" aria-hidden><Icon name="chevronDown" size={8} /></span>
        <span className="fold-title">{title}</span>
        {aside && <span className="fold-aside">{aside}</span>}
      </h3>
      {!collapsed && children}
    </section>
  );
}

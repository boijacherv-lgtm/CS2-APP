import type { ReactNode } from 'react';

/** A section that starts closed: its title and a hint, the rest on a click (the text budget: a tab shows a few lines, not a page). */
export function Collapse({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="collapse" open={open}>
      <summary><h3>{title}</h3>{hint && <span className="muted small">{hint}</span>}</summary>
      {children}
    </details>
  );
}

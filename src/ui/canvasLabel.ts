import { useEffect, type RefObject } from 'react';

/** Names a Konva map for screen readers: its canvases become one labelled image (the controls around it stay buttons). */
export function useCanvasLabel(ref: RefObject<HTMLElement | null>, label: string) {
  useEffect(() => {
    const cs = [...(ref.current?.querySelectorAll('canvas') ?? [])];
    cs.forEach((c, i) => { if (i === 0) { c.setAttribute('role', 'img'); c.setAttribute('aria-label', label); } else c.setAttribute('aria-hidden', 'true'); });
  });
}

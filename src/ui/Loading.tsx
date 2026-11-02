import type { ReactNode } from 'react';

/** "Loading…" with the game's spinner (theme.css: a turning crosshair for CS2, deco rings for Deadlock). */
export function Loading({ children }: { children: ReactNode }) {
  return <p className="game-loading" role="status"><span className="game-loader" aria-hidden />{children}</p>;
}

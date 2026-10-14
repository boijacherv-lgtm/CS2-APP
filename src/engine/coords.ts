import type { RadarCalib, Vec2 } from './types';

/** Game world units -> radar pixels. World Y points up, image Y points down. */
export const worldToRadar = (w: Vec2, r: RadarCalib): Vec2 => ({
  x: (w.x - r.posX) / r.scale,
  y: (r.posY - w.y) / r.scale,
});

export const radarToWorld = (p: Vec2, r: RadarCalib): Vec2 => ({
  x: p.x * r.scale + r.posX,
  y: r.posY - p.y * r.scale,
});

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module (the demo reader)
import { bouncesOf } from '../../../tools/demo-core.mjs';

/** A grenade flying one tick at a time: [tick, x, y, z], with gravity (320 units/s² at 64 ticks). */
function fly(from: number[], v: number[], ticks: number, t0 = 0) {
  const G = 320 / 64 / 64, out: number[][] = [];
  let [x, y, z] = from, [vx, vy, vz] = v;
  for (let i = 0; i < ticks; i++) { out.push([t0 + i, x, y, z]); x += vx; y += vy; z += vz; vz -= G; }
  return { pts: out, end: [x, y, z], v: [vx, vy, vz] };
}

describe('grenade bounces', () => {
  it('a clean arc has none', () => {
    expect(bouncesOf(fly([0, 0, 100], [12, 0, 4], 80).pts)).toEqual([]);
  });

  it('finds a wall, then the floor', () => {
    const a = fly([0, 0, 100], [12, 0, 4], 40);
    const b = fly(a.end, [-a.v[0] * 0.45, 0, a.v[2]], 30, 40); // off a wall: x reverses
    const c = fly(b.end, [b.v[0], 0, -b.v[2] * 0.45], 20, 70); // off the floor: falling becomes rising
    const hits = bouncesOf([...a.pts, ...b.pts, ...c.pts]);
    expect(hits.map((h: number[]) => [h[0], h[3]])).toEqual([[40, 1], [70, 0]]);
  });

  it('a dead stop is the landing, not a bounce', () => {
    const a = fly([0, 0, 100], [12, 0, -2], 20);
    const still = Array.from({ length: 10 }, (_, i) => [20 + i, ...a.end]);
    expect(bouncesOf([...a.pts, ...still])).toEqual([]);
  });
});

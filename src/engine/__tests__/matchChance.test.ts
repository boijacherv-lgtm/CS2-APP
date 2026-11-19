import { describe, expect, it } from 'vitest';
import { chanceToWin, matchCurve } from '../matchChance';

describe('chance to win the match from the score', () => {
  it('is 50% at 0–0 and at 15–15, and decided at 16', () => {
    expect(chanceToWin(0, 0)).toBeCloseTo(0.5, 6);
    expect(chanceToWin(15, 15)).toBe(0.5);
    expect(chanceToWin(16, 9)).toBe(1);
    expect(chanceToWin(3, 16)).toBe(0);
  });
  it('rises with a lead and the curve follows the rounds', () => {
    expect(chanceToWin(8, 4)).toBeGreaterThan(0.8);
    const c = matchCurve([0, 0, 1], 0);
    expect(c.map(p => p.t)).toEqual([0, 1, 2, 3]);
    expect(c[2].v).toBeGreaterThan(c[1].v);
    expect(c[3].v).toBeLessThan(c[2].v);
  });
});

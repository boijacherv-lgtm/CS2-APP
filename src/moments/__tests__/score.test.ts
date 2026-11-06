import { describe, expect, it } from 'vitest';
import { dailyOf, puzzleRating, rated } from '../score';
import type { Moment } from '../moments';

const m = (id: string, best: number, second: number): Moment => ({ id, game: 'cs2', map: 'de_mirage', at: 0, match: 'Mirage', when: 'R1', dots: [], setup: '', kind: '', played: 1, cls: 'Mistake', cost: 0.1,
  options: [{ label: 'a', value: best }, { label: 'b', value: second }] });

describe('puzzle score', () => {
  it('a close call is a harder puzzle', () => {
    expect(puzzleRating(m('x', 0.6, 0.58))).toBeGreaterThan(puzzleRating(m('y', 0.6, 0.3)));
  });
  it('rating rises on a right answer, more for a harder puzzle', () => {
    expect(rated(1200, 1600, true) - 1200).toBeGreaterThan(rated(1200, 900, true) - 1200);
    expect(rated(1200, 1200, false)).toBeLessThan(1200);
  });
  it('the daily puzzle is the same for everyone that day, whatever the list order', () => {
    const pool = [m('a', 1, 0), m('b', 1, 0), m('c', 1, 0)];
    expect(dailyOf(pool, 5)?.id).toBe(dailyOf([...pool].reverse(), 5)?.id);
  });
});

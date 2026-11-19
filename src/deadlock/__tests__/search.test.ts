import { describe, expect, it } from 'vitest';
import { matchFromMetadata } from '../match';
import { laningCap, searchAt, searchClass } from '../search';
import slice from './match-124566656-slice.json';

describe('the 2-step search', () => {
  const m = matchFromMetadata(slice);
  it('lists its options best first, and grades the move made by what it gave up', () => {
    let seen = 0;
    for (let t = 120; t + 20 < m.duration; t += 60) for (const p of m.players) {
      const s = searchAt(m, null, p.slot, t);
      if (!s) continue;
      seen++;
      for (let i = 1; i < s.options.length; i++) expect(s.options[i - 1].value).toBeGreaterThanOrEqual(s.options[i].value);
      expect(s.loss).toBeGreaterThanOrEqual(0);
      if (s.played) expect(s.cls).toBe(laningCap(s.t, s.played.action, s.options[0].action, searchClass(s.loss, s.options.length > 1 ? s.options[0].value - s.options[1].value : 1)));
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('names classes from Best to Blunder as the loss grows', () => {
    expect(searchClass(0)).toBe('Best');
    expect(searchClass(0, 0.001)).toBe('Good'); // the obvious move
    expect(searchClass(0.02)).toBe('Inaccuracy');
    expect(searchClass(0.05)).toBe('Mistake');
    expect(searchClass(0.09)).toBe('Blunder');
    expect(searchClass(0.5)).toBe('Blunder');
  });
});

describe('laningCap', () => {
  it('softens lane-over-fight early, not later or other moves', () => {
    expect(laningCap(60, 'lane', 'fight', 'Mistake')).toBe('Inaccuracy');
    expect(laningCap(60, 'lane', 'fight', 'Good')).toBe('Good');
    expect(laningCap(600, 'lane', 'fight', 'Mistake')).toBe('Mistake');
    expect(laningCap(60, 'farm', 'fight', 'Blunder')).toBe('Blunder');
  });
});

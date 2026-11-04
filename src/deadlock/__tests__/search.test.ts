import { describe, expect, it } from 'vitest';
import { matchFromMetadata } from '../match';
import { searchAt, searchClass } from '../search';
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
      if (s.played) expect(s.cls).toBe(searchClass(s.loss));
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('names classes from Best to Blunder as the loss grows', () => {
    expect(searchClass(0)).toBe('Best');
    expect(searchClass(0.5)).toBe('Blunder');
  });
});

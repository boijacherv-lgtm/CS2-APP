import { describe, expect, it } from 'vitest';
import { matchFromMetadata } from '../match';
import { engineAccuracy, engineReview } from '../engineReview';
import slice from './match-124566656-slice.json';

describe('the engine review', () => {
  const m = matchFromMetadata(slice);
  it('grades every move it reviews, with a title and reasons, and an accuracy from 0 to 100', () => {
    const r = engineReview(m, null, m.players[0].slot);
    expect(Object.values(r.counts).reduce((a, v) => a + v, 0)).toBe(r.moves.length);
    for (const x of r.moves) { expect(x.title).toMatch(/^(Best|Excellent|Good|Inaccuracy|Mistake|Blunder): /); expect(x.why.length).toBeGreaterThan(0); }
    expect(r.accuracy).toBeGreaterThanOrEqual(0);
    expect(r.accuracy).toBeLessThanOrEqual(100);
    for (let i = 1; i < r.worst.length; i++) expect(r.worst[i - 1].loss).toBeGreaterThanOrEqual(r.worst[i].loss);
  });
  it('scores a game with nothing given up 100, and less the more is given up', () => {
    expect(engineAccuracy(0)).toBeCloseTo(100, 0);
    expect(engineAccuracy(0.01)).toBeLessThan(engineAccuracy(0.002));
  });
});

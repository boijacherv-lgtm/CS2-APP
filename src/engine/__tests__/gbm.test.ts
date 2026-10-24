import { describe, expect, it } from 'vitest';
import { fitGbm, gbmLogit } from '../gbm';

describe('boosted trees', () => {
  it('learn a rule a weighted sum cannot (XOR), and stop on held-out rows', () => {
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const rows = (n: number) => {
      const x: number[][] = [], y: number[] = [];
      for (let i = 0; i < n; i++) { const a = rnd(), b = rnd(); x.push([a, b, rnd()]); y.push((a > 0.5) !== (b > 0.5) ? (rnd() < 0.9 ? 1 : 0) : (rnd() < 0.1 ? 1 : 0)); }
      return { x, y };
    };
    const tr = rows(6000), va = rows(2000), te = rows(2000);
    const m = fitGbm(tr.x, tr.y, ['a', 'b', 'noise'], { trees: 120, depth: 3, minLeaf: 40, valid: va });
    const p = (x: number[]) => 1 / (1 + Math.exp(-gbmLogit(m, x)));
    const acc = te.x.filter((x, i) => (p(x) > 0.5) === (te.y[i] === 1)).length / te.x.length;
    expect(acc).toBeGreaterThan(0.85);
    expect(p([0.9, 0.1, 0.5])).toBeGreaterThan(0.75);
    expect(p([0.9, 0.9, 0.5])).toBeLessThan(0.25);
    expect(m.trees.length).toBeLessThanOrEqual(120);
  });
});

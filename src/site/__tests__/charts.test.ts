import { describe, expect, it } from 'vitest';
import { axisLabels } from '../charts';

describe('axisLabels', () => {
  it('keeps the last label, drops one that would touch it and repeats of a date', () => {
    const labels = ['Oct 10', 'a', 'Oct 13', 'b', 'Oct 19', 'c', 'Oct 25', 'Oct 25', 'Oct 25'];
    expect([...axisLabels(labels, 2)]).toEqual([0, 2, 4, 6]);
    expect([...axisLabels(['Nov 1', 'x', 'y', 'Nov 2', 'Nov 2'], 3)]).toEqual([0, 4]);
  });
});

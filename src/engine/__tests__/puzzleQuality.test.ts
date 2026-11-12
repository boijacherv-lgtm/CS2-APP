import { describe, expect, it } from 'vitest';
import { shapePuzzle, shapeSet } from '../../moments/quality';
import type { Moment } from '../../moments/moments';

const m = (id: string, when: string, vals: [string, number][], played = 0): Moment => ({
  id: `${id}#${when}`, game: 'cs2', map: 'de_nuke', at: 0, match: 'Nuke', when, dots: [], setup: '', played, cls: 'Mistake', cost: 0, kind: '',
  options: vals.map(([label, value]) => ({ label, value })),
});

describe('puzzle rules', () => {
  it('keeps 3–4 different ideas, no ties, nothing under 5%, a clear best', () => {
    const p = shapePuzzle(m('a', 'R3 1:20', [['Hold Hut', 0.6], ['Move to Main', 0.33], ['Hold Main', 0.33], ['Peek Ramp', 0.2], ['Move to Hut', 0.01]]))!;
    expect(p.options.map(o => o.label)).toEqual(['Hold Hut', 'Reposition to Main', 'Peek Ramp']);
    expect(shapePuzzle(m('b', 'R3 1:20', [['Hold Hut', 0.5], ['Peek Ramp', 0.46], ['Move to Main', 0.2]]))).toBeNull(); // best only 4 pts ahead
    expect(shapePuzzle(m('c', 'R3 1:20', [['Plant the bomb', 0.92], ['Hold Hut', 0.5], ['Peek Ramp', 0.2]]))).toBeNull(); // decided
  });

  it('a 50-puzzle set: no ties, no same-round twins within 20 s, at most a fifth about planting', () => {
    const raw: Moment[] = [];
    for (let i = 0; i < 60; i++) raw.push(m(`m${i % 7}`, `R${i % 9} 1:${String(10 + (i % 3) * 4).padStart(2, '0')}`,
      [[i % 2 ? 'Plant the bomb' : 'Hold Hut', 0.55 + (i % 5) * 0.03], ['Peek Ramp', 0.4], ['Move to Main', 0.25], ['Flash Ramp', 0.26]]));
    const set = shapeSet(raw);
    for (const p of set) {
      const v = p.options.map(o => o.value).sort((a, b) => b - a);
      for (let i = 1; i < v.length; i++) expect(v[i - 1] - v[i]).toBeGreaterThanOrEqual(0.03);
    }
    expect(set.filter(p => /plant/i.test(p.options[0].label)).length).toBeLessThanOrEqual(Math.floor(set.length * 0.2));
    const key = (p: Moment) => `${p.id.split('#')[0]}|${p.when.split(' ')[0]}`;
    expect(new Set(set.map(key)).size).toBe(set.length);
  });
});

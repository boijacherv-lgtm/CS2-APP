import { describe, expect, it } from 'vitest';
import { applyCorrections, correctionFor, patternOf, tableOf } from '../corrections';
import type { Move } from '../recap';

type Row = { pattern: string; side: 'player' | 'coach' };
const rows = (pattern: string, side: Row['side'], n: number): Row[] => Array.from({ length: n }, () => ({ pattern, side }));

const move = (note: Move['note'], tags: Move['tags'], kind: Move['kind'] = 'death'): Move =>
  ({ t: 10, player: 'p', side: 'T', kind, gain: -0.1, note, title: 'x', why: ['a'], tags });

describe('corrections from checked disputes', () => {
  it('keys a move by its kind, mark and the tags that decide marks (sorted, the rest left out)', () => {
    expect(patternOf('death', '?', ['ISOLATED', 'OPENING', 'TRADED', 'WALLBANG'])).toBe('death|?|ISOLATED,OPENING,TRADED');
  });

  it('changes nothing until enough rulings agree', () => {
    const p = patternOf('death', '?', ['ISOLATED', 'OPENING']);
    const two = tableOf(rows(p, 'player', 2));
    expect(correctionFor(two, move('?', ['ISOLATED', 'OPENING']))).toBeNull();
    const mixed = tableOf([...rows(p, 'player', 3), ...rows(p, 'coach', 2)]);
    expect(correctionFor(mixed, move('?', ['ISOLATED', 'OPENING']))).toBeNull(); // 3 of 5: not 75%
  });

  it('marks a flagged move a step softer, and a passed one an inaccuracy', () => {
    const p = patternOf('death', '?', ['ISOLATED']), q = patternOf('death', 'book', ['LOUD']);
    const t = tableOf([...rows(p, 'player', 4), ...rows(q, 'player', 3)]);
    const [soft, hard, same] = applyCorrections([move('?', ['ISOLATED']), move('book', ['LOUD']), move('?', ['WHIFF'])], t);
    expect(soft.note).toBe('?!');
    expect(soft.why.at(-1)).toMatch(/4 of 4/);
    expect(hard.note).toBe('?!');
    expect(same.note).toBe('?');
  });
});

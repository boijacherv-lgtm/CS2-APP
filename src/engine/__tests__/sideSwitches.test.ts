import { describe, expect, it } from 'vitest';
import { sideSwitches } from '../../ui/Playback';
import type { DemoData } from '../recap';

/** A match where players a/b start CT and c/d start T, swapping before each round in `swaps` (0-based indexes). */
function match(rounds: number, swaps: number[]): DemoData {
  let aCT = true;
  return {
    map: 'de_dust2', tickrate: 64, names: {}, rounds: Array.from({ length: rounds }, (_, i) => {
      if (swaps.includes(i)) aCT = !aCT;
      const s = (ct: boolean) => ({ side: ct ? 'CT' : 'T' }) as never;
      return { n: i + 1, frames: { t: [], players: { a: s(aCT), b: s(aCT), c: s(!aCT), d: s(!aCT) } } } as never;
    }),
  } as DemoData;
}

describe('side switches', () => {
  it('half time in MR12', () => {
    expect(sideSwitches(match(24, [12]))).toEqual([12]);
  });
  it('half time and overtime halves (every 3 rounds)', () => {
    expect(sideSwitches(match(30, [12, 24, 27]))).toEqual([12, 24, 27]);
  });
  it('none in a match that ended before half time', () => {
    expect(sideSwitches(match(10, []))).toEqual([]);
  });
});

describe('round rows', () => {
  it('splits at half time, at the start of overtime and at each overtime swap', async () => {
    const { roundHalves } = await import('../../ui/Recap');
    const rows = roundHalves(match(29, [12, 27]));
    expect(rows.map(r => [r.label, r.rounds.length, r.switched])).toEqual([['1st', 12, false], ['2nd', 12, true], ['OT1', 3, false], ['OT1', 2, true]]);
  });
});

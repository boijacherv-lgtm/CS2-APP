import { describe, expect, it } from 'vitest';
import { chance, type State } from '../winmodel';
import WM from '../generated/winmodel.json';

const s: State = { t: 1200, souls: [90000, 80000], kills: [20, 14], guardians: [1, 2], walkers: [0, 1], base: [0, 0], midBoss: [1, 0] };
const mirror = (x: State): State => ({ t: x.t, souls: [x.souls[1], x.souls[0]], kills: [x.kills[1], x.kills[0]], guardians: [x.guardians[1], x.guardians[0]], walkers: [x.walkers[1], x.walkers[0]], base: [x.base[1], x.base[0]], midBoss: [x.midBoss[1], x.midBoss[0]] });

describe('the win-chance model', () => {
  it('is the same from either side (up to the small side bias)', () => {
    const w = (WM as { weights: number[] }).weights, noBias = [0, ...w.slice(1)];
    expect(chance(noBias, s) + chance(noBias, mirror(s))).toBeCloseTo(1, 6);
  });
  it('favours the team ahead in souls and objectives', () => {
    const w = (WM as { weights: number[] }).weights;
    expect(chance(w, s)).toBeGreaterThan(0.6);
    expect(chance(w, { ...s, souls: [80000, 80000], kills: [14, 14], guardians: [0, 0], walkers: [0, 0], midBoss: [0, 0] })).toBeGreaterThan(0.4);
  });
});

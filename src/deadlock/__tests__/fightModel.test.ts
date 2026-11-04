import { describe, expect, it } from 'vitest';
import { matchFromMetadata } from '../match';
import { fightChance, fightsIn, type FightModel, type FightSide } from '../fightModel';
import FM from '../generated/fightmodel.json';
import slice from './match-124566656-slice.json';

const model = FM as unknown as FightModel;
const side = (n: number, hp: number, souls: number): FightSide => ({ n, hp, souls, richest: souls / n, level: 15, help: 0, home: 0.5, tower: 0 });

describe('the fight model', () => {
  it("gives the two sides chances that add up to 1", () => {
    const a = side(3, 2.4, 30000), b = side(2, 1.1, 22000);
    expect(fightChance(model, 900, a, b) + fightChance(model, 900, b, a)).toBeCloseTo(1, 9);
  });
  it('favours the side with more heroes, more health and more souls', () => {
    expect(fightChance(model, 900, side(3, 2.7, 33000), side(2, 1.2, 20000))).toBeGreaterThan(0.6);
  });
  it('finds fights with both sides in them, sides made only of heroes who were there', () => {
    const m = matchFromMetadata(slice);
    for (const f of fightsIn(m)) {
      expect(f.slots[0].length).toBeGreaterThan(0);
      expect(f.slots[1].length).toBeGreaterThan(0);
      expect(f.sides[0].n).toBeLessThanOrEqual(f.slots[0].length);
    }
  });
});

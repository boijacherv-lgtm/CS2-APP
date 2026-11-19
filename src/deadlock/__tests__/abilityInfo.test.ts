import { describe, expect, it } from 'vitest';
import HEROES from '../generated/heroes.json';
import { abilitiesOf } from '../abilityInfo';

describe('what every ability does', () => {
  it('knows all four abilities of every hero, with what each does and its upgrade tiers', () => {
    for (const h of HEROES as { id: number; name: string }[]) {
      const abs = abilitiesOf(h.id);
      expect(abs.length, h.name).toBe(4);
      expect(abs.filter(a => a.ult).length, h.name).toBe(1);
      for (const a of abs) {
        expect(a.book, `${h.name}: ${a.name}`).not.toBeNull();
        expect(a.book!.does.length).toBeGreaterThan(15);
        expect(a.tiers.length).toBeLessThanOrEqual(3);
      }
    }
  });
});

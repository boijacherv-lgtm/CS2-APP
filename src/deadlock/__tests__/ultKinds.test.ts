import { describe, expect, it } from 'vitest';
import HEROES from '../generated/heroes.json';
import { ULT_KINDS, ultKindCounts, ultOf, ultWords } from '../ultKinds';
import { ULT_BOOK } from '../ultBook';

describe('what each ultimate does', () => {
  const heroes = HEROES as { id: number; name: string }[];
  it('has a book entry for every hero, with what it does, when to use it and how to play against it', () => {
    for (const h of heroes) {
      const u = ultOf(h.id);
      expect(u, h.name).not.toBeNull();
      expect(u!.does.length).toBeGreaterThan(20);
      expect(u!.use.length).toBeGreaterThan(5);
      expect(u!.against.length).toBeGreaterThan(5);
      expect(u!.kinds.length).toBeGreaterThan(0);
      for (const k of u!.kinds) expect(ULT_KINDS).toContain(k);
    }
    expect(Object.keys(ULT_BOOK).length).toBe(heroes.length);
  });
  it('reads an ultimate in a few words, and counts the ready ones by kind', () => {
    const seven = heroes.find(h => h.name === 'Seven')!, kelvin = heroes.find(h => h.name === 'Kelvin')!;
    expect(ultWords(seven.id)).toMatch(/^Storm Cloud \(Seven: /);
    const k = ultKindCounts([seven.id, kelvin.id]);
    expect(k.area).toBe(1); // Kelvin's dome protects, it doesn't hit
    expect(k.protect).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { levelOf } from '../floors';
import maps from '../generated/maps.json';
import type { MapLevel } from '../../engine/types';

const levelsOf = (id: string) => (maps as unknown as { id: string; levels: MapLevel[] }[]).find(m => m.id === id)!.levels;

describe('levelOf', () => {
  const nuke = levelsOf('de_nuke');
  it('puts the owner\'s Nuke plants on their floors (A at z −400, B at z −770)', () => {
    expect(levelOf(nuke, -400)).toBe(0); // R10, R11, R22, R24
    expect(levelOf(nuke, -770)).toBe(1); // R5, R8, R14
  });
  it('keeps the floor near the split, so stairs do not flicker', () => {
    expect(levelOf(nuke, -480)).toBe(0);
    expect(levelOf(nuke, -510)).toBe(1);
    expect(levelOf(nuke, -510, 0)).toBe(0); // was upstairs, 15 units below the split: still there
    expect(levelOf(nuke, -480, 1)).toBe(1);
    expect(levelOf(nuke, -560, 0)).toBe(1); // clearly downstairs now
    expect(levelOf(nuke, -430, 1)).toBe(0);
  });
  it('works from the data of any map, not just Nuke', () => {
    const vertigo = levelsOf('de_vertigo'), train = levelsOf('de_train');
    expect(levelOf(vertigo, 12000)).toBe(0);
    expect(levelOf(vertigo, 11000)).toBe(1);
    expect(levelOf(train, 100)).toBe(0);
    expect(levelOf(train, -300)).toBe(1);
  });
  it('is level 0 for maps with one radar and for no height', () => {
    expect(levelOf(levelsOf('de_mirage'), -500)).toBe(0);
    expect(levelOf(nuke, undefined)).toBe(0);
    expect(levelOf(nuke, NaN, 1)).toBe(1);
  });
});

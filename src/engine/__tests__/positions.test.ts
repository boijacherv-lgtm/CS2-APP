import { describe, expect, it } from 'vitest';
import { loadPositions, positionsVersion, proPositions, proSpots } from '../../map/positions';

describe('level-10 positions load per map', () => {
  it('are empty until a map is loaded, then the readers see it, and the version moves once', async () => {
    expect(proPositions('de_dust2')).toBeNull();
    expect(proSpots('de_dust2', 'CT', 'early')).toEqual([]);
    const v = positionsVersion();
    await loadPositions('de_dust2');
    expect(positionsVersion()).toBe(v + 1);
    expect(proPositions('de_dust2')?.demos).toBeGreaterThan(0);
    expect(proSpots('de_dust2', 'CT', 'early').length).toBeGreaterThan(0);
    await loadPositions('de_dust2'); // already there: nothing happens
    expect(positionsVersion()).toBe(v + 1);
    await loadPositions('de_nowhere'); // no such map: nothing happens either
    expect(positionsVersion()).toBe(v + 1);
  });
});

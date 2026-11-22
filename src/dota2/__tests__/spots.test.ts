import { describe, expect, it } from 'vitest';
import { OBS_VISION } from '../data';
import type { D2Match, D2Player } from '../match';
import { cellOf, phaseAt, positionsOf, seesFrom, SPOT_GRID, wardStageAt } from '../spots';

const player = (slot: number, hero: number, lane: number, netWorth: number): D2Player => ({ slot, team: slot < 5 ? 0 : 1, hero, lane, netWorth } as D2Player);

describe('where pros stand and what wards are worth', () => {
  it('turns the map so both sides see their own base bottom-left', () => {
    const a = { x: 0.1, y: 0.9 }, b = { x: 0.9, y: 0.1 };
    expect(cellOf(a, 0)).toBe(cellOf(b, 1));
    expect(cellOf(a, 0)).toBe(Math.floor(0.9 * SPOT_GRID) * SPOT_GRID + Math.floor(0.1 * SPOT_GRID));
    expect(cellOf({ x: -0.1, y: 0.5 }, 0)).toBe(-1);
  });
  it('gives each player a position from their lane and net worth, safe lane by side', () => {
    // Radiant's safe lane is the bottom one (1), Dire's the top one (3)
    const m = { players: [
      player(0, 1, 1, 20000), player(1, 2, 1, 5000), player(2, 3, 2, 15000), player(3, 4, 3, 12000), player(4, 5, 3, 6000),
      player(5, 6, 3, 21000), player(6, 7, 3, 4000), player(7, 8, 2, 16000), player(8, 9, 1, 11000), player(9, 10, 1, 7000),
    ] } as D2Match;
    const pos = positionsOf(m);
    expect([0, 1, 2, 3, 4].map(s => pos.get(s))).toEqual([1, 5, 2, 3, 4]);
    expect([5, 6, 7, 8, 9].map(s => pos.get(s))).toEqual([1, 5, 2, 3, 4]);
  });
  it('a ward sees inside its circle and not beyond', () => {
    const at = { x: 0.5, y: 0.5 };
    expect(seesFrom(at, { x: 0.5 + OBS_VISION * 1.1, y: 0.5 })).toBe(false);
    expect(seesFrom(at, { x: 0.5, y: 0.5 + OBS_VISION * 1.5 })).toBe(false);
  });
  it('splits the match into stages', () => {
    expect(phaseAt(-30)).toBe(0);
    expect(phaseAt(650)).toBe(2);
    expect(phaseAt(4000)).toBe(5);
    expect(wardStageAt(700)).toBe(1);
  });
});

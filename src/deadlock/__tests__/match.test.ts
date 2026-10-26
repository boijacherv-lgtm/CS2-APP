import { describe, expect, it } from 'vitest';
import { objectiveOf, toMap } from '../data';
import { kdaAt, matchFromMetadata, playerAt } from '../match';
import slice from './match-124566656-slice.json';

describe('Deadlock match data', () => {
  it('puts game positions where the map data does (a known bell: (3248, -1888) is at 0.651, 0.588)', () => {
    const at = toMap(3248, -1888);
    expect(at.x).toBeCloseTo(0.651, 3);
    expect(at.y).toBeCloseTo(0.588, 3);
  });

  it('names objectives by Valve\'s ids (lanes 1 / 3 / 4: yellow / blue / green)', () => {
    expect(objectiveOf(0).kind).toBe('patron');
    expect(objectiveOf(3)).toMatchObject({ kind: 'guardian', lane: 3, name: 'Blue Guardian' });
    expect(objectiveOf(8)).toMatchObject({ kind: 'walker', lane: 4 });
  });

  it('decodes a real match: players, paths every second on the map, deaths and objectives', () => {
    const m = matchFromMetadata(slice);
    expect(m.id).toBe(124566656);
    expect(m.players.map(p => p.slot).sort()).toEqual([6, 7]);
    const t = m.tracks[6];
    expect(t.x.length).toBe(40);
    for (let i = 0; i < t.x.length; i++) { expect(t.x[i]).toBeGreaterThan(0); expect(t.x[i]).toBeLessThan(1); expect(t.y[i]).toBeGreaterThan(0); expect(t.y[i]).toBeLessThan(1); }
    expect(m.deaths.length).toBeGreaterThan(0);
    expect(m.objectives[0].name).toBeTruthy();
    // between samples a hero is placed between them
    const a = playerAt(m, 6, 10)!, b = playerAt(m, 6, 11)!, mid = playerAt(m, 6, 10.5)!;
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 5);
  });

  it('counts kills and deaths up to a moment', () => {
    const m = matchFromMetadata(slice);
    const first = m.deaths[0];
    expect(kdaAt(m, first.slot, first.t - 1).d).toBe(0);
    expect(kdaAt(m, first.slot, first.t).d).toBe(1);
  });
});

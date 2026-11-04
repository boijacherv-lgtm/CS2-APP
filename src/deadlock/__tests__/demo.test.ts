import { describe, expect, it } from 'vitest';
import { buildDemo, upAt } from '../demo';
import { DL_MAP } from '../data';
import { matchFromMetadata } from '../match';
import slice from './match-124566656-slice.json';

// a world position at a map spot, as the demo writes it (cell + offset)
const cell = (p: { x: number; y: number }) => {
  const r = DL_MAP.radius, wx = p.x * 2 * r - r, wy = r - p.y * 2 * r;
  const c = (w: number) => Math.floor(w / 512) + 64;
  return { cx: c(wx), cy: c(wy), vx: wx - (c(wx) - 64) * 512, vy: wy - (c(wy) - 64) * 512 };
};
const T = 64;

describe('reading the demo', () => {
  const m = matchFromMetadata(slice);
  const camp = DL_MAP.camps.findIndex(c => c.kind === 'weak'), at = cell(DL_MAP.camps[camp]);
  const buff = cell(DL_MAP.bridgeBuffs[0]), urnSpot = cell(DL_MAP.urnPads[0]);
  const [a, b] = m.players;
  const d = buildDemo(m, {
    // two players: their controllers name their hero pawns (handles: the entity index in the low 14 bits)
    players: [{ slot: `0${a.slot.toString(16)}00000000000000`, pawn: (5 << 14) | 70, hero: a.hero, team: 2 }, { slot: `0${b.slot.toString(16)}00000000000000`, pawn: (9 << 14) | 71, hero: b.hero, team: 3 }],
    events: [],
    // the first picks up the second's soul bag at 8:00 (worth 420 souls)
    bags: [{ tick: 480 * T, a: (5 << 14) | 70, b: (9 << 14) | 71, g: 420 }], heroes: [], stats: [], creeps: [], troopers: [], creepDeaths: [], rift: [], koth: [],
    // a creature at a small camp: spawned at 2:00, sent again every minute (snapshots), killed at 4:05, back at 5:30
    camps: [
      { tick: 120 * T, e: 7, d: 'create', ls: 0, ...at }, { tick: 180 * T, e: 7, d: 'create', ls: 0, ...at },
      { tick: 245 * T, e: 7, d: 'update', ls: 1, ...at }, { tick: 300 * T, e: 7, d: 'create', ls: 1, ...at },
      { tick: 330 * T, e: 9, d: 'create', ls: 0, ...at },
    ],
    sinners: [],
    // the urn comes down from 10:00 to 10:12, then someone picks it up at 10:19 (its spot is cleared)
    urn: [{ s: 600, ...urnSpot }, { s: 612, ...urnSpot }, { s: 619, cx: null, cy: null, vx: null, vy: null }],
    // a bridge buff active from 5:00, taken at 6:00 (still sent every minute), active again at 10:00
    buffs: [
      { tick: 300 * T, e: 3, d: 'create', act: true, ...buff }, { tick: 360 * T, e: 3, d: 'update', act: false, ...buff },
      { tick: 420 * T, e: 3, d: 'create', act: false, ...buff }, { tick: 600 * T, e: 3, d: 'update', act: true, ...buff },
    ],
  });
  it('knows when a camp is up, through the once-a-minute snapshots', () => {
    expect(upAt(d.camps[camp], 200)).toBe(true);
    expect(upAt(d.camps[camp], 280)).toBe(false);
    expect(upAt(d.camps[camp], 400)).toBe(true);
  });
  it('follows the urn from landing to being picked up', () => {
    expect(d.urn).toHaveLength(1);
    expect(d.urn[0]).toMatchObject({ from: 600, landed: 612.5, taken: 619, fromLeft: DL_MAP.urnPads[0].x < 0.5 });
  });
  it('knows who picked up whose soul bag', () => {
    expect(d.bags).toEqual([{ t: 480, slot: a.slot, victim: b.slot, souls: 420 }]);
  });
  it('knows when a bridge buff lies there to take', () => {
    expect(upAt(d.buffs[0], 330)).toBe(true);
    expect(upAt(d.buffs[0], 450)).toBe(false);
    expect(upAt(d.buffs[0], 650)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { matchClock, toMatchClock, type DlDemo } from '../demo';
import type { DlMatch } from '../match';

// match 124566656: paused 33 s at 17:12 and 37 s at 17:42 (the demo's ticks kept counting)
const m = { duration: 1961, pauses: [{ t: 1032, dur: 33 }, { t: 1062, dur: 37 }], players: [] } as unknown as DlMatch;

describe('the demo on the match clock', () => {
  it('takes pauses out of tick time', () => {
    const c = matchClock(m);
    expect(c.g(934)).toBe(934);
    expect(c.g(1040)).toBe(1032); // during the first pause the clock stands
    expect(c.g(1163)).toBe(1093); // the demo's kill at 1163 is the match's at 1092 (±1)
    expect(c.tau(1093)).toBe(1163);
  });
  it('moves events, samples and ultimate cooldowns', () => {
    const tracks = { x: Array.from({ length: 1300 * 4 }, (_, i) => i / 4), y: [] as number[], z: [] as number[] };
    tracks.y = tracks.x.map(() => 0); tracks.z = tracks.y;
    const d = {
      v: 4, camps: [], urn: [], buffs: [], midBossSpawns: [], rejuv: [], creeps: {}, creepDeaths: [], rifts: [], stats: {},
      casts: [{ t: 470.5, slot: 6, name: 'Death Slam', ult: true }, { t: 1399.4, slot: 6, name: 'Death Slam', ult: true }],
      kills: [{ t: 1163, victim: 1, killer: 6, ability: null }],
      tracks: { 6: tracks },
      // the server clock: 55 s ahead, stopped by pauses; one cast seen as a few cooldowns a moment apart
      ults: { 6: { from: 378, cds: [[525.3, 695.3], [1383.2, 1511.4], [1382.6, 1517.6], [1386.7, 1515]] } },
    } as unknown as DlDemo;
    const f = toMatchClock(d, m);
    expect(f.clock).toBe(2);
    expect(f.kills[0].t).toBe(1093);
    expect(f.casts[1].t).toBeCloseTo(1329.4, 1);
    expect(f.ults[6].cds.map(c => c[0])).toEqual([470.5, 1327.8]);
    // a hero sample at match time 1100 is the tick-time sample at 1170
    expect(f.tracks[6].x[1100 * 4]).toBe(1170);
    expect(toMatchClock(f, m)).toBe(f);
  });
});

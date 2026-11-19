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

describe('lane creeps one by one', () => {
  const row = (s: number, e: number, ls = 0, cx = 64) => ({ s, e, team: 2, cx, cy: 64, vx: 0, vy: 0, ls });
  it('holds a standing creep, ends a life at its death, drops one-off snapshots', async () => {
    const { troopersFrom, troopersAt } = await import('../demo');
    const ts = troopersFrom([
      row(10, 5), row(11, 5), row(14, 5, 0, 65), row(15, 5, 2), // walks, stands 2 s, moves a cell, dies
      row(60, 5), // a snapshot of the unused entity
      row(100, 5), row(101, 5), row(102, 5), // a new creep on the same entity
    ], n => (n === 2 ? 0 : undefined));
    expect(ts.map(t => [t.t0, t.xy.length / 2])).toEqual([[10, 5], [100, 3]]);
    expect(ts[0].xy[4]).toBe(ts[0].xy[2]); // held at 12 s
    const at = troopersAt({ troopers: ts } as unknown as DlDemo, 13.5)!;
    expect(at[0]).toBe(0);
    expect(at[1]).toBeGreaterThan(ts[0].xy[6]); // halfway to the next cell
    expect(troopersAt({ troopers: ts } as unknown as DlDemo, 20)).toEqual([]);
  });
});

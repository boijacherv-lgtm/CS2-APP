import { describe, expect, it } from 'vitest';
import { coachMatch } from '../coach';
import { matchFromMetadata } from '../match';
import slice from './match-124566656-slice.json';

describe('Deadlock coach', () => {
  const m = matchFromMetadata(slice);
  it('grades every death and kill, with reasons', () => {
    const moves = coachMatch(m);
    const deaths = moves.filter(x => x.kind === 'death');
    expect(deaths.length).toBe(m.deaths.length);
    for (const d of deaths) expect(d.why.length).toBeGreaterThan(0);
  });
  it('calls a death with nobody around isolated (only two heroes in this slice: never a teammate near)', () => {
    const d = coachMatch(m).find(x => x.kind === 'death')!;
    expect(d.tags).toContain('ISOLATED');
    expect(['?!', '?', '??']).toContain(d.note);
  });
  it('grades laning against the average player on the hero when there is a benchmark', () => {
    const p = m.players[0];
    const s = m.stats[p.slot].find(x => x.t === 360)!;
    const moves = coachMatch({ ...m, duration: 900, stats: { ...m.stats, [p.slot]: [{ ...s, t: 720, netWorth: 12000 }] } }, { [p.hero]: [{ t: 720, avg: 8000, std: 1500 }] });
    const lane = moves.find(x => x.kind === 'laning' && x.slot === p.slot)!;
    expect(lane.note).toBe('!!');
    expect(lane.tags).toContain('LANE WON');
  });
});

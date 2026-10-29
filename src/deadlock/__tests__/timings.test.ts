import { describe, expect, it } from 'vitest';
import { timeline, timersAt, urnLane } from '../timings';

describe('Deadlock timings', () => {
  it('alternates the urn between the bridges, Yellow first', () => {
    expect(urnLane(600)).toBe('Yellow');
    expect(urnLane(900)).toBe('Green');
    expect(urnLane(1200)).toBe('Yellow');
  });
  it('brings the mid boss back 7, 6, then 5 minutes after each kill', () => {
    const kills = [{ t: 1300, team: 0 as const }, { t: 1800, team: 1 as const }, { t: 2300, team: 0 as const }];
    const mid = (t: number) => timersAt(t, kills).find(r => r.what === 'Mid boss')!;
    expect(mid(1200).now).toBe('up');
    expect(mid(1400).next).toBe(1300 + 420);
    expect(mid(1900).next).toBe(1800 + 360);
    expect(mid(2400).next).toBe(2300 + 300);
  });
  it('schedules the first spawns in order', () => {
    const ev = timeline(1200);
    expect(ev[0]).toMatchObject({ t: 120, kind: 'camps' });
    expect(ev.find(e => e.kind === 'urn')?.t).toBe(600);
    expect(ev.find(e => e.kind === 'buffs')?.t).toBe(300);
  });
});

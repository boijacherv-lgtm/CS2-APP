import { describe, expect, it } from 'vitest';
import { modelFor, type FeatureId } from '../coach';
import { COACH_MODEL } from '../coachModels';
import { cleanMatch, FEATURE_IDS, type ProfileMatch } from '../profile';
import { biggestLeak, percentile, skillMap, superpower } from '../profileView';

const L = modelFor(COACH_MODEL, 'Rifler').features;
const match = (i: number, o: Partial<ProfileMatch> = {}, f: Partial<Record<FeatureId, number>> = {}): ProfileMatch => ({
  id: `m${i}`, map: 'de_mirage', at: 1e12 + i * 1e8, rounds: 24, result: 'win', score: [13, 11], kills: 20, deaths: 15, adr: 85, kast: 72, hs: 50,
  impact: 1, lobby: 'B', level: null, gameRating: null, rank: null, engine: null,
  features: Object.fromEntries(FEATURE_IDS.map(id => [id, f[id] ?? L[id]?.baseline ?? 0])) as ProfileMatch['features'],
  mech: { react: null, aim: null, loud: null, stopped: null }, ...o,
});

describe('profile reading', () => {
  it('turns a gap into a percentile', () => {
    expect(percentile(0)).toBe(50);
    expect(percentile(1)).toBe(84);
    expect(percentile(-1)).toBe(16);
  });

  it('names the habit that costs most, with its rounds, and keeps the numbers through the Worker check', () => {
    const bad = L.isolatedDeaths!.baseline + 2 * L.isolatedDeaths!.spread, good = Math.max(0, L.openingDeaths!.baseline - 1.5 * L.openingDeaths!.spread);
    const ms = [0, 1, 2].map(i => match(i, { leaks: { isolatedDeaths: [0.06, [4, 9, 18]] }, clutch: [2, 1] }, { isolatedDeaths: bad, openingDeaths: good }));
    const leak = biggestLeak(ms)!;
    expect(leak.row.id).toBe('isolatedDeaths');
    expect(leak.cost).toBeCloseTo(0.06);
    expect(leak.clip?.rounds).toEqual([4, 9, 18]);
    expect(superpower(ms)?.row.id).toBe('openingDeaths');
    const back = cleanMatch(JSON.parse(JSON.stringify(ms[0])))!;
    expect(back.leaks).toEqual({ isolatedDeaths: [0.06, [4, 9, 18]] });
    expect(back.clutch).toEqual([2, 1]);
  });

  it('opens the skill map at 3 matches, with clutches counted', () => {
    expect(skillMap([match(0), match(1)])).toBeNull();
    const map = skillMap([0, 1, 2].map(i => match(i, { clutch: [1, 1] })))!;
    expect(map.map(s => s.name)).toEqual(['Aim duels', 'Trades', 'Utility', 'Positioning', 'Clutches']);
    expect(map.find(s => s.name === 'Trades')!.pct).toBe(50);
    expect(map.find(s => s.name === 'Clutches')!.clutch).toEqual([3, 3]);
  });
});

describe('clutches', () => {
  it('counts a 1v2+ the player ended up in, kill or no kill', async () => {
    const { clutchSide } = await import('../habits');
    const players = Object.fromEntries(['a', 'b', 'c', 'x', 'y', 'z'].map(id => [id, { side: ['a', 'b', 'c'].includes(id) ? 'CT' : 'T' }]));
    const round = (kills: { t: number; victim: string }[]) => ({ frames: { players }, kills }) as unknown as Parameters<typeof clutchSide>[0];
    expect(clutchSide(round([{ t: 1, victim: 'b' }, { t: 2, victim: 'c' }]), 'a')).toBe('CT'); // 1v3, no kill needed
    expect(clutchSide(round([{ t: 1, victim: 'b' }, { t: 2, victim: 'x' }, { t: 3, victim: 'y' }, { t: 4, victim: 'c' }]), 'a')).toBeNull(); // 1v1
    expect(clutchSide(round([{ t: 1, victim: 'a' }, { t: 2, victim: 'b' }]), 'a')).toBeNull(); // died first
  });
});

import { describe, expect, it } from 'vitest';
import { FEATURE_LABEL } from '../coach';
import { LETTERS } from '../recap';
import { averages, cleanGoals, cleanMatch, cleanPrefs, FEATURE_IDS, goalSeries, mapStats, MAX_GOALS, MAX_HISTORY, MECH_IDS, withMatch, type ProfileMatch } from '../profile';
import { addMatchFromServer, profileRoute, publicProfileOf, type ProfileKV } from '../../../worker/src/profile';

const match = (o: Partial<ProfileMatch> = {}): ProfileMatch => ({
  id: 'de_mirage|24|1.0', map: 'de_mirage', at: 1000, rounds: 24, result: 'win', score: [13, 11],
  kills: 20, deaths: 15, adr: 85, kast: 72, hs: 45, impact: 1.2, lobby: 'A', level: 'B', gameRating: 11000, rank: 10500, engine: 88,
  features: Object.fromEntries(FEATURE_IDS.map(k => [k, 0.2])) as ProfileMatch['features'],
  mech: { react: 0.5, aim: 8, loud: 0.2, stopped: 0.6 },
  ...o,
});

const memoryKV = (): ProfileKV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: async k => (data.has(k) ? JSON.parse(data.get(k)!) : null),
    put: async (k, v) => { data.set(k, v); },
    delete: async k => { data.delete(k); },
  };
};

describe('profile', () => {
  it('spells out the same numbers as the coach and the mechanics', () => {
    expect([...FEATURE_IDS].sort()).toEqual(Object.keys(FEATURE_LABEL).sort());
    expect([...MECH_IDS].sort()).toEqual(['aim', 'loud', 'react', 'stopped']);
    expect(LETTERS).toEqual(['S+', 'S', 'A', 'B', 'C', 'D', 'F']);
  });

  it('keeps a real summary and rejects anything else', () => {
    expect(cleanMatch(match())).toEqual(match());
    expect(cleanMatch({ ...match(), map: '../../etc' })).toBeNull();
    expect(cleanMatch({ ...match(), result: 'maybe' })).toBeNull();
    expect(cleanMatch({ ...match(), features: { adr: 80 } })).toBeNull();
    expect(cleanMatch('hello')).toBeNull();
    // out-of-range numbers are clamped, unknown fields dropped
    const c = cleanMatch({ ...match(), kills: 1e9, extra: 'x'.repeat(1e5) })!;
    expect(c.kills).toBe(200);
    expect('extra' in c).toBe(false);
  });

  it('keeps the newest matches, once each', () => {
    let list: ProfileMatch[] = [];
    for (let i = 0; i < MAX_HISTORY + 10; i++) list = withMatch(list, match({ id: `m${i}`, at: i }));
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].id).toBe(`m${MAX_HISTORY + 9}`);
    list = withMatch(list, match({ id: `m${MAX_HISTORY + 9}`, at: 1e6, kills: 3 }));
    expect(list.filter(m => m.id === `m${MAX_HISTORY + 9}`)).toHaveLength(1);
  });

  it('accepts up to three known goals, and only known settings', () => {
    expect(cleanGoals(['adr', 'adr', 'loud', 'nonsense', 'kast', 'hs']).map(g => g.id)).toEqual(['adr', 'loud', 'kast']);
    expect(cleanGoals(['adr', 'kast', 'hs', 'loud'])).toHaveLength(MAX_GOALS);
    expect(cleanPrefs({ public: 'yes', compare: 'pro' })).toEqual({ public: false, compare: 'pro' });
  });

  it('adds up matches, maps and a goal over time', () => {
    const list = [match({ id: 'a', at: 1, result: 'win', adr: 100 }), match({ id: 'b', at: 2, result: 'loss', adr: 60, map: 'de_inferno' }), match({ id: 'c', at: 3, result: 'win', adr: 80 })];
    const a = averages(list)!;
    expect(a.wins).toBe(2);
    expect(a.adr).toBeCloseTo(80);
    expect(mapStats(list)[0]).toMatchObject({ map: 'de_mirage', matches: 2, wins: 2 });
    expect(goalSeries(list, 'loud')).toEqual([0.2, 0.2, 0.2]);
  });

  it('shows the in-game Premier rating: the newest, and how far it moved', () => {
    const list = [match({ id: 'a', at: 1, rank: 10000 }), match({ id: 'b', at: 2, rank: 12 }), match({ id: 'c', at: 3, rank: 10450 })];
    expect(averages(list)).toMatchObject({ premier: 10450, premierMoved: 450 });
    expect(averages([match({ rank: null })])).toMatchObject({ premier: null, premierMoved: null });
  });

  it('stores what the website sends, per Steam account, and shares only public profiles', async () => {
    const kv = memoryKV();
    await profileRoute(kv, '76561190000000001', 'POST', '/profile/match', { match: match() });
    await profileRoute(kv, '76561190000000001', 'POST', '/profile/goals', { goals: ['loud'] });
    await expect(profileRoute(kv, '76561190000000001', 'POST', '/profile/match', { match: { id: 'x' } })).rejects.toThrow();
    const p = await profileRoute(kv, '76561190000000001', 'GET', '/profile', {}) as { matches: unknown[]; goals: { id: string }[] };
    expect(p.matches).toHaveLength(1);
    expect(p.goals.map(g => g.id)).toEqual(['loud']);
    expect(await publicProfileOf(kv, '76561190000000001')).toBeNull();
    await profileRoute(kv, '76561190000000001', 'POST', '/profile/prefs', { public: true });
    expect((await publicProfileOf(kv, '76561190000000001'))!.matches).toHaveLength(1);
    expect(await profileRoute(kv, '76561190000000001', 'POST', '/profile/other', {})).toBeNull();
  });

  it('takes matches the demo bot graded, and only real summaries', async () => {
    const kv = memoryKV();
    expect(await addMatchFromServer(kv, '76561190000000002', match({ id: 'bot' }))).toBe(true);
    expect(await addMatchFromServer(kv, '76561190000000002', { id: 'junk' })).toBe(false);
    const p = await profileRoute(kv, '76561190000000002', 'GET', '/profile', {}) as { matches: { id: string }[] };
    expect(p.matches.map(m => m.id)).toEqual(['bot']);
  });
});

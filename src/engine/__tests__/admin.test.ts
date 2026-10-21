import { describe, expect, it } from 'vitest';
import { adminStats, isOwner, saveHeartbeat, type AdminKV } from '../../../worker/src/admin';

const kv = (data: Record<string, unknown>): AdminKV & { data: Map<string, string> } => {
  const m = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data: m,
    get: async k => (m.has(k) ? JSON.parse(m.get(k)!) : null),
    put: async (k, v) => { m.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
  };
};

describe('dev page stats', () => {
  it('is only for the owner', () => {
    expect(isOwner('76561199107207687', '76561199107207687')).toBe(true);
    expect(isOwner('76561199107207687, 76561190000000001', '76561190000000001')).toBe(true);
    expect(isOwner('76561199107207687', '76561190000000002')).toBe(false);
    expect(isOwner(undefined, '76561199107207687')).toBe(false);
    expect(isOwner('76561199107207687', null)).toBe(false);
  });

  it('counts profiles, match lists and the bot', async () => {
    const store = kv({
      'stats:1': { matches: [{ map: 'de_mirage', result: 'win', at: 5 }, { map: 'de_dust2', result: 'loss', at: 9 }], goals: [{ id: 'adr', since: 1 }], prefs: { public: true, compare: 'lvl10' }, notifyPro: true },
      'stats:2': { matches: [{ map: 'de_mirage', result: 'win', at: 3 }], goals: [], prefs: { public: false, compare: 'lvl10' }, notifyPro: false },
      'user:1': { authCode: 'A', knownCode: 'B', lastSyncAt: 7, matches: [{ outcomeId: '11', foundAt: 1, parsed: true }, { outcomeId: '12', foundAt: 2, error: 'boom', tries: 3 }] },
      'session:x': '1', 'demo:11': 'gz',
    });
    await saveHeartbeat(store, { users: 1, handled: 2, ready: 1, failed: 1, gone: 0, cycleMs: 1000, grading: true, version: 'abc', junk: 'x' });
    const s = await adminStats(store);
    expect(s.keys).toEqual({ users: 1, profiles: 2, sessions: 1, demos: 1 });
    expect(s.profiles).toMatchObject({ matches: 3, public: 1, notifyPro: 1, withGoals: 1, lastMatchAt: 9, maps: { de_mirage: 2, de_dust2: 1 } });
    expect(s.lists).toMatchObject({ withCodes: 1, matches: 2, parsed: 1, failing: 1 });
    expect(s.lists.errors[0].error).toBe('boom');
    expect(s.bot).toMatchObject({ handled: 2, grading: true, version: 'abc' });
    expect(s.bot).not.toHaveProperty('junk');
  });
});

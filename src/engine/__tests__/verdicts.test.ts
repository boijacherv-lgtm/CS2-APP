import { describe, expect, it } from 'vitest';
import { cleanVerdict, MAX_VERDICTS, verdictKey, withVerdict, type MoveVerdict } from '../profile';
import { isTest } from '../split';
import { profileRoute, type ProfileKV } from '../../../worker/src/profile';

const v = (o: Partial<MoveVerdict> = {}): MoveVerdict => ({
  match: 'de_mirage-24-abc', map: 'de_mirage', round: 3, t: 41.2, player: '76561199107207687', kind: 'death', title: 'died at A',
  coach: '?', verdict: 'ok', reason: 'unlucky', at: 1, ...o,
});
function memoryKV(): ProfileKV {
  const m = new Map<string, string>();
  return { get: async (k: string) => (m.has(k) ? JSON.parse(m.get(k)!) : null), put: async (k: string, val: string) => { m.set(k, val); }, delete: async (k: string) => { m.delete(k); } } as unknown as ProfileKV;
}

describe('coach verdicts', () => {
  it('keeps a clean verdict and refuses junk', () => {
    expect(cleanVerdict(v())).toMatchObject({ verdict: 'ok', reason: 'unlucky', round: 3 });
    expect(cleanVerdict({ ...v(), verdict: 'maybe' })).toBeNull();
    expect(cleanVerdict({ ...v(), reason: 'because' })).toBeNull();
    expect(cleanVerdict({ ...v(), match: '' })).toBeNull();
  });
  it('one verdict per move, newest first, capped, and can be taken back', () => {
    let list = withVerdict([], v());
    list = withVerdict(list, v({ reason: 'role' }));
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('role');
    list = withVerdict(list, v({ t: 50 }));
    expect(list).toHaveLength(2);
    expect(withVerdict(list, { remove: verdictKey(v()) })).toHaveLength(1);
    let many: MoveVerdict[] = [];
    for (let i = 0; i < MAX_VERDICTS + 20; i++) many = withVerdict(many, v({ t: i }));
    expect(many).toHaveLength(MAX_VERDICTS);
  });
  it('the Worker route saves and removes them', async () => {
    const kv = memoryKV(), id = '76561190000000042';
    const p = await profileRoute(kv, id, 'POST', '/profile/verdict', { verdict: v() }) as { verdicts: MoveVerdict[] };
    expect(p.verdicts).toHaveLength(1);
    const q = await profileRoute(kv, id, 'POST', '/profile/verdict', { remove: verdictKey(v()) }) as { verdicts: MoveVerdict[] };
    expect(q.verdicts).toHaveLength(0);
    await expect(profileRoute(kv, id, 'POST', '/profile/verdict', { verdict: { nope: 1 } })).rejects.toThrow();
  });
});

describe('held-out matches', () => {
  it('the same match is always in the same group, and about 1 in 5 is held out', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `1-${i.toString(16).padStart(8, '0')}-match`);
    expect(ids.map(i => isTest(i))).toEqual(ids.map(i => isTest(i)));
    const share = ids.filter(i => isTest(i)).length / ids.length;
    expect(share).toBeGreaterThan(0.17); expect(share).toBeLessThan(0.23);
  });
});

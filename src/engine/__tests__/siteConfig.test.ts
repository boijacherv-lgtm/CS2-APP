import { describe, expect, it } from 'vitest';
import { cleanConfig, DEFAULT_CONFIG, deleteUser, loadConfig, saveConfig, siteLog, undo, users, type SiteKV } from '../../../worker/src/site';

/** An in-memory KV, enough for site.ts. */
function memKV(): SiteKV & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return {
    m,
    async get(k: string, type?: 'json') { const v = m.get(k) ?? null; return type === 'json' ? (v ? JSON.parse(v) : null) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  } as SiteKV & { m: Map<string, string> };
}

describe('site config (dev page → Content)', () => {
  it('keeps only what the site understands, within limits', () => {
    const c = cleanConfig({ banner: { on: true, text: 'x'.repeat(500), link: 'javascript:alert(1)' }, maintenance: ['cs2', 'nope'], samples: { cs2: '../etc/passwd', deadlock: -3 },
      rage: { teamKill: { chance: 2, lines: [{ text: 'Hi', weight: 9 }] }, 'bad key!': { chance: 0.5 } }, banned: ['76561199107207687', 'x'] });
    expect(c.banner.text.length).toBe(200);
    expect(c.banner.link).toBe('');
    expect(c.maintenance).toEqual(['cs2']);
    expect(c.samples).toEqual(DEFAULT_CONFIG.samples);
    expect(c.rage).toEqual({ teamKill: { lines: [{ text: 'Hi', weight: 3 }] } });
    expect(c.banned).toEqual(['76561199107207687']);
  });

  it('logs every change and undoes it', async () => {
    const kv = memKV();
    const { config } = await saveConfig(kv, 'owner', { flags: { ...DEFAULT_CONFIG.flags, rage: false } });
    expect(config.flags.rage).toBe(false);
    const { rows } = await siteLog(kv);
    expect(rows[0].what).toMatch(/config/);
    await undo(kv, 'owner', rows[0].at);
    expect((await loadConfig(kv)).flags.rage).toBe(true);
  });

  it('deletes a user with a 7-day undo', async () => {
    const kv = memKV();
    const id = '76561199107207687';
    kv.m.set(`stats:${id}`, JSON.stringify({ matches: [{ at: 1, name: 'Benaiah' }] }));
    expect((await users(kv, 'bena', [])).rows[0].steamId).toBe(id);
    await deleteUser(kv, 'owner', id);
    expect(kv.m.has(`stats:${id}`)).toBe(false);
    await undo(kv, 'owner', (await siteLog(kv)).rows[0].at);
    expect(kv.m.has(`stats:${id}`)).toBe(true);
  });
});

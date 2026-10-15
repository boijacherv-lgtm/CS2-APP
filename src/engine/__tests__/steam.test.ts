import { describe, expect, it } from 'vitest';
import { decodeShareCode, downloadLink, outcomeFromFileName } from '../../../tools/steam.mjs';

describe('steam match codes', () => {
  it('decodes a share code to the ids in the demo file name', () => {
    // the Ancient demo match730_003847732607018074171_0422097200_274.dem came from this share code
    expect(decodeShareCode('CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND')).toEqual({ matchId: '3847727115902386227', outcomeId: '3847732607018074171', token: 45360 });
    expect(outcomeFromFileName('match730_003847732607018074171_0422097200_274.dem')).toBe('3847732607018074171');
    expect(outcomeFromFileName('faceit-demo.dem')).toBeNull();
    expect(() => decodeShareCode('CSGO-xxxxx')).toThrow();
  });
  it("builds Valve's own CS2 download link", () => {
    expect(downloadLink('CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND')).toBe('steam://rungame/730/76561202255233023/+csgo_download_match%20CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND');
  });
});

describe('Sign in through Steam (OpenID)', async () => {
  const { openIdStartUrl, openIdVerify } = await import('../../../tools/steam.mjs');
  const origin = 'http://localhost:5173';
  it("sends you to Steam's own login page and back to this app", async () => {
    const u = new URL(openIdStartUrl(origin));
    expect(u.origin + u.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(u.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(u.searchParams.get('openid.return_to')).toBe('http://localhost:5173/api/steam/openid/return?back=%23%2Fcs2%2Freview');
    // only in-app pages to come back to
    const { safeBack } = await import('../../../tools/steam.mjs');
    expect(safeBack('#/cs2/tactical')).toBe('#/cs2/tactical');
    expect(safeBack('https://evil.example')).toBe('#/cs2/review');
    expect(u.searchParams.get('openid.realm')).toBe(origin);
  });
  it('rejects answers that are not from Steam or not for this app (before asking Steam)', async () => {
    const answer = (over: Record<string, string>) => new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res',
      'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
      'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561197960287930',
      'openid.identity': 'https://steamcommunity.com/openid/id/76561197960287930',
      'openid.return_to': `${origin}/api/steam/openid/return`, 'openid.response_nonce': 'n1', ...over,
    }).toString();
    await expect(openIdVerify(origin, answer({ 'openid.mode': 'cancel' }))).rejects.toThrow(/cancelled/);
    await expect(openIdVerify(origin, answer({ 'openid.op_endpoint': 'https://evil.example/openid/login' }))).rejects.toThrow(/did not come from Steam/);
    await expect(openIdVerify(origin, answer({ 'openid.return_to': 'http://evil.example/api/steam/openid/return' }))).rejects.toThrow(/another site/);
    await expect(openIdVerify(origin, answer({ 'openid.claimed_id': 'https://evil.example/openid/id/76561197960287930' }))).rejects.toThrow(/which account/);
  });
});

describe('smart paste', async () => {
  const { extractFromText } = await import('../../../tools/steam.mjs');
  it('picks the codes out of copied Steam pages', () => {
    const support = 'Authentication Code\nYour code: AB12-CD34E-FG56\nYour most recently completed match token: CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND\n';
    expect(extractFromText(support)).toEqual({ authCode: 'AB12-CD34E-FG56', apiKey: null, codes: ['CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND'] });
    expect(extractFromText('Your Steam Web API Key\nKey: 0123456789ABCDEF0123456789ABCDEF\nDomain Name: localhost').apiKey).toBe('0123456789ABCDEF0123456789ABCDEF');
    expect(extractFromText('steam://rungame/730/76561202255233023/+csgo_download_match%20CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND').codes).toEqual(['CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND']);
    expect(extractFromText('nothing to see here')).toEqual({ authCode: null, apiKey: null, codes: [] });
  });
});

describe('shared share-code module (website + Cloudflare Worker)', async () => {
  const shared = await import('../sharecode');
  const local = await import('../../../tools/steam.mjs');
  it('decodes and extracts exactly like the local server', () => {
    const code = 'CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND';
    expect(shared.decodeShareCode(code)).toEqual(local.decodeShareCode(code));
    const page = 'code: AB12-CD34E-FG56 match: CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND key 0123456789ABCDEF0123456789ABCDEF';
    expect(shared.extractFromText(page)).toEqual(local.extractFromText(page));
    expect(shared.downloadLink(code)).toBe(local.downloadLink(code));
  });
  it("builds Steam's OpenID login link back to the website", () => {
    const u = new URL(shared.openIdLoginUrl('https://tsakhstvo.xyz/?back=%23%2Fcs2%2Freview', 'https://tsakhstvo.xyz'));
    expect(u.origin + u.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(u.searchParams.get('openid.return_to')).toBe('https://tsakhstvo.xyz/?back=%23%2Fcs2%2Freview');
    expect(u.searchParams.get('openid.realm')).toBe('https://tsakhstvo.xyz');
  });
});

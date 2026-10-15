/**
 * CS2 match share codes and the official Steam links around them. Pure functions with no Node APIs, so
 * the website, the Cloudflare Worker (worker/) and tests can all use them. tools/steam.mjs (the local
 * dev server) has the same logic for Node.
 */

const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
export const SHARE_CODE = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

/** CSGO-xxxxx-… → match id, outcome id (the number in the demo's file name) and token. */
export function decodeShareCode(code: string): { matchId: string; outcomeId: string; token: number } {
  if (!SHARE_CODE.test(code)) throw new Error('Not a share code.');
  let n = 0n;
  for (const c of code.slice(5).replace(/-/g, '').split('').reverse()) {
    const i = DICT.indexOf(c);
    if (i < 0) throw new Error('Not a share code.');
    n = n * 57n + BigInt(i);
  }
  const bytes = new Uint8Array(18);
  for (let i = 17; i >= 0; i--) { bytes[i] = Number(n & 0xffn); n >>= 8n; }
  const view = new DataView(bytes.buffer);
  return {
    matchId: view.getBigUint64(0, true).toString(),
    outcomeId: view.getBigUint64(8, true).toString(),
    token: view.getUint16(16, true),
  };
}

/** Valve's own link: opens CS2 and downloads that match's demo into game/csgo/replays. */
export const downloadLink = (code: string) => `steam://rungame/730/76561202255233023/+csgo_download_match%20${code}`;

/** "match730_003847732607018074171_0422097200_274.dem" → "3847732607018074171". */
export const outcomeFromFileName = (name: string) => name.match(/match730_0*(\d+)_/)?.[1] ?? null;

const isValidCode = (c: string) => { try { decodeShareCode(c); return true; } catch { return false; } };

/**
 * Smart paste: finds the authentication code, Web API key and any share codes in text copied from Steam's
 * pages (Steam Support → CS2 → authentication code, steamcommunity.com/dev/apikey, CS2 share links).
 */
export function extractFromText(text: string): { authCode: string | null; apiKey: string | null; codes: string[] } {
  const t = String(text ?? '');
  const codes = [...new Set([...t.matchAll(/CSGO(?:-[A-Za-z0-9]{5}){5}/g)].map(m => m[0]))].filter(isValidCode);
  const authCode = [...t.matchAll(/(?<![A-Za-z0-9-])([A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4})(?![A-Za-z0-9-])/g)].map(m => m[1]).find(c => !c.startsWith('CSGO')) ?? null;
  const apiKey = t.match(/(?<![0-9A-Fa-f])([0-9A-F]{32})(?![0-9A-Fa-f])/)?.[1] ?? null;
  return { authCode, apiKey, codes };
}

/** Oldest first: CS2 match ids grow over time. */
export const byAge = (codes: string[]) =>
  [...codes].sort((a, b) => (BigInt(decodeShareCode(a).matchId) < BigInt(decodeShareCode(b).matchId) ? -1 : 1));

export const AUTH_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/i;

/** Steam OpenID 2.0: where to send the browser to log in, coming back to `returnTo`. */
export const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
export function openIdLoginUrl(returnTo: string, realm: string) {
  const ns = 'http://specs.openid.net/auth/2.0';
  return `${OPENID_ENDPOINT}?${new URLSearchParams({
    'openid.ns': ns, 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo, 'openid.realm': realm,
    'openid.identity': `${ns}/identifier_select`, 'openid.claimed_id': `${ns}/identifier_select`,
  })}`;
}

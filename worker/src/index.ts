/**
 * Stratboard API for the website (tsakhstvo.xyz), on Cloudflare Workers.
 *
 *   Log in with Steam  Steam OpenID 2.0. Steam sends the browser back to the website itself; the site posts
 *                      Steam's signed answer here, we confirm it with Steam (check_authentication) and hand
 *                      back a session token (Authorization: Bearer …). We only ever learn the SteamID.
 *   Your matches       Valve's official match-history Web API (GetNextMatchSharingCode) with the site's own
 *                      Web API key (secret STEAM_API_KEY) + each user's game authentication code and one
 *                      share code, which they paste once. Stored per SteamID in KV.
 *
 * Never add Steam login automation (steam-session / steam-user / logging in as the user): Steam flagged that
 * as malicious on the owner's account. Public and official APIs only.
 */
import { AUTH_CODE, byAge, decodeShareCode, downloadLink, extractFromText, OPENID_ENDPOINT, SHARE_CODE } from '../../src/engine/sharecode';

export interface Env {
  SB: KVNamespace;
  /** wrangler secret put STEAM_API_KEY */
  STEAM_API_KEY: string;
  /** Comma-separated origins allowed to call this API (the website). */
  SITE_ORIGINS: string;
  /** Where Steam sends the browser back after logging in (the website, e.g. https://tsakhstvo.xyz/). */
  RETURN_TO: string;
}

interface Match { code: string; matchId: string; outcomeId: string; foundAt: number }
interface User { authCode?: string; knownCode?: string; lastCode?: string | null; matches: Match[]; lastSyncAt?: number; note?: string | null }

const SESSION_DAYS = 30;
const SYNC_EVERY_MS = 60_000; // Valve is asked at most once a minute per user
const STEAM_API = 'https://api.steampowered.com';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = env.SITE_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    const cors: Record<string, string> = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
    // only the website may call this (blocks other sites from using a visitor's token)
    if (origin && !allowed.includes(origin)) return json({ error: 'Not allowed from this site.' }, 403);

    const path = new URL(req.url).pathname;
    try {
      if (req.method === 'POST' && path === '/openid/verify') return json(await verifyLogin(env, await body(req)));

      // everything else needs a logged-in user
      const token = req.headers.get('Authorization')?.match(/^Bearer ([\w-]{20,})$/)?.[1];
      const steamId = token ? await env.SB.get(`session:${token}`) : null;
      if (path === '/me' && req.method === 'GET') return json({ me: steamId ? { steamId, ...(await publicProfile(env, steamId)) } : null });
      if (!steamId) return json({ error: 'Log in with Steam first.' }, 401);

      if (req.method === 'GET' && path === '/status') return json(status(env, steamId, await loadUser(env, steamId)));
      if (req.method !== 'POST') return json({ error: 'Not found.' }, 404);
      const input = await body(req);
      if (path === '/signout') { await env.SB.delete(`session:${token}`); return json({ ok: true }); }
      if (path === '/forget') { await env.SB.delete(`user:${steamId}`); return json({ ok: true }); }
      if (path === '/settings') return json(await saveSettings(env, steamId, input));
      if (path === '/sync') return json(await sync(env, steamId));
      return json({ error: 'Not found.' }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  },
};

async function body(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 20_000) throw new Error('Too much text.');
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

// ---- Log in with Steam (OpenID 2.0) -----------------------------------------------------------------

async function verifyLogin(env: Env, input: Record<string, unknown>) {
  const raw = (input.params ?? {}) as Record<string, unknown>;
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (k.startsWith('openid.') && typeof v === 'string') p[k] = v;
  if (p['openid.mode'] !== 'id_res') throw new Error('Steam sign-in was cancelled.');
  if (p['openid.op_endpoint'] !== OPENID_ENDPOINT) throw new Error('That answer did not come from Steam.');
  if (!(p['openid.return_to'] ?? '').startsWith(env.RETURN_TO)) throw new Error('That answer was meant for another site.');
  const steamId = p['openid.claimed_id']?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(7656\d{13})$/)?.[1];
  if (!steamId || p['openid.identity'] !== p['openid.claimed_id']) throw new Error('Steam did not say which account signed in.');
  const nonce = p['openid.response_nonce'];
  if (!nonce || nonce.length > 200 || (await env.SB.get(`nonce:${nonce}`))) throw new Error('This sign-in was already used; please log in again.');
  // ask Steam whether it really signed this (otherwise anyone could forge the answer)
  const res = await fetch(OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...p, 'openid.mode': 'check_authentication' }),
  });
  if (!/is_valid\s*:\s*true/.test(await res.text())) throw new Error('Steam did not confirm the sign-in.');
  await env.SB.put(`nonce:${nonce}`, '1', { expirationTtl: 2 * 24 * 3600 });
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  await env.SB.put(`session:${token}`, steamId, { expirationTtl: SESSION_DAYS * 24 * 3600 });
  return { token, steamId };
}

/** Public Steam name + avatar (public profile XML, cached for an hour). */
async function publicProfile(env: Env, steamId: string): Promise<{ name: string | null; avatar: string | null }> {
  const cached = await env.SB.get(`profile:${steamId}`, 'json') as { name: string | null; avatar: string | null } | null;
  if (cached) return cached;
  try {
    const xml = await (await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`)).text();
    const tag = (t: string) => xml.match(new RegExp(`<${t}><!\\[CDATA\\[(.*?)\\]\\]></${t}>`))?.[1] ?? xml.match(new RegExp(`<${t}>(.*?)</${t}>`))?.[1] ?? null;
    const value = { name: tag('steamID'), avatar: tag('avatarMedium') };
    await env.SB.put(`profile:${steamId}`, JSON.stringify(value), { expirationTtl: 3600 });
    return value;
  } catch { return { name: null, avatar: null }; }
}

// ---- the user's match list --------------------------------------------------------------------------

async function loadUser(env: Env, steamId: string): Promise<User> {
  return ((await env.SB.get(`user:${steamId}`, 'json')) as User | null) ?? { matches: [] };
}
const saveUser = (env: Env, steamId: string, u: User) => env.SB.put(`user:${steamId}`, JSON.stringify(u));

async function saveSettings(env: Env, steamId: string, input: Record<string, unknown>) {
  const u = await loadUser(env, steamId);
  const pasted = typeof input.paste === 'string' && input.paste ? extractFromText(input.paste) : null;
  if (pasted && !pasted.authCode && !pasted.codes.length) throw new Error('No authentication code or match code found in that text: copy the whole Steam page (Ctrl/Cmd+A, Ctrl/Cmd+C) and paste it again.');
  const auth = (typeof input.authCode === 'string' && input.authCode.trim()) || pasted?.authCode || '';
  if (auth) { if (!AUTH_CODE.test(auth)) throw new Error('The authentication code looks like AAAA-AAAAA-AAAA.'); u.authCode = auth.toUpperCase(); }
  const codes = byAge([...(pasted?.codes ?? []), ...(typeof input.knownCode === 'string' && SHARE_CODE.test(input.knownCode.trim()) ? [input.knownCode.trim()] : [])]);
  if (typeof input.knownCode === 'string' && input.knownCode.trim() && !SHARE_CODE.test(input.knownCode.trim())) throw new Error('The share code looks like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.');
  if (codes.length) {
    // the oldest code is where Valve starts walking; all of them go on the list right away
    const oldest = codes[0];
    if (!u.knownCode || BigInt(decodeShareCode(oldest).matchId) < BigInt(decodeShareCode(u.knownCode).matchId)) { u.knownCode = oldest; u.lastCode = null; }
    const have = new Set(u.matches.map(m => m.code));
    const t0 = Date.now();
    codes.forEach((c, i) => { if (!have.has(c)) u.matches.push({ code: c, ...decodeShareCode(c), foundAt: t0 - (codes.length - i) }); });
  }
  u.lastSyncAt = 0; // check right away with the new codes
  await saveUser(env, steamId, u);
  const c = configured(env, u);
  return pasted ? { ...c, found: { authCode: !!pasted.authCode, apiKey: false, codes: pasted.codes.length } } : c;
}

async function sync(env: Env, steamId: string) {
  const u = await loadUser(env, steamId);
  const before = u.matches.length;
  if (!u.authCode || !u.knownCode) return { added: 0, note: 'Paste your authentication code and one match code first.', source: null };
  if (!env.STEAM_API_KEY) return { added: 0, note: 'The site has no Steam Web API key configured yet.', source: null };
  if (u.lastSyncAt && Date.now() - u.lastSyncAt < SYNC_EVERY_MS) return { added: 0, note: u.note ?? null, source: 'valve' };
  u.note = null;
  const known = new Set(u.matches.map(m => m.code));
  const t0 = Date.now();
  let code = u.lastCode ?? u.knownCode, found = 0;
  try {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${STEAM_API}/ICSGOPlayers_730/GetNextMatchSharingCode/v1?key=${encodeURIComponent(env.STEAM_API_KEY)}`
        + `&steamid=${steamId}&steamidkey=${encodeURIComponent(u.authCode)}&knowncode=${encodeURIComponent(code)}`);
      if (res.status === 202) break; // no newer match yet
      if (res.status === 403) throw new Error('Steam refused the site\'s Web API key; tell the site owner.');
      if (res.status === 412) throw new Error('Steam says your authentication code or match code doesn\'t belong to your account. Paste them again from the Steam Support page.');
      if (res.status === 429) break;
      if (!res.ok) throw new Error(`Steam's match-history API answered ${res.status}.`);
      const next = ((await res.json()) as { result?: { nextcode?: string } })?.result?.nextcode;
      if (!next || next === 'n/a') break;
      if (!known.has(next)) { known.add(next); u.matches.push({ code: next, ...decodeShareCode(next), foundAt: t0 + found++ }); }
      code = next;
    }
  } catch (e) { u.note = e instanceof Error ? e.message : String(e); }
  u.lastCode = code;
  u.lastSyncAt = Date.now();
  await saveUser(env, steamId, u);
  return { added: u.matches.length - before, note: u.note ?? null, source: 'valve' };
}

function configured(env: Env, u: User) {
  return { steamId: true, apiKey: !!env.STEAM_API_KEY, authCode: !!u.authCode, knownCode: !!u.knownCode, replays: false };
}

/** Same shape as the local dev server's status (tools/steam.d.mts SteamStatus), minus what only a PC can do. */
function status(env: Env, steamId: string, u: User) {
  return {
    configured: configured(env, u),
    steamId,
    source: u.knownCode ? 'valve' : null,
    note: u.note ?? null,
    syncing: false,
    replays: [],
    importing: { file: null, error: null },
    matches: [...u.matches].sort((a, b) => b.foundAt - a.foundAt).map(m => ({
      code: m.code, outcomeId: m.outcomeId, source: 'matchmaking', time: null, loadedAt: null, foundAt: m.foundAt,
      map: null, scores: null, result: null, kd: null, download: downloadLink(m.code), parsed: false,
    })),
  };
}

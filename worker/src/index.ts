/**
 * Stratboard API for the website (tsakhstvo.xyz), on Cloudflare Workers.
 *
 *   Log in with Steam  Steam OpenID 2.0. Steam sends the browser back to the website itself; the site posts
 *                      Steam's signed answer here, we confirm it with Steam (check_authentication) and hand
 *                      back a session token (Authorization: Bearer …). We only ever learn the SteamID.
 *   Your matches       Valve's official match-history Web API (GetNextMatchSharingCode) with the site's own
 *                      Web API key (secret STEAM_API_KEY) + each user's game authentication code and one
 *                      share code, which they paste once. Stored per SteamID in KV.
 *   Profile            the matches you reviewed (summaries), goals and settings, per SteamID (profile.ts).
 *   Demos              The Stratboard server (server/, on an always-on machine) asks /internal/* which matches are
 *                      new, fetches each demo with its own *bot* Steam account, parses it and sends back the
 *                      result (gzipped JSON in KV, served at /demo/:outcomeId). Guarded by secret SERVER_TOKEN.
 *
 * Never add Steam login automation (steam-session / steam-user / logging in as the user): Steam flagged that
 * as malicious on the owner's account. Public and official APIs only.
 */
import { adminStats, isOwner, saveHeartbeat } from './admin';
import { clipData, clipList, corrections, MAX_CLIP_BYTES, removeClip, removeMove, restoreMove, ruledClips, saveClip, updateClip } from './clips';
import { addMatchFromServer, forgetProfile, profileRoute, publicProfileOf, resolveSteamId } from './profile';
import { AUTH_CODE, byAge, decodeShareCode, downloadLink, extractFromText, OPENID_ENDPOINT, SHARE_CODE } from '../../src/engine/sharecode';

export interface Env {
  SB: KVNamespace;
  /** wrangler secret put STEAM_API_KEY */
  STEAM_API_KEY: string;
  /** wrangler secret put SERVER_TOKEN (shared with the Stratboard server) */
  SERVER_TOKEN: string;
  /** Comma-separated origins allowed to call this API (the website). */
  SITE_ORIGINS: string;
  /** Where Steam sends the browser back after logging in (the website, e.g. https://tsakhstvo.xyz/). */
  RETURN_TO: string;
  /** Comma-separated SteamIDs that may open the dev page (GET /admin/stats). */
  OWNER_IDS?: string;
}

interface Match {
  code: string; matchId: string; outcomeId: string; foundAt: number;
  // filled in by the server once the demo is processed
  time?: number | null; map?: string | null; scores?: [number, number] | null; result?: 'win' | 'loss' | 'tie' | null; kd?: [number, number] | null;
  parsed?: boolean; gone?: boolean; error?: string | null; tries?: number;
}
interface User { authCode?: string; knownCode?: string; lastCode?: string | null; matches: Match[]; lastSyncAt?: number; note?: string | null }

const SESSION_DAYS = 30;
const SYNC_EVERY_MS = 60_000; // Valve is asked at most once a minute per user
const STEAM_API = 'https://api.steampowered.com';
const MAX_TRIES = 3; // the server gives up on a demo after this many failures
const MAX_DEMO_BYTES = 24 * 1024 * 1024; // KV values must stay under 25 MB

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
      if (path.startsWith('/internal/')) return await internal(req, env, path, json);

      // the coach's corrections from checked disputes: public (they're counts per kind of move), cached a few minutes
      if (req.method === 'GET' && path === '/corrections')
        return new Response(JSON.stringify(await corrections(env.SB)), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...cors } });
      if (req.method === 'GET' && path === '/profiles') return json({ profiles: await profiles(env, new URL(req.url).searchParams.get('ids') ?? '') });
      // a friend's profile, when they made it public (name, avatar and their last matches' numbers)
      const pub = path.match(/^\/public\/(7656\d{13})$/);
      if (req.method === 'GET' && pub) {
        const p = await publicProfileOf(env.SB, pub[1]);
        return p ? json({ steamId: pub[1], ...(await publicProfile(env, pub[1])), ...p }) : json({ error: 'That player has no public Stratboard profile.' }, 404);
      }

      // everything else needs a logged-in user
      const token = req.headers.get('Authorization')?.match(/^Bearer ([\w-]{20,})$/)?.[1];
      const steamId = token ? await env.SB.get(`session:${token}`) : null;
      if (path === '/me' && req.method === 'GET') return json({ me: steamId ? { steamId, ...(await publicProfile(env, steamId)), ...(isOwner(env.OWNER_IDS, steamId) ? { owner: true } : {}) } : null });
      if (!steamId) return json({ error: 'Log in with Steam first.' }, 401);

      if (req.method === 'GET' && path === '/status') return json(status(env, steamId, await loadUser(env, steamId)));
      if (req.method === 'GET' && path === '/admin/stats') {
        if (!isOwner(env.OWNER_IDS, steamId)) return json({ error: 'Only the site owner can see this.' }, 403);
        return json(await adminStats(env.SB));
      }
      // disputed moments ("Coach wrong?"): the player sends the round, the owner watches it on the dev page
      if (req.method === 'POST' && path === '/clip') {
        const text = await req.text();
        if (text.length > MAX_CLIP_BYTES) return json({ error: 'That round is too big to send.' }, 413);
        return json(await saveClip(env.SB, steamId, text));
      }
      if (req.method === 'POST' && path === '/clip/remove') return json(await removeClip(env.SB, steamId, (await body(req)).key));
      // the owner taking a moment's mark off by hand, or putting it back
      if (req.method === 'POST' && (path === '/admin/remove-move' || path === '/admin/restore-move')) {
        if (!isOwner(env.OWNER_IDS, steamId)) return json({ error: 'Only the site owner can do this.' }, 403);
        if (path === '/admin/restore-move') return json(await restoreMove(env.SB, steamId, (await body(req)).key));
        const text = await req.text();
        if (text.length > MAX_CLIP_BYTES) return json({ error: 'That round is too big to send.' }, 413);
        return json(await removeMove(env.SB, steamId, text));
      }
      const clip = path.match(/^\/admin\/clip\/([0-9a-f]{24})$/);
      if (path === '/admin/clips' || clip) {
        if (!isOwner(env.OWNER_IDS, steamId)) return json({ error: 'Only the site owner can see this.' }, 403);
        if (path === '/admin/clips') return json(await clipList(env.SB));
        if (req.method === 'POST') return json(await updateClip(env.SB, clip![1], await body(req)));
        const gz = await clipData(env.SB, clip![1]);
        if (!gz) return json({ error: 'That moment is gone.' }, 404);
        return new Response(gz, { encodeBody: 'manual', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'private, max-age=86400', ...cors } });
      }
      if (req.method === 'GET' && path === '/resolve') {
        const id = await resolveSteamId(new URL(req.url).searchParams.get('q') ?? '', env.STEAM_API_KEY);
        return id ? json({ steamId: id }) : json({ error: 'No Steam account found for that.' }, 404);
      }
      if (path.startsWith('/profile')) {
        const out = await profileRoute(env.SB, steamId, req.method, path, req.method === 'POST' ? await body(req) : {});
        if (out) return json(out);
      }
      const demo = path.match(/^\/demo\/(\d{5,25})$/);
      if (req.method === 'GET' && demo) {
        const u = await loadUser(env, steamId);
        if (!u.matches.some(m => m.outcomeId === demo[1] && m.parsed)) return json({ error: 'Not one of your processed matches.' }, 404);
        const gz = await env.SB.get(`demo:${demo[1]}`, 'arrayBuffer');
        if (!gz) return json({ error: 'This match is not stored any more.' }, 404);
        // the browser unpacks it (Content-Encoding: gzip)
        // already gzipped: 'manual' stops Cloudflare from compressing it a second time
        return new Response(gz, { encodeBody: 'manual', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'private, max-age=86400', ...cors } });
      }
      if (req.method !== 'POST') return json({ error: 'Not found.' }, 404);
      const input = await body(req);
      if (path === '/signout') { await env.SB.delete(`session:${token}`); return json({ ok: true }); }
      if (path === '/forget') { await env.SB.delete(`user:${steamId}`); await forgetProfile(env.SB, steamId); return json({ ok: true }); }
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

/** Public Steam name + avatar: the Web API, else the public profile XML. */
async function publicProfile(env: Env, steamId: string): Promise<{ name: string | null; avatar: string | null }> {
  // the Web API first (GetPlayerSummaries, cached a day); Steam's XML profile page often doesn't answer Cloudflare
  const viaApi = (await profiles(env, steamId))[steamId];
  if (viaApi?.name) return viaApi;
  const cached = await env.SB.get(`profile:${steamId}`, 'json') as { name: string | null; avatar: string | null } | null;
  if (cached?.name) return cached;
  try {
    const xml = await (await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`)).text();
    const tag = (t: string) => xml.match(new RegExp(`<${t}><!\\[CDATA\\[(.*?)\\]\\]></${t}>`))?.[1] ?? xml.match(new RegExp(`<${t}>(.*?)</${t}>`))?.[1] ?? null;
    const value = { name: tag('steamID'), avatar: tag('avatarMedium') };
    // an answer without a name (blocked, busy) isn't kept: the next call tries again
    if (value.name) await env.SB.put(`profile:${steamId}`, JSON.stringify(value), { expirationTtl: 3600 });
    return value;
  } catch { return { name: null, avatar: null }; }
}

/**
 * Public names + avatars of the players in a match (up to 20 SteamIDs, comma-separated). Avatars are public even
 * on private profiles. One GetPlayerSummaries call for the ones not cached; each is kept a day.
 */
async function profiles(env: Env, raw: string): Promise<Record<string, { name: string | null; avatar: string | null }>> {
  const ids = [...new Set(raw.split(',').map(s => s.trim()).filter(s => /^7656\d{13}$/.test(s)))].slice(0, 20);
  const out: Record<string, { name: string | null; avatar: string | null }> = {};
  const missing: string[] = [];
  await Promise.all(ids.map(async id => {
    const c = await env.SB.get(`avatar:${id}`, 'json') as { name: string | null; avatar: string | null } | null;
    if (c) out[id] = c; else missing.push(id);
  }));
  if (missing.length && env.STEAM_API_KEY) {
    try {
      const res = await fetch(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(env.STEAM_API_KEY)}&steamids=${missing.join(',')}`);
      const list = res.ok ? ((await res.json()) as { response?: { players?: { steamid: string; personaname?: string; avatarmedium?: string }[] } }).response?.players ?? [] : [];
      await Promise.all(list.map(async pl => {
        const v = { name: pl.personaname ?? null, avatar: pl.avatarmedium ?? null };
        out[pl.steamid] = v;
        await env.SB.put(`avatar:${pl.steamid}`, JSON.stringify(v), { expirationTtl: 24 * 3600 });
      }));
    } catch { /* no avatars this time */ }
  }
  return out;
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
    for (let i = 0; i < 40; i++) { // a Worker may make 50 requests per call
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
    matches: [...u.matches].sort((a, b) => (b.time ?? b.foundAt) - (a.time ?? a.foundAt)).map(m => ({
      code: m.code, outcomeId: m.outcomeId, source: 'matchmaking', loadedAt: null, foundAt: m.foundAt,
      time: m.time ?? null, map: m.map ?? null, scores: m.scores ?? null, result: m.result ?? null, kd: m.kd ?? null,
      download: downloadLink(m.code), parsed: !!m.parsed, gone: !!m.gone, processing: !m.parsed && !m.gone && (m.tries ?? 0) < MAX_TRIES,
    })),
  };
}

// ---- the Stratboard server (bot + demo parser) ------------------------------------------------------

/** Constant-time compare, so the server token can't be guessed byte by byte. */
function sameToken(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function internal(req: Request, env: Env, path: string, json: (b: unknown, s?: number) => Response): Promise<Response> {
  const got = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!env.SERVER_TOKEN || !sameToken(got, env.SERVER_TOKEN)) return json({ error: 'Not allowed.' }, 403);

  // the moments the owner has ruled on, for the coach's tools on the owner's computer (tools/pull-disputes.ts)
  if (req.method === 'GET' && path === '/internal/disputes') return json(await ruledClips(env.SB));
  const ic = path.match(/^\/internal\/clip\/([0-9a-f]{24})$/);
  if (req.method === 'GET' && ic) {
    const gz = await clipData(env.SB, ic[1]);
    return gz ? new Response(gz, { encodeBody: 'manual', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } }) : json({ error: 'That moment is gone.' }, 404);
  }

  // users who have set up their codes
  if (req.method === 'GET' && path === '/internal/users') {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.SB.list({ prefix: 'user:', cursor });
      ids.push(...page.keys.map(k => k.name.slice(5)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return json({ users: ids });
  }
  // ask Valve for this user's new matches (one call per user keeps us under the request limit)
  const syncFor = path.match(/^\/internal\/sync\/(7656\d{13})$/);
  if (req.method === 'POST' && syncFor) return json(await sync(env, syncFor[1]));

  // matches still to process for one user (newest first)
  const pendingFor = path.match(/^\/internal\/pending\/(7656\d{13})$/);
  if (req.method === 'GET' && pendingFor) {
    const u = await loadUser(env, pendingFor[1]);
    const todo = u.matches.filter(m => !m.parsed && !m.gone && (m.tries ?? 0) < MAX_TRIES).sort((a, b) => b.foundAt - a.foundAt)
      .map(m => ({ code: m.code, outcomeId: m.outcomeId, matchId: m.matchId }));
    return json({ pending: todo });
  }
  // a processed demo (gzipped JSON); stored once per match, shared by every player in it
  const demoPut = path.match(/^\/internal\/demo\/(\d{5,25})$/);
  if (req.method === 'PUT' && demoPut) {
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > MAX_DEMO_BYTES) return json({ error: 'Too big.' }, 413);
    await env.SB.put(`demo:${demoPut[1]}`, bytes);
    return json({ ok: true, bytes: bytes.byteLength });
  }
  // the bot's report after each round (for the dev page)
  if (req.method === 'POST' && path === '/internal/heartbeat') return json(await saveHeartbeat(env.SB, await body(req)));
  // a match the server graded, for this user's profile
  const profileFor = path.match(/^\/internal\/profile\/(7656\d{13})$/);
  if (req.method === 'POST' && profileFor) {
    const ok = await addMatchFromServer(env.SB, profileFor[1], (await body(req)).match);
    return ok ? json({ ok: true }) : json({ error: 'That isn\'t a match summary.' }, 400);
  }
  // what came of one match for one user
  const resultFor = path.match(/^\/internal\/result\/(7656\d{13})$/);
  if (req.method === 'POST' && resultFor) {
    const r = await body(req) as { outcomeId?: string; parsed?: boolean; gone?: boolean; error?: string; info?: Partial<Match> };
    const u = await loadUser(env, resultFor[1]);
    const m = u.matches.find(x => x.outcomeId === r.outcomeId);
    if (!m) return json({ error: 'Unknown match.' }, 404);
    if (r.parsed) Object.assign(m, pick(r.info ?? {}), { parsed: true, error: null });
    else if (r.gone) Object.assign(m, { gone: true, error: r.error ?? 'Valve no longer has this demo.' });
    else Object.assign(m, { tries: (m.tries ?? 0) + 1, error: String(r.error ?? 'failed').slice(0, 300) });
    await saveUser(env, resultFor[1], u);
    return json({ ok: true });
  }
  return json({ error: 'Not found.' }, 404);
}

/** Only the fields the server may set. */
function pick(i: Partial<Match>): Partial<Match> {
  const out: Partial<Match> = {};
  if (typeof i.time === 'number') out.time = i.time;
  if (typeof i.map === 'string') out.map = i.map.slice(0, 40);
  if (Array.isArray(i.scores) && i.scores.length === 2) out.scores = [Number(i.scores[0]), Number(i.scores[1])];
  if (i.result === 'win' || i.result === 'loss' || i.result === 'tie') out.result = i.result;
  if (Array.isArray(i.kd) && i.kd.length === 2) out.kd = [Number(i.kd[0]), Number(i.kd[1])];
  return out;
}

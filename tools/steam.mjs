// Your CS2 matchmaking games straight from Steam, for the review screen. Runs in the Vite dev server.
//
// One sign-in (QR code in the Steam mobile app, or login + Steam Guard) gives a web session. With it we
// read your "Personal Game Data" page on steamcommunity.com (Premier / Competitive / Wingman match
// history), which lists each recent match with its "Download GOTV Replay" link. Then: download the
// .dem.bz2 from Valve, unpack it, parse it with tools/demo.mjs.
//
// It signs in as the Steam *mobile app* (EAuthTokenPlatformType.MobileApp): that token can be refreshed
// as often as needed and renewed for months (a WebBrowser token only works once for web cookies), and
// it never logs into the Steam client, so it can't kick you out of a game. The saved login token and the match cache live in
// cs2-tactics/.steam-cache/, which is git-ignored. Nothing secret is ever sent to the page.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseDemo } from './demo.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.steam-cache');
const STORE = path.join(CACHE, 'matches.json');
const TOKEN = path.join(CACHE, 'login-token');
const ACCOUNT = path.join(CACHE, 'account.json');
const STEAMID64_BASE = 76561197960265728n;
/** Match history tabs on the Personal Game Data page (unknown tabs just come back empty). */
const TABS = [
  ['matchhistorypremier', 'Premier'],
  ['matchhistorycompetitivepermap', 'Competitive'],
  ['matchhistorycompetitive', 'Competitive'],
  ['matchhistorywingman', 'Wingman'],
];
const MAX_PAGES = 4; // per tab; demos older than about a month have no link anyway

const read = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const write = (f, v) => { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 1), { mode: 0o600 }); };

// ---- sign-in -------------------------------------------------------------------------------------

const login = { state: 'idle', qr: null, guard: null, error: null, session: null };
let cookies = null; // "name=value" strings for steamcommunity.com

function newSession() {
  const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
  try { login.session?.cancelLoginAttempt(); } catch { /* nothing to cancel */ }
  const session = new LoginSession(EAuthTokenPlatformType.MobileApp);
  session.loginTimeout = 3 * 60 * 1000;
  session.on('authenticated', async () => {
    try {
      write(TOKEN, session.refreshToken);
      write(ACCOUNT, { steamId: session.steamID.getSteamID64(), name: session.accountName ?? null });
      cookies = null;
      web = null;
      await webCookies();
      Object.assign(login, { state: 'idle', qr: null, guard: null, error: null, session: null });
      sync().catch(() => {}); // fill the list right away
    } catch (e) { Object.assign(login, { state: 'error', error: msg(e) }); }
  });
  session.on('remoteInteraction', () => { if (login.state === 'qr') login.state = 'scanned'; });
  session.on('timeout', () => Object.assign(login, { state: 'error', error: 'The sign-in timed out. Try again.', qr: null, guard: null }));
  session.on('error', e => Object.assign(login, { state: 'error', error: msg(e), qr: null, guard: null }));
  login.session = session;
  return session;
}

/** QR sign-in: scan with the Steam mobile app (Steam Guard tab → scan icon) and approve. */
export async function startQr() {
  const QRCode = require('qrcode');
  const session = newSession();
  const res = await session.startWithQR();
  const qr = await QRCode.toDataURL(res.qrChallengeUrl, { margin: 1, width: 240 });
  Object.assign(login, { state: 'qr', qr, guard: null, error: null });
}

/** Login + password; Steam then wants a code (email / app) or an approval in the app. */
export async function startPassword(accountName, password) {
  const { EAuthSessionGuardType: G } = require('steam-session');
  const session = newSession();
  const res = await session.startWithCredentials({ accountName, password });
  if (!res.actionRequired) return; // 'authenticated' follows
  const types = res.validActions.map(a => a.type);
  const guard = {
    code: types.includes(G.DeviceCode) ? 'Steam mobile app' : types.includes(G.EmailCode) ? `email (${res.validActions.find(a => a.type === G.EmailCode)?.detail ?? 'your inbox'})` : null,
    approve: types.includes(G.DeviceConfirmation) || types.includes(G.EmailConfirmation),
  };
  Object.assign(login, { state: 'guard', guard, qr: null, error: null });
}

export async function submitGuard(code) {
  if (login.state !== 'guard' || !login.session) throw new Error('Steam is not waiting for a code.');
  await login.session.submitSteamGuardCode(String(code).trim());
}

export function cancelLogin() {
  try { login.session?.cancelLoginAttempt(); } catch { /* none */ }
  Object.assign(login, { state: 'idle', qr: null, guard: null, error: null, session: null });
}

export function signOut() {
  cancelLogin();
  forget();
  fs.rmSync(STORE, { force: true });
}

/** steamcommunity.com cookies from the saved login token (access token refreshed by Steam as needed). */
let web = null; // LoginSession holding the refresh token
async function webCookies() {
  if (!web) {
    let token = null;
    try { token = fs.readFileSync(TOKEN, 'utf8').trim(); } catch { /* not signed in */ }
    if (!token) throw new Error('Not signed in to Steam.');
    const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
    web = new LoginSession(EAuthTokenPlatformType.MobileApp);
    try {
      web.refreshToken = token; // throws on a malformed token
      // renew when Steam offers a new refresh token, so the sign-in never runs out
      if (await web.renewRefreshToken()) write(TOKEN, web.refreshToken);
    } catch (e) { forget(); throw expired(e); }
  }
  try {
    const raw = await web.getWebCookies(); // steamLoginSecure (steamid||access token) + sessionid
    cookies = raw.map(c => c.split(';')[0]);
    return cookies;
  } catch (e) { forget(); throw expired(e); }
}
const expired = e => new Error(`Steam sign-in expired, please sign in again (${msg(e)}).`);
function forget() {
  web = null;
  cookies = null;
  fs.rmSync(TOKEN, { force: true });
  fs.rmSync(ACCOUNT, { force: true });
}

// ---- match history ------------------------------------------------------------------------------

let syncing = null;
export function sync() {
  syncing ??= doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  const account = read(ACCOUNT, null);
  if (!account) throw new Error('Not signed in to Steam.');
  const jar = await webCookies();
  const sessionid = jar.find(c => c.startsWith('sessionid='))?.slice(10) ?? '';
  const store = read(STORE, { matches: [] });
  const byId = new Map(store.matches.map(m => [m.id, m]));
  let found = 0;
  const diag = []; // what Steam answered per tab, shown when nothing is found
  fs.mkdirSync(path.join(CACHE, 'debug'), { recursive: true });
  for (const [tab, mode] of TABS) {
    const base = `https://steamcommunity.com/profiles/${account.steamId}/gcpd/730`;
    let res = await fetch(`${base}?tab=${tab}`, { headers: { Cookie: jar.join('; ') }, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get('location') ?? '';
      diag.push(`${tab}: redirected to ${to.replace(/\?.*/, '')}`);
      if (/login/i.test(to)) throw new Error('Steam did not accept the sign-in for your match history (redirected to login). Sign out and sign in again.');
      continue; // unknown tab
    }
    if (!res.ok) { diag.push(`${tab}: HTTP ${res.status}`); continue; }
    let html = await res.text();
    // keep the raw page locally so the reader can be fixed if Steam changes its layout
    fs.writeFileSync(path.join(CACHE, 'debug', `${tab}.html`), html, { mode: 0o600 });
    if (/g_steamID = false/.test(html)) throw new Error('Steam shows your match history page as signed out. Sign out and sign in again.');
    diag.push(`${tab}: ${(html.match(/csgo_scoreboard_inner_left/g) ?? []).length} matches on the page`);
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = parseMatches(html, mode, account.steamId);
      for (const m of rows) {
        const old = byId.get(m.id);
        byId.set(m.id, { ...old, ...m, demo: old?.demo ?? null, error: null });
      }
      found += rows.length;
      const token = html.match(/g_sGcContinueToken\s*=\s*'(\d+)'/)?.[1] ?? html.match(/"continue_token"\s*:\s*"?(\d+)/)?.[1];
      if (!token || !rows.some(r => r.url)) break;
      res = await fetch(`${base}?ajax=1&tab=${tab}&continue_token=${token}&sessionid=${sessionid}`, { headers: { Cookie: jar.join('; ') } });
      if (!res.ok) break;
      const body = await res.json().catch(() => null);
      if (!body?.success || !body.html) break;
      html = body.html + (body.continue_token ? `<script>g_sGcContinueToken = '${body.continue_token}';</script>` : '');
    }
  }
  store.matches = [...byId.values()].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  write(STORE, store);
  return { found, diag, matches: store.matches.map(publicMatch) };
}

/**
 * Matches out of a Personal Game Data page. Each match is a scoreboard table: on the left the mode
 * and map ("Premier Ancient"), the date ("2025-04-20 18:22:11 GMT"), and the replay link; on the
 * right the two teams' players around a "13 : 16" score row.
 */
export function parseMatches(html, mode, steamId) {
  const out = [];
  const myAcc = String(BigInt(steamId) - STEAMID64_BASE);
  const blocks = html.split(/class="csgo_scoreboard_inner_left"/).slice(1);
  for (const block of blocks) {
    const cells = [...block.split(/csgo_scoreboard_inner_right/)[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => strip(c[1]));
    const title = cells[0] ?? '';
    const dateCell = cells.find(c => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(c));
    const time = dateCell ? Date.parse(dateCell.replace(' ', 'T').replace(/\s*GMT$/, 'Z')) : null;
    const duration = cells.find(c => /Match Duration/i.test(c))?.replace(/.*?:\s*/, '') ?? null;
    const url = block.match(/https?:\/\/replay\d+\.valve\.net\/730\/[\w.]+?\.dem\.bz2/)?.[0] ?? null;
    const right = block.split(/csgo_scoreboard_inner_right/)[1] ?? '';
    const scoreMatch = right.match(/csgo_scoreboard_score[^>]*>\s*(\d+)\s*:\s*(\d+)/);
    let scores = scoreMatch ? [+scoreMatch[1], +scoreMatch[2]] : [];
    // which team is mine: my row is above (team 1) or below (team 2) the score row
    let result = null;
    if (scoreMatch) {
      const at = right.search(new RegExp(`data-miniprofile="${myAcc}"|/profiles/${steamId}\\b`));
      if (at >= 0) {
        const mine = at < right.indexOf(scoreMatch[0]) ? 0 : 1;
        scores = [scores[mine], scores[1 - mine]];
        result = scores[0] > scores[1] ? 'win' : scores[0] < scores[1] ? 'loss' : 'tie';
      }
    }
    const mapName = title.replace(/^(Premier|Competitive|Wingman|Scrimmage)\s+/i, '').trim();
    const id = url ? path.basename(url).replace(/\.dem\.bz2$/, '') : `${time ?? 'x'}-${mapName}`;
    out.push({ id, mode, map: mapId(mapName), mapName: mapName || null, time, duration, url, scores, result });
  }
  return out;
}

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** "Dust II" → de_dust2, "Ancient" → de_ancient. */
const mapId = name => (name ? `de_${name.toLowerCase().replace(/\bii\b/, '2').replace(/[^a-z0-9]/g, '')}` : null);
const publicMatch = m => ({
  id: m.id, mode: m.mode, map: m.map, mapName: m.mapName, time: m.time, duration: m.duration,
  scores: m.scores, result: m.result, hasDemo: !!m.url, demo: m.demo ?? null, error: m.error ?? null,
});

// ---- download + parse -------------------------------------------------------------------------------

const loading = new Map();
/** The parsed match (cached after the first time), ready for the review screen. */
export function loadMatch(id) {
  if (!loading.has(id)) loading.set(id, doLoad(id).finally(() => loading.delete(id)));
  return loading.get(id);
}

async function doLoad(id) {
  if (!/^[\w.-]+$/.test(id)) throw new Error('Bad match id.');
  const store = read(STORE, { matches: [] });
  const m = store.matches.find(x => x.id === id);
  if (!m) throw new Error('Unknown match; check for new matches first.');
  const parsed = path.join(CACHE, 'parsed', `${id}.json`);
  if (fs.existsSync(parsed)) return JSON.parse(fs.readFileSync(parsed, 'utf8'));
  if (!m.url) throw new Error('Valve no longer has the demo for this match (they keep them about a month).');
  const dem = path.join(CACHE, 'demos', `${id}.dem`);
  if (!fs.existsSync(dem)) {
    const res = await fetch(m.url);
    if (res.status === 404) { m.demo = 'expired'; write(STORE, store); throw new Error('The demo has expired on Valve\'s servers.'); }
    if (!res.ok || !res.body) throw new Error(`Demo download failed (${res.status}).`);
    fs.mkdirSync(path.dirname(dem), { recursive: true });
    const tmp = `${dem}.part`;
    await pipeline(Readable.fromWeb(res.body), require('unbzip2-stream')(), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dem);
  }
  const data = parseDemo(dem);
  fs.mkdirSync(path.dirname(parsed), { recursive: true });
  fs.writeFileSync(parsed, JSON.stringify(data));
  fs.rmSync(dem, { force: true }); // the parsed copy is all the app needs (demos are ~100–250 MB)
  m.demo = 'ready';
  m.error = null;
  write(STORE, store);
  return data;
}

// ---- status for the UI (never includes tokens or cookies) ------------------------------------------

export function status() {
  const account = fs.existsSync(TOKEN) ? read(ACCOUNT, null) : null;
  return {
    account,
    login: { state: login.state, qr: login.qr, guard: login.guard, error: login.error },
    syncing: !!syncing,
    matches: account ? read(STORE, { matches: [] }).matches.map(publicMatch) : [],
  };
}

const msg = e => (e instanceof Error ? e.message : String(e));

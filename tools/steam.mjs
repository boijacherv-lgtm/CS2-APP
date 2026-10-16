// Your CS2 matches, without any Steam sign-in. Runs in the Vite dev server.
//
//   Who you are  "Log in with Steam" (Steam OpenID, below) or a pasted profile link → your SteamID.
//   Match list   Valve's own match-history Web API (GetNextMatchSharingCode) with your Web API key + game
//                authentication code + one share code, entered once. New matches appear by themselves.
//   Demo         "Download in CS2" opens Valve's own steam:// link, so CS2 itself downloads the demo into
//                its replays folder. The app watches that folder and imports new demos by itself; you
//                can still drop a .dem in by hand. Demos are matched to the list by outcome id (it's in
//                the file name: match730_<outcome id>_…).
//
// IMPORTANT: never add Steam login automation here (steam-session / steam-user / the app logging in with a
// QR code or password). Steam flagged exactly that as malicious on the owner's account. Public and official
// APIs only. "Sign in through Steam" (OpenID) is fine: the user logs in on Steam's own page in their browser
// and the app only receives a signed SteamID.
//
// Settings and cache live in cs2-tactics/.steam-cache/ (git-ignored). Secrets never go back to the page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDemo } from './demo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.steam-cache');
const SETTINGS = path.join(CACHE, 'settings.json');
/** Each Steam account has its own match list (log out and back in: it's all still there). */
const storeFile = steamId => path.join(CACHE, steamId ? `matches-${steamId}.json` : 'matches.json');
const PARSED = path.join(CACHE, 'parsed');
const STEAM_API = 'https://api.steampowered.com';

const read = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };
const msg = e => (e instanceof Error ? e.message : String(e));

// ---- share codes ------------------------------------------------------------------------------------

const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
export const SHARE_CODE = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

/** CSGO-xxxxx-… → match id, outcome id (the number in the demo's file name) and token. */
export function decodeShareCode(code) {
  if (!SHARE_CODE.test(code)) throw new Error('Not a share code.');
  const chars = code.slice(5).replace(/-/g, '').split('').reverse();
  let n = 0n;
  for (const c of chars) {
    const i = DICT.indexOf(c);
    if (i < 0) throw new Error('Not a share code.');
    n = n * 57n + BigInt(i);
  }
  const bytes = Buffer.alloc(18);
  for (let i = 17; i >= 0; i--) { bytes[i] = Number(n & 0xffn); n >>= 8n; }
  return {
    matchId: bytes.readBigUInt64LE(0).toString(),
    outcomeId: bytes.readBigUInt64LE(8).toString(),
    token: bytes.readUInt16LE(16),
  };
}

/** Valve's own link: opens CS2 and downloads that match's demo into game/csgo/replays. */
export const downloadLink = code => `steam://rungame/730/76561202255233023/+csgo_download_match%20${code}`;

/** "match730_003847732607018074171_0422097200_274.dem" → "3847732607018074171". */
export const outcomeFromFileName = name => name.match(/match730_0*(\d+)_/)?.[1] ?? null;

// ---- settings ---------------------------------------------------------------------------------------------

// Settings: shared bits (Web API key, replays folder, who is logged in) + per Steam account codes. The
// authentication code and match code belong to one account; the API key works for everyone's history.
const PER_ACCOUNT = ['authCode', 'knownCode'];
function settings() {
  const raw = read(SETTINGS, {});
  // older layout: codes at the top level and a single matches.json → move them under the account
  if (raw.steamId && PER_ACCOUNT.some(k => raw[k])) {
    raw.accounts = { ...raw.accounts, [raw.steamId]: { ...raw.accounts?.[raw.steamId], ...Object.fromEntries(PER_ACCOUNT.filter(k => raw[k]).map(k => [k, raw[k]])) } };
    for (const k of PER_ACCOUNT) delete raw[k];
    write(SETTINGS, raw);
  }
  if (raw.steamId && fs.existsSync(storeFile(null)) && !fs.existsSync(storeFile(raw.steamId))) fs.renameSync(storeFile(null), storeFile(raw.steamId));
  return { ...raw, ...(raw.steamId ? raw.accounts?.[raw.steamId] : {}) };
}
/** Writes the merged view back: per-account fields go under accounts[steamId]. */
function writeSettings(s) {
  const raw = read(SETTINGS, {});
  const out = { steamId: s.steamId, apiKey: s.apiKey, replaysDir: s.replaysDir, accounts: { ...raw.accounts } };
  if (s.steamId) out.accounts[s.steamId] = Object.fromEntries(PER_ACCOUNT.filter(k => s[k]).map(k => [k, s[k]]));
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  write(SETTINGS, out);
}

function configured(s = settings()) {
  return {
    steamId: /^7656\d{13}$/.test(s.steamId ?? ''),
    apiKey: /^[0-9A-F]{32}$/i.test(s.apiKey ?? ''),
    authCode: /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/i.test(s.authCode ?? ''),
    knownCode: SHARE_CODE.test(s.knownCode ?? ''),
    replays: !!s.replaysDir,
  };
}
const valveReady = c => c.steamId && c.apiKey && c.authCode && c.knownCode;

/** Your profile link (or SteamID64) → SteamID64. Custom /id/ links use Steam's public profile XML. */
export async function resolveProfile(input) {
  const direct = input.match(/(7656\d{13})/)?.[1];
  if (direct) return direct;
  const vanity = input.match(/steamcommunity\.com\/id\/([^/?#\s]+)/)?.[1] ?? (/^[\w-]{2,32}$/.test(input) ? input : null);
  if (!vanity) throw new Error('Paste your Steam profile link (steamcommunity.com/id/… or /profiles/…).');
  const res = await fetch(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`);
  const sid = (await res.text()).match(/<steamID64>(\d{17})<\/steamID64>/)?.[1];
  if (!sid) throw new Error('Steam could not find that profile link.');
  return sid;
}

/**
 * Smart paste: finds the authentication code, Web API key and any share codes in text copied from Steam's
 * pages (Steam Support → CS2 → authentication code, steamcommunity.com/dev/apikey, CS2 share links).
 */
export function extractFromText(text) {
  const t = String(text ?? '');
  const valid = c => { try { decodeShareCode(c); return true; } catch { return false; } };
  const codes = [...new Set([...t.matchAll(/CSGO(?:-[A-Za-z0-9]{5}){5}/g)].map(m => m[0]))].filter(valid);
  const authCode = [...t.matchAll(/(?<![A-Za-z0-9-])([A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4})(?![A-Za-z0-9-])/g)].map(m => m[1]).find(c => !c.startsWith('CSGO')) ?? null;
  const apiKey = t.match(/(?<![0-9A-Fa-f])([0-9A-F]{32})(?![0-9A-Fa-f])/)?.[1] ?? null;
  return { authCode, apiKey, codes };
}

/** Oldest first: CS2 match ids grow over time. */
const byAge = codes => [...codes].sort((a, b) => (BigInt(decodeShareCode(a).matchId) < BigInt(decodeShareCode(b).matchId) ? -1 : 1));

/** Saves the fields that were filled in (blank fields keep their saved value). */
export async function saveSettings(input) {
  const s = settings();
  const clean = v => (typeof v === 'string' ? v.trim() : '');
  const pasted = input.paste ? extractFromText(input.paste) : null;
  if (pasted && !pasted.authCode && !pasted.apiKey && !pasted.codes.length) throw new Error('Nothing useful found in that text: copy the whole Steam page (Ctrl/Cmd+A, then Ctrl/Cmd+C) and paste it again.');
  const profile = clean(input.profile ?? input.steamId);
  const key = clean(input.apiKey) || pasted?.apiKey || '', auth = clean(input.authCode) || pasted?.authCode || '';
  // several share codes: the oldest is where Valve starts walking; all of them go on the list right away
  const pastedCodes = pasted?.codes.length ? byAge(pasted.codes) : [];
  let code = clean(input.knownCode) || '';
  if (!code && pastedCodes.length) {
    const oldest = pastedCodes[0];
    code = !s.knownCode || BigInt(decodeShareCode(oldest).matchId) < BigInt(decodeShareCode(s.knownCode).matchId) ? oldest : s.knownCode;
  }
  if (pastedCodes.length) {
    const st = read(storeFile(s.steamId), { lastCode: null, matches: [] });
    const have = new Set(st.matches.map(m => m.code));
    const t0 = Date.now();
    pastedCodes.forEach((c, i) => { if (!have.has(c)) st.matches.push({ code: c, ...decodeShareCode(c), source: 'matchmaking', foundAt: t0 - (pastedCodes.length - i) }); });
    write(storeFile(s.steamId), st);
  }
  const dir = clean(input.replaysDir);
  if (profile) {
    const id = await resolveProfile(profile);
    if (id !== s.steamId) {
      // another account: its own codes (if it set them up before), never the previous account's
      const acc = read(SETTINGS, {}).accounts?.[id] ?? {};
      for (const k of PER_ACCOUNT) s[k] = acc[k];
    }
    s.steamId = id;
  }
  if (key) { if (!/^[0-9A-F]{32}$/i.test(key)) throw new Error('The Web API key is 32 letters and digits.'); s.apiKey = key; }
  if (auth) { if (!/^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/i.test(auth)) throw new Error('The authentication code looks like AAAA-AAAAA-AAAA.'); s.authCode = auth.toUpperCase(); }
  if (code) {
    if (!SHARE_CODE.test(code)) throw new Error('The share code looks like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.');
    if (code !== s.knownCode) { const st = read(storeFile(s.steamId), null); if (st) { st.lastCode = null; write(storeFile(s.steamId), st); } }
    s.knownCode = code;
  }
  if (dir) { if (!fs.existsSync(dir)) throw new Error('That folder does not exist.'); s.replaysDir = dir; }
  writeSettings(s);
  return pasted ? { ...configured(s), found: { authCode: !!pasted.authCode, apiKey: !!pasted.apiKey, codes: pasted.codes.length } } : configured(s);
}

/** Forgets everything saved: every account's codes and match list, the key (parsed demos stay). */
export function forget() {
  fs.rmSync(SETTINGS, { force: true });
  for (const f of fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []) if (/^matches(-\d+)?\.json$/.test(f)) fs.rmSync(path.join(CACHE, f), { force: true });
}

// ---- "Sign in through Steam" (Steam OpenID 2.0) ------------------------------------------------------------
//
// The same button Leetify / FACEIT / csstats use. The browser goes to Steam's own login page (where you can
// scan Steam's QR code with Steam Guard); Steam sends back a signed "this is SteamID 7656…". We verify that
// signature with Steam and keep only the SteamID. No password, token, cookie or session ever reaches the app.

const OPENID = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';

/** Where to send the browser: Steam's login page, coming back to <origin>/api/steam/openid/return. */
export function openIdStartUrl(origin, back = '#/cs2/review') {
  const q = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/api/steam/openid/return?back=${encodeURIComponent(safeBack(back))}`,
    'openid.realm': origin,
    'openid.identity': `${OPENID_NS}/identifier_select`,
    'openid.claimed_id': `${OPENID_NS}/identifier_select`,
  });
  return `${OPENID}?${q}`;
}

/** Only in-app pages (#/…) to go back to after signing in. */
export const safeBack = back => (/^#\/[\w/-]*$/.test(back ?? '') ? back : '#/cs2/review');

/** Log out: the app forgets who is here. Your codes and match list stay saved for when you log in again. */
export function signOut() {
  const raw = read(SETTINGS, {});
  delete raw.steamId;
  write(SETTINGS, raw);
  profileCache = null;
}

/** Your public Steam name and avatar (public profile page, no login). */
let profileCache = null;
async function publicProfile(steamId) {
  if (profileCache?.steamId === steamId && Date.now() - profileCache.at < 3600e3) return profileCache.value;
  try {
    const xml = await (await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`)).text();
    const tag = t => xml.match(new RegExp(`<${t}><!\\[CDATA\\[(.*?)\\]\\]></${t}>`))?.[1] ?? xml.match(new RegExp(`<${t}>(.*?)</${t}>`))?.[1] ?? null;
    const value = { name: tag('steamID'), avatar: tag('avatarMedium') };
    profileCache = { steamId, at: Date.now(), value };
    return value;
  } catch { return { name: null, avatar: null }; }
}
/** Public names + avatars of a match's players (up to 20 SteamIDs), from their public profile pages, kept a day. */
const avatarCache = new Map();
export async function profiles(raw) {
  const ids = [...new Set(String(raw ?? '').split(',').map(s => s.trim()).filter(s => /^7656\d{13}$/.test(s)))].slice(0, 20);
  const out = {};
  await Promise.all(ids.map(async id => {
    const c = avatarCache.get(id);
    if (c && Date.now() - c.at < 86400e3) { out[id] = c.value; return; }
    try {
      const xml = await (await fetch(`https://steamcommunity.com/profiles/${id}/?xml=1`)).text();
      const tag = t => xml.match(new RegExp(`<${t}><!\\[CDATA\\[(.*?)\\]\\]></${t}>`))?.[1] ?? xml.match(new RegExp(`<${t}>(.*?)</${t}>`))?.[1] ?? null;
      const value = { name: tag('steamID'), avatar: tag('avatarMedium') };
      avatarCache.set(id, { at: Date.now(), value });
      out[id] = value;
    } catch { /* skip */ }
  }));
  return out;
}

export async function me() {
  const id = settings().steamId;
  if (!id) return null;
  return { steamId: id, ...(await publicProfile(id)) };
}

const usedNonces = new Set();
/** Checks Steam's answer with Steam itself, then saves the SteamID as your profile. */
export async function openIdVerify(origin, query) {
  const p = Object.fromEntries([...new URLSearchParams(query)].filter(([k]) => k.startsWith('openid.')));
  if (p['openid.mode'] !== 'id_res') throw new Error('Steam sign-in was cancelled.');
  if (p['openid.op_endpoint'] !== OPENID) throw new Error('That answer did not come from Steam.');
  if (!(p['openid.return_to'] ?? '').startsWith(`${origin}/api/steam/openid/return`)) throw new Error('That answer was meant for another site.');
  const steamId = p['openid.claimed_id']?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(7656\d{13})$/)?.[1];
  if (!steamId || p['openid.identity'] !== p['openid.claimed_id']) throw new Error('Steam did not say which account signed in.');
  const nonce = p['openid.response_nonce'];
  if (!nonce || usedNonces.has(nonce)) throw new Error('This sign-in was already used; please sign in again.');
  // ask Steam whether it really signed this (otherwise anyone could forge the return URL)
  const res = await fetch(OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...p, 'openid.mode': 'check_authentication' }),
  });
  if (!/is_valid\s*:\s*true/.test(await res.text())) throw new Error('Steam did not confirm the sign-in.');
  usedNonces.add(nonce);
  await saveSettings({ profile: steamId });
  return steamId;
}

// ---- match list ----------------------------------------------------------------------------------------------

const store = () => read(storeFile(settings().steamId), { lastCode: null, matches: [], source: null, note: null });
/** Adds or updates matches by share code; keeps the newest first. */
function merge(st, items) {
  const byCode = new Map(st.matches.map(m => [m.code, m]));
  for (const it of items) byCode.set(it.code, { ...byCode.get(it.code), ...it });
  st.matches = [...byCode.values()].sort((a, b) => (b.time ?? b.foundAt ?? 0) - (a.time ?? a.foundAt ?? 0));
}

let syncing = null;
export function sync() {
  syncing ??= doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  const s = settings();
  const c = configured(s);
  if (!c.steamId) throw new Error('Log in with Steam first.');
  const st = store();
  const before = st.matches.length;
  st.note = null;
  if (valveReady(c)) {
    try { merge(st, await fromValve(s, st)); st.source = 'valve'; }
    catch (e) { st.note = msg(e); }
  } else st.note = 'Add your game authentication code, one share code and your Web API key (once) to list your matches.';
  write(storeFile(s.steamId), st);
  importDemos(); // pick up any demo that is already in the replays folder
  return { added: st.matches.length - before, note: st.note, source: st.source };
}

/** Share codes from Valve's match-history API (no details: map and score show once the demo is in). */
async function fromValve(s, st) {
  const out = [];
  const known = new Set(st.matches.map(m => m.code));
  // Valve walks forward in time, so each later code is a newer match: order them by when they were found
  const t0 = Date.now();
  const add = code => { if (!known.has(code)) { known.add(code); out.push({ code, ...decodeShareCode(code), source: 'matchmaking', foundAt: t0 + out.length }); } };
  add(s.knownCode);
  let code = st.lastCode ?? s.knownCode;
  for (let i = 0; i < 100; i++) {
    const url = `${STEAM_API}/ICSGOPlayers_730/GetNextMatchSharingCode/v1?key=${encodeURIComponent(s.apiKey)}`
      + `&steamid=${s.steamId}&steamidkey=${encodeURIComponent(s.authCode)}&knowncode=${encodeURIComponent(code)}`;
    const res = await fetch(url);
    if (res.status === 202) break; // no newer match yet
    if (res.status === 403) throw new Error('Steam refused the Web API key (403).');
    if (res.status === 412) throw new Error('Steam says the authentication code or share code doesn\'t belong to this account (412).');
    if (res.status === 429) break;
    if (!res.ok) throw new Error(`Steam's match-history API answered ${res.status}.`);
    const next = (await res.json().catch(() => null))?.result?.nextcode;
    if (!next || next === 'n/a') break;
    add(next);
    code = next;
  }
  st.lastCode = code;
  return out;
}

// ---- demos: CS2's replays folder, watched ----------------------------------------------------------------------

/** Where CS2 keeps downloaded demos, on every Steam library of this computer. */
export function findReplayDirs() {
  const home = os.homedir();
  const roots = process.platform === 'win32'
    ? ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam', 'D:/Steam', 'E:/Steam']
    : process.platform === 'darwin' ? [path.join(home, 'Library/Application Support/Steam')]
    : [path.join(home, '.steam/steam'), path.join(home, '.local/share/Steam')];
  const libs = new Set();
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    libs.add(r);
    // other drives: steamapps/libraryfolders.vdf lists every library ("path" "E:\\SteamLibrary")
    try {
      const vdf = fs.readFileSync(path.join(r, 'steamapps/libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch { /* no library file */ }
  }
  return [...libs].map(l => path.join(l, 'steamapps/common/Counter-Strike Global Offensive/game/csgo/replays')).filter(d => fs.existsSync(d));
}

const importing = { file: null, done: 0, error: null, last: null };
const seen = new Map(); // file → size at the previous scan (a demo still downloading keeps growing)
let scanner = null;

function replayDirs() {
  const s = settings();
  return [...new Set([...(s.replaysDir ? [s.replaysDir] : []), ...findReplayDirs()])];
}

/** Imports finished Valve demos from the replays folder: ones on the match list, or from the last day. */
function importDemos() {
  if (importing.file) return; // one at a time (parsing takes a few seconds)
  const wanted = new Set(store().matches.map(m => m.outcomeId).filter(Boolean));
  for (const dir of replayDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^match730_\d+_.*\.dem$/.test(f)); } catch { continue; }
    for (const f of files) {
      const id = outcomeFromFileName(f);
      if (!id || fs.existsSync(path.join(PARSED, `${id}.json`)) || importing.last === `${f}:failed`) continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (!wanted.has(id) && Date.now() - stat.mtimeMs > 24 * 3600e3) continue;
      // finished = same size as at the previous scan and untouched for a few seconds
      const prev = seen.get(full);
      seen.set(full, stat.size);
      if (prev !== stat.size || Date.now() - stat.mtimeMs < 4000) continue;
      importing.file = f;
      setTimeout(() => {
        try { rememberParsed(f, parseDemo(full)); importing.done++; importing.error = null; importing.last = f; }
        catch (e) { importing.error = `${f}: ${msg(e)}`; importing.last = `${f}:failed`; }
        finally { importing.file = null; }
      }, 0);
      return;
    }
  }
}

function startScanner() {
  if (scanner) return;
  scanner = setInterval(importDemos, 5000);
  scanner.unref?.();
}

// ---- parsed demos ---------------------------------------------------------------------------------------------------

/** Keeps a parsed demo when its file name says which match it is (also called by /api/demo for dropped files). */
export function rememberParsed(fileName, data) {
  const id = outcomeFromFileName(fileName ?? '');
  if (!id) return;
  fs.mkdirSync(PARSED, { recursive: true });
  fs.writeFileSync(path.join(PARSED, `${id}.json`), JSON.stringify(data));
}

export function loadParsed(outcomeId) {
  if (!/^\d+$/.test(outcomeId)) throw new Error('Bad match id.');
  const f = path.join(PARSED, `${outcomeId}.json`);
  if (!fs.existsSync(f)) throw new Error('This match hasn\'t been loaded yet: click Download in CS2 (it imports by itself), or drop the .dem here.');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Map and score (from your side) of a parsed match, for matches the list knows nothing about yet. */
function summary(outcomeId, steamId) {
  const f = path.join(PARSED, `${outcomeId}.json`);
  if (!fs.existsSync(f)) return null;
  const mtime = fs.statSync(f).mtimeMs;
  const cached = summaries.get(outcomeId);
  if (cached?.mtime === mtime && cached.steamId === steamId) return cached.value;
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const played = d.rounds.filter(r => r.winner && r.frames.players[steamId]);
    const won = played.filter(r => r.frames.players[steamId].side === r.winner).length, lost = played.length - won;
    const kills = d.rounds.reduce((a, r) => a + r.kills.filter(k => k.attacker === steamId && k.victim !== steamId).length, 0);
    const deaths = d.rounds.reduce((a, r) => a + r.kills.filter(k => k.victim === steamId).length, 0);
    const value = {
      map: d.map, scores: played.length ? [won, lost] : null, result: !played.length ? null : won > lost ? 'win' : won < lost ? 'loss' : 'tie',
      kd: played.length ? [kills, deaths] : null, rounds: d.rounds.length,
    };
    summaries.set(outcomeId, { mtime, steamId, value });
    return value;
  } catch { return null; }
}
const summaries = new Map();

/** Demos you've loaded that the match list doesn't know about (older games, a friend's demo, …): always listed. */
function loadedOnly(st, steamId) {
  const listed = new Set(st.matches.map(m => m.outcomeId).filter(Boolean));
  let files = [];
  try { files = fs.readdirSync(PARSED).filter(f => /^\d+\.json$/.test(f)); } catch { return []; }
  return files.map(f => f.slice(0, -5)).filter(id => !listed.has(id)).map(id => {
    const sum = summary(id, steamId);
    return {
      code: `loaded:${id}`, outcomeId: id, source: 'loaded', time: null, foundAt: null, loadedAt: fs.statSync(path.join(PARSED, `${id}.json`)).mtimeMs,
      map: sum?.map ?? null, scores: sum?.scores ?? null, result: sum?.result ?? null, kd: sum?.kd ?? null, download: null, parsed: true,
    };
  });
}

// ---- status for the UI (never includes the key or the auth code) ------------------------------------------------------

export function status() {
  startScanner();
  const s = settings();
  const st = store();
  return {
    configured: configured(s),
    steamId: s.steamId ?? null,
    source: st.source ?? null,
    note: st.note ?? null,
    syncing: !!syncing,
    replays: replayDirs(),
    importing: { file: importing.file, error: importing.error },
    matches: [...st.matches.map(m => {
      const parsed = m.outcomeId ? fs.existsSync(path.join(PARSED, `${m.outcomeId}.json`)) : false;
      const sum = parsed && (!m.map || !m.scores) ? summary(m.outcomeId, s.steamId) : null;
      return {
        code: m.code, outcomeId: m.outcomeId ?? null, source: m.source ?? 'matchmaking', time: m.time ?? null, loadedAt: null, foundAt: m.foundAt ?? null,
        map: m.map ?? sum?.map ?? null, scores: m.scores ?? sum?.scores ?? null, result: m.result ?? sum?.result ?? null, kd: m.kd ?? sum?.kd ?? null,
        download: m.outcomeId ? downloadLink(m.code) : null, parsed,
      };
    }), ...loadedOnly(st, s.steamId)].sort((a, b) => (b.time ?? b.foundAt ?? b.loadedAt ?? 0) - (a.time ?? a.foundAt ?? a.loadedAt ?? 0)),
  };
}

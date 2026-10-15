// Your CS2 matches, without any Steam sign-in. Runs in the Vite dev server.
//
//   Match list   Paste your Steam profile link. The app reads your recent matches (map, date, score,
//                share code) from Leetify's public API: no key, no login. Needs a Leetify account with
//                match tracking (Leetify does the Valve side). Fallback: Valve's own match-history Web
//                API (GetNextMatchSharingCode) with your Web API key + game authentication code.
//   Demo         "Download in CS2" opens Valve's own steam:// link, so CS2 itself downloads the demo into
//                its replays folder. The app watches that folder and imports new demos by itself; you
//                can still drop a .dem in by hand. Demos are matched to the list by outcome id (it's in
//                the file name: match730_<outcome id>_…).
//
// IMPORTANT: never add Steam login automation here (steam-session / steam-user / QR or password logins).
// Steam flagged exactly that as malicious on the owner's account. Public and official APIs only.
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
const STORE = path.join(CACHE, 'matches.json');
const PARSED = path.join(CACHE, 'parsed');
const STEAM_API = 'https://api.steampowered.com';
const LEETIFY_API = 'https://api-public.cs-prod.leetify.com';

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

function settings() { return read(SETTINGS, {}); }

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

/** Saves the fields that were filled in (blank fields keep their saved value). */
export async function saveSettings(input) {
  const s = settings();
  const clean = v => (typeof v === 'string' ? v.trim() : '');
  const profile = clean(input.profile ?? input.steamId), key = clean(input.apiKey), auth = clean(input.authCode), code = clean(input.knownCode);
  const dir = clean(input.replaysDir);
  if (profile) {
    const id = await resolveProfile(profile);
    if (id !== s.steamId) { fs.rmSync(STORE, { force: true }); leetifyCache = null; } // someone else's list
    s.steamId = id;
  }
  if (key) { if (!/^[0-9A-F]{32}$/i.test(key)) throw new Error('The Web API key is 32 letters and digits.'); s.apiKey = key; }
  if (auth) { if (!/^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/i.test(auth)) throw new Error('The authentication code looks like AAAA-AAAAA-AAAA.'); s.authCode = auth.toUpperCase(); }
  if (code) {
    if (!SHARE_CODE.test(code)) throw new Error('The share code looks like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.');
    if (code !== s.knownCode) { const st = read(STORE, null); if (st) { st.lastCode = null; write(STORE, st); } }
    s.knownCode = code;
  }
  if (dir) { if (!fs.existsSync(dir)) throw new Error('That folder does not exist.'); s.replaysDir = dir; }
  write(SETTINGS, s);
  return configured(s);
}

/** Forgets the settings and the match list (parsed demos stay). */
export function forget() {
  fs.rmSync(SETTINGS, { force: true });
  fs.rmSync(STORE, { force: true });
  leetifyCache = null;
}

// ---- match list ----------------------------------------------------------------------------------------------

const store = () => read(STORE, { lastCode: null, matches: [], source: null, note: null });
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

let leetifyCache = null; // { at, steamId, result } — Leetify is asked at most once a minute
async function doSync() {
  const s = settings();
  const c = configured(s);
  if (!c.steamId) throw new Error('Paste your Steam profile link first.');
  const st = store();
  const before = st.matches.length;
  const notes = [];

  // 1. Leetify (no key, no login)
  let lt = leetifyCache?.steamId === s.steamId && Date.now() - leetifyCache.at < 60000 ? leetifyCache.result : null;
  if (!lt) {
    lt = await fromLeetify(s.steamId).catch(e => ({ error: msg(e) }));
    leetifyCache = { at: Date.now(), steamId: s.steamId, result: lt };
  }
  if (lt.matches) {
    // Leetify's list is the truth for what it covers; keep only what it can't see (Valve-only share
    // codes without details, and matches whose demo is already imported)
    const fresh = new Set(lt.matches.map(m => m.code));
    st.matches = st.matches.filter(m => fresh.has(m.code)
      || (SHARE_CODE.test(m.code) && (!m.time || (m.outcomeId && fs.existsSync(path.join(PARSED, `${m.outcomeId}.json`))))));
    merge(st, lt.matches);
    st.source = 'leetify';
  }
  else notes.push(lt.error);

  // 2. Valve's own API, if set up
  if (valveReady(c)) {
    try { merge(st, await fromValve(s, st)); if (!lt.matches) st.source = 'valve'; }
    catch (e) { notes.push(msg(e)); }
  }
  st.note = notes.filter(Boolean).join(' ') || null;
  write(STORE, st);
  importDemos(); // pick up any demo that is already in the replays folder
  return { added: st.matches.length - before, note: st.note, source: st.source };
}

/** Recent matches from Leetify's public API (last ~100). */
async function fromLeetify(steamId) {
  const res = await fetch(`${LEETIFY_API}/v3/profile/matches?steam64_id=${steamId}`);
  if (res.status === 404) throw new Error('Your account isn\'t on Leetify yet: sign up at leetify.com (Sign in through Steam) and turn on match tracking, or use the Valve setup under Advanced.');
  if (res.status === 429) throw new Error('Leetify asked us to slow down; the list updates again in a minute.');
  if (!res.ok) throw new Error(`Leetify answered ${res.status}.`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('Leetify sent an unexpected answer.');
  return {
    matches: list.map(m => {
      const me = m.stats?.find(p => p.steam64_id === steamId);
      const score = side => m.team_scores?.find(t => t.team_number === side)?.score;
      const mine = me ? score(me.initial_team_number) : null, theirs = me ? score(me.initial_team_number === 2 ? 3 : 2) : null;
      const code = String(m.data_source).startsWith('matchmaking') && SHARE_CODE.test(m.data_source_match_id ?? '') ? m.data_source_match_id : null;
      return {
        code: code ?? `${m.data_source}:${m.data_source_match_id ?? m.id}`,
        ...(code ? decodeShareCode(code) : {}),
        source: m.data_source, // matchmaking, faceit, …
        time: m.finished_at ? Date.parse(m.finished_at) : null,
        map: m.map_name ?? null,
        scores: mine != null && theirs != null ? [mine, theirs] : null,
        result: mine == null || theirs == null ? null : mine > theirs ? 'win' : mine < theirs ? 'loss' : 'tie',
        kd: me ? [me.total_kills, me.total_deaths] : null,
      };
    }),
  };
}

/** Share codes from Valve's match-history API (no details: map and score show once the demo is in). */
async function fromValve(s, st) {
  const out = [];
  const known = new Set(st.matches.map(m => m.code));
  const add = code => { if (!known.has(code)) { known.add(code); out.push({ code, ...decodeShareCode(code), source: 'matchmaking', foundAt: Date.now() }); } };
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
    const value = { map: d.map, scores: played.length ? [won, lost] : null, result: !played.length ? null : won > lost ? 'win' : won < lost ? 'loss' : 'tie' };
    summaries.set(outcomeId, { mtime, steamId, value });
    return value;
  } catch { return null; }
}
const summaries = new Map();

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
    matches: st.matches.map(m => {
      const parsed = m.outcomeId ? fs.existsSync(path.join(PARSED, `${m.outcomeId}.json`)) : false;
      const sum = parsed && (!m.map || !m.scores) ? summary(m.outcomeId, s.steamId) : null;
      return {
        code: m.code, outcomeId: m.outcomeId ?? null, source: m.source ?? 'matchmaking', time: m.time ?? null,
        map: m.map ?? sum?.map ?? null, scores: m.scores ?? sum?.scores ?? null, result: m.result ?? sum?.result ?? null, kd: m.kd ?? null,
        download: m.outcomeId ? downloadLink(m.code) : null, parsed,
      };
    }),
  };
}

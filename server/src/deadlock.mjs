// The Deadlock bot service: makes every RageView visitor's Deadlock matches appear by themselves. A visitor adds the
// bot as a Steam friend once (the site has the button); from then on, every few minutes the bot asks Deadlock's game
// coordinator for their recent matches and each new match's salts, checks the match file is really there, and hands
// the salts to deadlock-api (its public ingest), which then fetches the match and, when Valve kept one, its replay.
// The site reads matches from deadlock-api as before, and from this service right away (GET /dl/matches/<account>).
//
//   npm run deadlock            (needs `npm run login` once, or STEAM_REFRESH_TOKEN in the environment)
//
// Settings (environment or server/.env): PORT (8080), DATA_DIR, DL_POLL_MINUTES (10), DL_ALLOW_ORIGINS, WORKER_URL.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DATA } from './config.mjs';
import { Bot, TOKEN_FILE } from './bot.mjs';
import { cs2Configured, cs2Loop } from './cs2.mjs';
import { APP_ID } from './deadlock/proto.mjs';
import { accountOf, DeadlockBot, readToken } from './deadlock/bot.mjs';
import { pollFriend } from './deadlock/poll.mjs';

const PORT = Number(process.env.PORT || 8080);
const POLL_MINUTES = Number(process.env.DL_POLL_MINUTES || 10);
/** The site's API: "Check now" asks it who the caller is and whether they have Pro. */
const WORKER_URL = (process.env.WORKER_URL || 'https://stratboard-api.stratboard.workers.dev').replace(/\/$/, '');
const ORIGINS = (process.env.DL_ALLOW_ORIGINS || 'https://tsakhstvo.xyz,http://localhost:5173').split(',').map(s => s.trim());
const STATE_FILE = path.join(DATA, 'deadlock-state.json');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// what's been seen: each friend's recent matches (for the site) and which matches were already handed on
const state = (() => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { matches: {}, sent: {}, polled: {} }; }
})();
let dirty = false;
setInterval(() => { if (dirty) { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); dirty = false; } }, 10_000).unref();

// the CS2 bot on the same login (Steam allows one login per account), when the Worker's SERVER_TOKEN is set; CS2_BOT=off
// turns it off
const cs2 = cs2Configured() && process.env.CS2_BOT !== 'off' ? new Bot(log) : null;
const bot = new DeadlockBot({ token: readToken(TOKEN_FILE), saveToken: t => fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 }), log,
  games: cs2 ? [730, APP_ID] : [APP_ID], onUser: user => cs2?.attach(user) });

/** One friend: their recent matches, and the new ones handed on (deadlock/poll.mjs). */
async function poll(account) { await pollFriend(bot, state, account, log); dirty = true; }

/** Every friend in turn, then again after DL_POLL_MINUTES. */
async function loop() {
  for (;;) {
    const t0 = Date.now();
    for (const account of bot.friends()) {
      try { await poll(account); } catch (e) {
        log(`friend ${account}: ${e.message}`);
        if (/RateLimited|TooBusy/.test(e.message)) await new Promise(r => setTimeout(r, 60_000));
      }
    }
    // forget handed-on matches after two weeks
    for (const [id, v] of Object.entries(state.sent)) if (Date.now() - v.at > 14 * 86400e3) delete state.sent[id];
    await new Promise(r => setTimeout(r, Math.max(10_000, POLL_MINUTES * 60_000 - (Date.now() - t0))));
  }
}

// ---- the site's endpoints (read-only, plus "check now") ------------------------------------------------------------
const lastAsk = new Map();
/** Who a site session belongs to and whether they have Pro, from the Worker (kept 5 minutes per session). */
const whoCache = new Map();
async function whoIs(token) {
  if (!token) return null;
  const c = whoCache.get(token);
  if (c && Date.now() - c.at < 300_000) return c.me;
  const res = await fetch(`${WORKER_URL}/me`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  const me = res?.ok ? (await res.json()).me ?? null : null;
  whoCache.set(token, { at: Date.now(), me });
  if (whoCache.size > 5000) whoCache.clear();
  return me;
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) };
  const send = (code, obj) => { res.writeHead(code, headers); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); return res.end(); }
  const url = new URL(req.url ?? '/', 'http://x'), parts = url.pathname.split('/').filter(Boolean);
  try {
    if (url.pathname === '/health') return send(200, { ok: true, state: bot.state, cs2: cs2 ? cs2.state : 'off' });
    // the bot itself: who to add as a friend
    if (url.pathname === '/dl/bot') return send(200, { steamId: bot.steamId, state: bot.state, friends: bot.friends().length, pollMinutes: POLL_MINUTES });
    const account = Number(parts[2]);
    if (parts[0] === 'dl' && Number.isFinite(account) && account > 0) {
      // whether they're the bot's friend, and their matches as the bot last saw them
      if (parts[1] === 'friend' && req.method === 'GET') return send(200, { relation: bot.relation(account), polled: state.polled[account] ?? null });
      if (parts[1] === 'matches' && req.method === 'GET') {
        if (bot.relation(account) !== 'friend') return send(200, { relation: bot.relation(account), matches: [] });
        return send(200, { relation: 'friend', polled: state.polled[account] ?? null, matches: state.matches[account] ?? [] });
      }
      // "check now": Pro only, for yourself (your site login, checked with the Worker), once a minute
      if (parts[1] === 'refresh' && req.method === 'POST') {
        const me = await whoIs(req.headers.authorization?.match(/^Bearer ([\w-]{20,})$/)?.[1]);
        if (!me) return send(401, { error: 'Log in on the site first.' });
        if (accountOf(me.steamId) !== account) return send(403, { error: 'You can only check your own matches.' });
        if (!me.pro) return send(403, { error: 'Check now is part of Pro.' });
        if (bot.relation(account) !== 'friend') return send(403, { error: 'Add the bot as a friend first.' });
        if (Date.now() - (lastAsk.get(account) ?? 0) < 60_000) return send(429, { error: 'Checked a moment ago.' });
        lastAsk.set(account, Date.now());
        await poll(account);
        return send(200, { polled: state.polled[account], matches: state.matches[account] ?? [] });
      }
    }
    send(404, { error: 'Not found' });
  } catch (e) { send(500, { error: e instanceof Error ? e.message : String(e) }); }
});

server.listen(PORT, () => log(`deadlock bot service on :${PORT}`));
try {
  await bot.start();
  loop();
  if (cs2) cs2Loop(cs2, log).catch(e => log(`cs2: ${e.message}`));
} catch (e) {
  // the endpoints stay up and say what's wrong (/health)
  bot.state = 'error';
  log(`deadlock bot: ${e.message}`);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (dirty) fs.writeFileSync(STATE_FILE, JSON.stringify(state)); bot.stop(); process.exit(0); });

// Both bots, one round, then exit: what GitHub Actions runs every 15 minutes (.github/workflows/bots.yml), free.
// Logs in the bot account (never the owner's or a visitor's), accepts friend requests, finds every friend's new Deadlock
// matches (handed to deadlock-api), tells the Worker what it saw (the site's "Add in Steam" and match list read that),
// then does one CS2 round (new matches of every user: download, read, grade, profile). The Actions log is public (the
// repo is), so SteamIDs, match IDs and share codes are masked in it.
//   node src/once.mjs         (STEAM_REFRESH_TOKEN or server/data/bot-token; SERVER_TOKEN and WORKER_URL)
import fs from 'node:fs';
import { SERVER_TOKEN, WORKER_URL } from './config.mjs';
import { Bot, TOKEN_FILE } from './bot.mjs';
import { cs2Configured, cs2Loop } from './cs2.mjs';
import { APP_ID } from './deadlock/proto.mjs';
import { DeadlockBot, readToken } from './deadlock/bot.mjs';
import { pollFriend, loadState, saveState } from './deadlock/poll.mjs';
import { readFriendsOf } from './deadlock/friendsOf.mjs';

const mask = s => String(s).replace(/CSGO(-\w{5}){5}/g, 'CSGO-…').replace(/\d{7,}/g, '#');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), mask(a.join(' ')));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// a hard stop well inside the job's time limit, so the cache with the renewed login is always saved
setTimeout(() => { log('time is up: stopping'); process.exit(0); }, Number(process.env.RUN_MINUTES || 40) * 60_000).unref();

// paused from the dev page (Bots → Pause): this run does nothing (the Worker's answer; on no answer, run as usual)
if (WORKER_URL && SERVER_TOKEN) {
  const paused = await fetch(`${WORKER_URL}/internal/paused`, { headers: { Authorization: `Bearer ${SERVER_TOKEN}` }, signal: AbortSignal.timeout(10_000) })
    .then(r => (r.ok ? r.json() : null)).then(j => !!j?.paused).catch(() => false);
  if (paused) { log('paused from the dev page: nothing to do'); process.exit(0); }
}

const cs2 = cs2Configured() && process.env.CS2_BOT !== 'off' ? new Bot(log) : null;
const bot = new DeadlockBot({ token: readToken(TOKEN_FILE), saveToken: t => fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 }), log,
  games: cs2 ? [730, APP_ID] : [APP_ID], onUser: user => cs2?.attach(user) });

const timeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${what}: no answer in ${ms / 1000} s`); })]);
try {
  await timeout(bot.start(), 180_000, 'Deadlock');
  await sleep(5000); // friend requests come in with the friends list: accepted by the bot
  const state = loadState();
  for (const account of bot.friends()) {
    try { await pollFriend(bot, state, account, log); } catch (e) {
      log(`friend ${account}: ${e.message}`);
      if (/RateLimited|TooBusy/.test(e.message)) await sleep(30_000);
    }
  }
  try { await readFriendsOf(bot.user, bot.friends(), state, log); } catch (e) { log(`friends lists: ${e.message}`); }
  saveState(state);
  // what the site shows (Worker /dl/bot, /dl/friend, /dl/matches): one write, only when something changed
  if (WORKER_URL && SERVER_TOKEN) {
    const res = await fetch(`${WORKER_URL}/internal/dlbot`, { method: 'POST', headers: { Authorization: `Bearer ${SERVER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId: bot.steamId, friends: bot.friends(), pending: bot.pending(), matches: state.matches, polled: state.polled, friendsOf: state.friendsOf ?? {} }) });
    log(res.ok ? `site told: ${bot.friends().length} friends` : `site: ${res.status}`);
  }
} catch (e) { log(`deadlock: ${e.message}`); }

if (cs2) {
  try { await timeout(cs2.ready(120_000), 125_000, 'CS2'); await cs2Loop(cs2, log, true); } catch (e) { log(`cs2: ${e.message}`); }
}
bot.stop();
await sleep(1500);
process.exit(0);

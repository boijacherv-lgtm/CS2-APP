// The CS2 side of the bot: every few minutes, for every user of the website, ask Valve for their new matches (through
// the Worker), then for each new match get the demo with the bot, parse it, grade it and send both to the Worker
// (the demo for Review, the grading for the user's profile). Run on its own (main.mjs) or next to the Deadlock bot on
// the same Steam login (deadlock.mjs, when SERVER_TOKEN is set).
import { execSync } from 'node:child_process';
import { CYCLE_MINUTES, ROOT, SERVER_TOKEN, WORKER_URL } from './config.mjs';
import { canGrade, Gone, gradedMatch, parsedDemo, summary } from './process.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const cs2Configured = () => !!(WORKER_URL && SERVER_TOKEN);

/** Talks to the Worker's /internal/* routes with the shared token. */
async function worker(method, route, body, raw = false) {
  const res = await fetch(`${WORKER_URL}/internal${route}`, {
    method,
    headers: { Authorization: `Bearer ${SERVER_TOKEN}`, ...(raw ? { 'Content-Type': 'application/gzip' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Worker ${route}: ${res.status} ${out.error ?? ''}`);
  return out;
}

const VERSION = process.env.BOT_VERSION || process.env.FLY_IMAGE_REF?.split(':').pop() || (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } })();

/** One round over every user's new matches. */
async function cycle(bot, log, uploaded, grading) {
  const t0 = Date.now(), done = { handled: 0, ready: 0, failed: 0, gone: 0 };
  const { users } = await worker('GET', '/users');
  for (const steamId of users) {
    try { await worker('POST', `/sync/${steamId}`); } catch (e) { log(`cs2: sync ${steamId}: ${e.message}`); }
    const { pending } = await worker('GET', `/pending/${steamId}`);
    for (const m of pending) {
      log(`cs2: ${steamId} ${m.code}`);
      try {
        const info = await bot.matchInfo(m.code);
        const { gz } = await parsedDemo(m.outcomeId, info, log);
        if (!uploaded.has(m.outcomeId)) { await worker('PUT', `/demo/${m.outcomeId}`, gz, true); uploaded.add(m.outcomeId); }
        await worker('POST', `/result/${steamId}`, { outcomeId: m.outcomeId, parsed: true, info: summary(gz, steamId, info.time) });
        // the match on their profile too (its demo stays usable even if grading fails)
        if (grading) {
          try {
            const entry = (await gradedMatch(m.outcomeId, gz, info.time, log))[steamId];
            if (entry) { await worker('POST', `/profile/${steamId}`, { match: entry }); log('  ✓ on their profile'); }
          } catch (e) { log(`  ! profile: ${e.message}`); }
        }
        log('  ✓ ready');
        done.ready++;
      } catch (e) {
        const gone = e instanceof Gone;
        log(`  ${gone ? '✗ gone' : '! failed'}: ${e.message}`);
        if (gone) done.gone++; else done.failed++;
        await worker('POST', `/result/${steamId}`, { outcomeId: m.outcomeId, gone, error: e.message }).catch(() => {});
      }
      done.handled++;
      await sleep(3000); // gentle on CS2's game coordinator
    }
  }
  // the site owner's dev page shows when the bot last ran and how it went
  await worker('POST', '/heartbeat', { users: users.length, ...done, cycleMs: Date.now() - t0, grading, version: VERSION }).catch(e => log(`cs2: heartbeat: ${e.message}`));
}

/** Runs rounds forever (or once), every CYCLE_MINUTES. `bot` is a connected (or connecting) CS2 Bot. */
export async function cs2Loop(bot, log, once = false) {
  const uploaded = new Set(); // demos the Worker already has (this run)
  const grading = canGrade();
  if (!grading) log('cs2: the app is installed without its dev tools: matches are added, but not to profiles (see server/README.md).');
  for (;;) {
    try { await cycle(bot, log, uploaded, grading); } catch (e) { log(`cs2: cycle failed: ${e.message}`); }
    if (once) return;
    await sleep(CYCLE_MINUTES * 60_000);
  }
}

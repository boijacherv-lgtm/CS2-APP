// Stratboard server: every few minutes, for every user of the website, ask Valve for their new matches (through
// the Worker), then for each new match get the demo with the bot, parse it and send it to the Worker.
// Runs on any always-on machine with Node.js. Only outgoing connections.
//   npm start        run forever
//   npm run once     one round, then exit (for testing)
import { CYCLE_MINUTES, SERVER_TOKEN, WORKER_URL } from './config.mjs';
import { Bot } from './bot.mjs';
import { Gone, parsedDemo, summary } from './process.mjs';

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!WORKER_URL || !SERVER_TOKEN) { console.error('Set WORKER_URL and SERVER_TOKEN in server/.env (see server/README.md).'); process.exit(1); }

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

const uploaded = new Set(); // demos the Worker already has (this run)

async function cycle(bot) {
  const { users } = await worker('GET', '/users');
  for (const steamId of users) {
    try { await worker('POST', `/sync/${steamId}`); } catch (e) { log(`sync ${steamId}: ${e.message}`); }
    const { pending } = await worker('GET', `/pending/${steamId}`);
    for (const m of pending) {
      log(`${steamId} ${m.code}`);
      try {
        const info = await bot.matchInfo(m.code);
        const { gz } = await parsedDemo(m.outcomeId, info, log);
        if (!uploaded.has(m.outcomeId)) { await worker('PUT', `/demo/${m.outcomeId}`, gz, true); uploaded.add(m.outcomeId); }
        await worker('POST', `/result/${steamId}`, { outcomeId: m.outcomeId, parsed: true, info: summary(gz, steamId, info.time) });
        log('  ✓ ready');
      } catch (e) {
        const gone = e instanceof Gone;
        log(`  ${gone ? '✗ gone' : '! failed'}: ${e.message}`);
        await worker('POST', `/result/${steamId}`, { outcomeId: m.outcomeId, gone, error: e.message }).catch(() => {});
      }
      await sleep(3000); // gentle on CS2's game coordinator
    }
  }
}

const bot = new Bot(log);
await bot.start();
const once = process.argv.includes('--once');
for (;;) {
  try { await cycle(bot); } catch (e) { log(`cycle failed: ${e.message}`); }
  if (once) break;
  await sleep(CYCLE_MINUTES * 60_000);
}
bot.stop();
process.exit(0);

// Stratboard server, CS2 only, on its own Steam login (the Fly app runs it inside deadlock.mjs instead, on the
// Deadlock bot's login). Runs on any always-on machine with Node.js. Only outgoing connections.
//   npm start        run forever
//   npm run once     one round, then exit (for testing)
import { Bot } from './bot.mjs';
import { cs2Configured, cs2Loop } from './cs2.mjs';

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
if (!cs2Configured()) { console.error('Set WORKER_URL and SERVER_TOKEN in server/.env (see server/README.md).'); process.exit(1); }

const bot = new Bot(log);
await bot.start();
await cs2Loop(bot, log, process.argv.includes('--once'));
bot.stop();
process.exit(0);

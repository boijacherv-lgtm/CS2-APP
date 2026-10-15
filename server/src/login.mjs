// One-time login of the BOT account (never your main account). Run on the server:  npm run login
// You type the bot's login, password and Steam Guard code yourself; only Steam's refresh token is saved
// (data/bot-token, readable only by this user). Nothing is sent anywhere else.
import fs from 'node:fs';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { TOKEN_FILE } from './bot.mjs';

const require = createRequire(import.meta.url);
const SteamUser = require('steam-user');

function ask(q, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // don't echo the password
      rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); };
    }
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

console.log('Log in the BOT Steam account (a separate account you made for this, not your main one).');
const accountName = await ask('Bot account login: ');
const password = await ask('Bot account password (hidden): ', true);

const user = new SteamUser();
user.on('steamGuard', async (domain, callback, lastCodeWrong) => {
  if (lastCodeWrong) console.log('That code was wrong, try the next one.');
  callback(await ask(domain ? `Steam Guard code from the email at ${domain}: ` : 'Steam Guard code from the Steam mobile app: '));
});
user.on('refreshToken', token => {
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
});
user.on('loggedOn', () => {
  user.requestFreeLicense([730], () => { // CS2 is free; the bot needs it in its library
    console.log(`Logged in as the bot (SteamID ${user.steamID.getSteamID64()}). The login is saved; you can start the service now.`);
    setTimeout(() => { user.logOff(); process.exit(0); }, 1500);
  });
});
user.on('error', e => { console.error(`Steam said: ${e.message}`); process.exit(1); });
user.logOn({ accountName, password });

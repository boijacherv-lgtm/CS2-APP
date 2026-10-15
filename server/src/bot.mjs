// The bot: a dedicated Steam account (NOT the site owner's account, never a visitor's) that stays logged in to
// CS2's game coordinator so it can ask where a match's demo is, the way Leetify / csstats do.
// Its login is done once by the owner on the server with `npm run login` (they type the password and Steam
// Guard code themselves); after that a saved refresh token is used. If Steam ever objects, only this bot
// account is affected.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DATA } from './config.mjs';

const require = createRequire(import.meta.url);
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');

export const TOKEN_FILE = path.join(DATA, 'bot-token');

export class Bot {
  constructor(log = console.log) {
    this.log = log;
    this.state = 'off';
    this.user = null;
    this.csgo = null;
  }

  /** Logs in with the saved token and waits until CS2's game coordinator is ready. */
  async start() {
    let token = '';
    try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* none */ }
    if (!token) throw new Error('The bot is not logged in yet: run `npm run login` on the server once.');
    const user = new SteamUser({ autoRelogin: true, renewRefreshTokens: true });
    const csgo = new GlobalOffensive(user);
    this.user = user; this.csgo = csgo;
    user.on('refreshToken', t => fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 }));
    user.on('error', e => {
      this.state = 'error';
      this.log(`bot: Steam error: ${e.message}`);
      if (/InvalidPassword|AccessDenied|Expired|Revoked/i.test(e.message)) this.log('bot: the saved login is no longer valid, run `npm run login` again.');
    });
    user.on('disconnected', () => { this.state = 'connecting'; });
    csgo.on('connectedToGC', () => { this.state = 'ready'; this.log('bot: connected to CS2'); });
    csgo.on('disconnectedFromGC', () => { if (this.state === 'ready') this.state = 'connecting'; });
    user.on('loggedOn', () => {
      this.log('bot: logged in to Steam');
      user.gamesPlayed([730]); // CS2 "running", so the game coordinator answers
    });
    this.state = 'connecting';
    user.logOn({ refreshToken: token });
    await this.ready(60000);
  }

  ready(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (this.state === 'ready') return resolve();
        if (this.state === 'error' && Date.now() - t0 > 5000) return reject(new Error('Bot could not connect to Steam.'));
        if (Date.now() - t0 > timeoutMs) return reject(new Error('Timed out connecting to CS2.'));
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  /** Where the demo is, when the match was, and the score, straight from CS2's game coordinator. */
  async matchInfo(code) {
    if (this.state !== 'ready') await this.ready();
    const { ShareCode } = require('globaloffensive-sharecode');
    const { matchId } = new ShareCode(code).decode();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.csgo.off('matchList', onList); reject(new Error('CS2 did not answer about this match.')); }, 20000);
      const onList = matches => {
        const m = matches?.find(x => String(x.matchid) === String(matchId));
        if (!m) return;
        clearTimeout(timer);
        this.csgo.off('matchList', onList);
        const rs = m.roundstatsall?.[m.roundstatsall.length - 1] ?? m.roundstats_legacy;
        resolve({ url: rs?.map || null, time: m.matchtime ? m.matchtime * 1000 : null });
      };
      this.csgo.on('matchList', onList);
      this.csgo.requestGame(code);
    });
  }

  stop() { try { this.user?.logOff(); } catch { /* already off */ } }
}

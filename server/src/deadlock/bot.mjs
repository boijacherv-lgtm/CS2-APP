// The Deadlock side of the bot: the same dedicated bot Steam account (never the owner's or a visitor's), logged in with
// its saved token, "playing" Deadlock so its game coordinator answers. It accepts every friend request, and for its
// friends it can read their match history and each match's salts (the keys to its data and replay files on Valve's
// servers), which is all deadlock-api needs to fetch a match.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { APP_ID, MSG, T, RESULT, encode, decode } from './proto.mjs';

const require = createRequire(import.meta.url);
const SteamUser = require('steam-user');
const { EFriendRelationship } = SteamUser;

/** SteamID3 (the account number Deadlock uses) from a 64-bit SteamID string. */
export const accountOf = id64 => Number(BigInt(id64) - 76561197960265728n);
export const id64Of = account => String(BigInt(account) + 76561197960265728n);

export class DeadlockBot {
  /** `token`: the bot's Steam refresh token; `saveToken` keeps a renewed one. */
  /** `games`: the apps it "plays" (Deadlock; plus CS2 730 when the CS2 bot shares this login); `onUser`: called with the
   * Steam login before it logs on (the CS2 bot attaches to it). */
  constructor({ token, saveToken = () => {}, log = console.log, games = [APP_ID], onUser = () => {} }) {
    this.token = token; this.saveToken = saveToken; this.log = log; this.games = games; this.onUser = onUser;
    this.state = 'off';
    this.user = null;
    /** When the last game coordinator request went out: they're spaced so it doesn't rate-limit us. */
    this.lastSend = 0;
  }

  async start() {
    if (!this.token) throw new Error('The bot is not logged in yet: run `npm run login` once (or set STEAM_REFRESH_TOKEN).');
    const user = new SteamUser({ autoRelogin: true, renewRefreshTokens: true });
    this.user = user;
    this.onUser(user);
    user.on('refreshToken', t => { this.token = t; this.saveToken(t); });
    user.on('error', e => {
      this.state = 'error';
      this.log(`deadlock bot: Steam error: ${e.message}`);
      if (/InvalidPassword|AccessDenied|Expired|Revoked/i.test(e.message)) this.log('deadlock bot: the saved login is no longer valid, run `npm run login` again.');
    });
    user.on('disconnected', () => { this.state = 'connecting'; });
    user.on('loggedOn', () => {
      this.log(`deadlock bot: logged in to Steam as ${user.steamID.getSteamID64()}`);
      // invisible: friends see it offline (no "online" or "now playing Deadlock" pop-ups); it still talks to Deadlock's
      // game coordinator and accepts friend requests
      user.setPersona(SteamUser.EPersonaState.Invisible);
      // Deadlock has to be in the bot's library for its game coordinator to answer: ask for it (free) every time
      user.requestFreeLicense(this.games, (err, packages, apps) => {
        this.log(err ? `deadlock bot: couldn't get Deadlock's license (${err.message}): add Deadlock to the bot's library in Steam`
          : apps?.length ? `deadlock bot: Deadlock added to the bot's library` : 'deadlock bot: license request done (nothing new granted)');
        user.gamesPlayed(this.games);
        this.hello();
      });
    });
    // which games the bot's licenses hold. Package info fetched without access tokens often leaves free games out, so a
    // missing Deadlock here proves nothing: the game coordinator's welcome ("connected to Deadlock") is the real check
    user.on('licenses', ls => {
      const ids = ls.map(l => l.package_id);
      user.getProductInfo([], ids, false, (err, apps, packages) => {
        if (err) return this.log(`deadlock bot: licenses: ${err.message}`);
        const owned = new Set(Object.values(packages ?? {}).flatMap(p => Object.values(p.packageinfo?.appids ?? {}).map(Number)));
        this.log(`deadlock bot: ${ids.length} licenses${owned.has(APP_ID) ? ', Deadlock among them' : ''}; waiting for Deadlock's game coordinator`);
      });
    });
    let heard = 0;
    user.on('receivedFromGC', (appid, msgType) => {
      if (heard++ < 15) this.log(`deadlock bot: from the game coordinator: app ${appid}, message ${msgType}`);
      if (appid === APP_ID && msgType === MSG.ClientWelcome && this.state !== 'ready') { this.state = 'ready'; this.log('deadlock bot: connected to Deadlock'); }
    });
    // friends: accept every request, now and whenever one comes
    user.on('friendRelationship', (sid, rel) => { if (rel === EFriendRelationship.RequestRecipient) this.accept(sid.getSteamID64()); });
    user.on('friendsList', () => {
      for (const [id, rel] of Object.entries(user.myFriends)) if (rel === EFriendRelationship.RequestRecipient) this.accept(id);
    });
    this.state = 'connecting';
    user.logOn({ refreshToken: this.token });
    // waits as long as it takes: hello keeps going until the game coordinator answers
    await this.ready(Infinity);
  }

  /** Says hello to the game coordinator until it welcomes us (it ignores everything before that). */
  hello() {
    let n = 0;
    const tick = () => {
      if (this.state === 'ready' || !this.user?.steamID) return;
      this.user.sendToGC(APP_ID, MSG.ClientHello, {}, encode(T.Hello, {}));
      if (++n === 24) this.log('deadlock bot: no answer from Deadlock after 2 minutes; still trying every 30 s');
      setTimeout(tick, n < 24 ? 5000 : 30000);
    };
    tick();
  }

  accept(id64) {
    this.user.addFriend(id64, err => this.log(err ? `deadlock bot: couldn't accept ${id64}: ${err.message}` : `deadlock bot: new friend ${id64}`));
  }

  ready(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (this.state === 'ready') return resolve();
        if (Date.now() - t0 > timeoutMs) return reject(new Error('Timed out connecting to Deadlock.'));
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  get steamId() { return this.user?.steamID?.getSteamID64() ?? null; }
  /** Accounts (SteamID3) that are the bot's friends. */
  friends() {
    return Object.entries(this.user?.myFriends ?? {}).filter(([, r]) => r === EFriendRelationship.Friend).map(([id]) => accountOf(id));
  }
  /** Accounts that asked to be friends and aren't accepted yet (accepted in a moment). */
  pending() {
    return Object.entries(this.user?.myFriends ?? {}).filter(([, r]) => r === EFriendRelationship.RequestRecipient).map(([id]) => accountOf(id));
  }
  /** 'friend', 'pending' (asked, not accepted yet) or 'none'. */
  relation(account) {
    const r = this.user?.myFriends?.[id64Of(account)];
    return r === EFriendRelationship.Friend ? 'friend' : r === EFriendRelationship.RequestRecipient || r === EFriendRelationship.RequestInitiator ? 'pending' : 'none';
  }

  /** One request to the game coordinator and its answer (waits its turn: at least 2.5 s between requests). */
  async ask(msg, type, body, responseType) {
    if (this.state !== 'ready') await this.ready();
    const wait = this.lastSend + 2500 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastSend = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deadlock did not answer.')), 20000);
      this.user.sendToGC(APP_ID, msg, {}, encode(type, body), (appid, msgType, payload) => {
        clearTimeout(timer);
        try { resolve(decode(responseType, payload)); } catch (e) { reject(e); }
      });
    });
  }

  /** A player's recent matches, newest first (the game shows its own and its friends'). */
  async matchHistory(account) {
    const r = await this.ask(MSG.GetMatchHistory, T.History, { account_id: account }, T.HistoryResponse);
    if (r.result !== 1) throw new Error(`match history: ${RESULT[r.result] ?? r.result}`);
    return r.matches.map(m => ({ ...m, match_id: Number(m.match_id) }));
  }

  /** A match's salts: where its data and replay are on Valve's servers. */
  async salts(matchId) {
    const r = await this.ask(MSG.GetMatchMetaData, T.MetaData, { match_id: matchId }, T.MetaDataResponse);
    if (r.result !== 1) return { error: RESULT[r.result] ?? String(r.result) };
    return { match_id: matchId, cluster_id: r.replay_group_id || null, metadata_salt: r.metadata_salt || null, replay_salt: r.replay_salt || null, replay_valid_through: r.replay_valid_through || null };
  }

  stop() { try { this.user?.logOff(); } catch { /* already off */ } }
}

/** The bot's login: the saved one (renewed by Steam over time) first, else STEAM_REFRESH_TOKEN (how a host gets it). */
export function readToken(file) {
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t; } catch { /* none saved */ }
  return (process.env.STEAM_REFRESH_TOKEN ?? '').trim();
}

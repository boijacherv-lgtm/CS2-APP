// One friend's new Deadlock matches handed to deadlock-api, and what's been seen (kept in DATA between runs).
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.mjs';

const API = 'https://api.deadlock-api.com';
const STATE_FILE = path.join(DATA, 'deadlock-state.json');

export function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { matches: {}, sent: {}, polled: {} }; }
}
export function saveState(state) {
  // forget handed-on matches after two weeks
  for (const [id, v] of Object.entries(state.sent)) if (Date.now() - v.at > 14 * 86400e3) delete state.sent[id];
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

/** The match file on Valve's server answers: the salts and cluster are right. */
async function checkSalts(s) {
  if (!s.cluster_id || !s.metadata_salt) return false;
  const res = await fetch(`http://replay${s.cluster_id}.valve.net/1422450/${s.match_id}_${s.metadata_salt}.meta.bz2`, { method: 'HEAD' }).catch(() => null);
  return !!res?.ok;
}

/** Hands a match's salts to deadlock-api, which then fetches the match (and its replay when there is one). */
async function submit(s) {
  const body = [{ match_id: s.match_id, cluster_id: s.cluster_id, metadata_salt: s.metadata_salt, replay_salt: s.replay_salt, username: 'rageview-bot' }];
  const res = await fetch(`${API}/v1/matches/salts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'rageview-bot (tsakhstvo.xyz)' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`deadlock-api answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

/** One friend: their recent matches, and the new ones handed on. */
export async function pollFriend(bot, state, account, log) {
  const ms = await bot.matchHistory(account);
  state.matches[account] = ms.slice(0, 50);
  state.polled[account] = Date.now();
  // only matches from the last week are worth fetching (replays don't last longer)
  for (const m of ms.filter(x => Date.now() / 1000 - x.start_time < 7 * 86400 && !state.sent[x.match_id])) {
    const s = await bot.salts(m.match_id);
    if (s.error) {
      log(`match ${m.match_id}: ${s.error}`);
      // asked too often: stop for this round, the rest are tried next round
      if (/RateLimited|TooBusy/.test(s.error)) throw new Error(s.error);
      // still being written up by the game (MatchInFlight): next round; anything else is final
      if (s.error !== 'MatchInFlight') state.sent[m.match_id] = { at: Date.now(), error: s.error };
      continue;
    }
    const ok = await checkSalts(s);
    if (!ok) log(`match ${m.match_id}: the match file isn't where the salts say (cluster ${s.cluster_id}); sending anyway`);
    await submit(s);
    state.sent[m.match_id] = { at: Date.now(), replay: !!s.replay_salt };
    log(`match ${m.match_id} (${account}) handed to deadlock-api${s.replay_salt ? ', with its replay' : ', no replay'}`);
  }
}

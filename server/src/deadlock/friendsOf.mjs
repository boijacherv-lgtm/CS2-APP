// The bot's friends' own Steam friends lists, read from their Steam Community friends page with the bot's web login.
// Steam's Web API treats a "Friends only" friends list as private, but the bot is their friend, so it can see it. Used by
// the site's Profile → Compare with a friend (Worker /friends). Refreshed every few hours, kept in DATA between runs.
import { id64Of } from './bot.mjs';

const EVERY_MS = 6 * 3600e3;

/** The web login cookies for steamcommunity.com (steam-user's webSession), or null after a while. */
function webCookies(user, timeoutMs = 20_000) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    user.once('webSession', (_sid, cookies) => { clearTimeout(t); resolve(cookies); });
    user.webLogOn();
  });
}

/** Every friend's friends (SteamID64s), refreshing the ones older than EVERY_MS; `state.friendsOf` / `state.friendsAt`. */
export async function readFriendsOf(user, accounts, state, log) {
  state.friendsOf ??= {}; state.friendsAt ??= {};
  const due = accounts.map(id64Of).filter(id => Date.now() - (state.friendsAt[id] ?? 0) > EVERY_MS);
  // friends that left: their lists go
  for (const id of Object.keys(state.friendsOf)) if (!accounts.map(id64Of).includes(id)) { delete state.friendsOf[id]; delete state.friendsAt[id]; }
  if (!due.length) return;
  const cookies = await webCookies(user);
  if (!cookies) { log('friends lists: no web login'); return; }
  const cookie = cookies.join('; ');
  for (const id of due.slice(0, 20)) {
    try {
      const res = await fetch(`https://steamcommunity.com/profiles/${id}/friends/`, { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 (rageview-bot)' } });
      if (!res.ok) { log(`friends list: ${res.status}`); continue; }
      const html = await res.text();
      const ids = [...new Set([...html.matchAll(/data-steamid="(7656\d{13})"/g)].map(m => m[1]))].filter(x => x !== id).slice(0, 300);
      state.friendsOf[id] = ids;
      state.friendsAt[id] = Date.now();
      log(`friends list read: ${ids.length} friends`);
    } catch (e) { log(`friends list: ${e.message}`); }
    await new Promise(r => setTimeout(r, 1500));
  }
}

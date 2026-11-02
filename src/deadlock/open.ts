/** Opening a match for Review and Match recap: the match, then (in the background) names, benchmarks and its demo. */
import { loadMatch, matchHistory } from './api';
import { steamNames } from './api';
import { loadBenchmarks } from './coach';
import { readDemo } from './demo';
import { useDl } from './store';

export async function openMatch(matchId: number) {
  const m = await loadMatch(matchId);
  useDl.getState().open(m);
  steamNames(m.players.map(p => p.account)).then(names => { if (useDl.getState().match?.id === m.id) useDl.setState({ names }); }).catch(() => {});
  // the average player on each hero, for the laning grade
  loadBenchmarks(m.players.map(p => p.hero)).then(bench => { if (useDl.getState().match?.id === m.id) useDl.setState({ bench }); });
  // the demo, read by deadlock-api (about a minute the first time): exact camps, urn, buffs, casts
  void readDemo(m);
  return m;
}

/** Opens the account's newest match (Match recap with nothing open); null when it has none. */
export async function openLatest(account: string) {
  const rows = await matchHistory(account);
  return rows[0] ? openMatch(rows[0].match_id) : null;
}

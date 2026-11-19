import { describe, expect, it } from 'vitest';
import { soloVsParty, type DlHistoryRow } from '../api';

const row = (match_id: number, win: boolean, k: number, d: number, a: number) =>
  ({ match_id, player_team: 0, match_result: win ? 0 : 1, player_kills: k, player_deaths: d, player_assists: a }) as DlHistoryRow;

describe('soloVsParty', () => {
  it('splits by the party match ids and counts wins and KDA', () => {
    const s = soloVsParty([row(1, true, 4, 2, 4), row(2, false, 1, 4, 1), row(3, true, 6, 0, 6)], new Set([3]));
    expect(s.solo).toEqual({ n: 2, wins: 1, kda: 10 / 6 });
    expect(s.party).toEqual({ n: 1, wins: 1, kda: 12 });
  });
});

import { describe, expect, it } from 'vitest';
import { rankName, scoutRows } from '../api';

describe('scout', () => {
  it('takes each player\'s record on the hero they picked, and their rank', () => {
    const rows = scoutRows([{ account_id: 1, team: 0, hero_id: 7 }, { account_id: 2, team: 1, hero_id: 3 }],
      [{ account_id: 1, hero_id: 7, matches_played: 10, wins: 6, kills: 20, deaths: 10, assists: 30 }, { account_id: 1, hero_id: 3, matches_played: 99, wins: 0, kills: 0, deaths: 1, assists: 0 }],
      [{ account_id: 1, badge: 84 }, { account_id: 2, badge: 0 }], { 1: { name: 'A' } });
    expect(rows[0]).toEqual({ account: 1, team: 0, hero: 7, name: 'A', badge: 84, games: 10, wr: 0.6, kda: 5 });
    expect(rows[1]).toMatchObject({ badge: null, games: 0, wr: null, kda: null, name: null });
    expect(rankName(84)).toBe('Oracle 4');
  });
});

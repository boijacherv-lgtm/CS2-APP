import { describe, expect, it } from 'vitest';
import { pickMostWon } from '../meta';

describe('pickMostWon', () => {
  it('takes the most wins, the better rate on a tie, and skips builds under 3 matches', () => {
    expect(pickMostWon([{ id: 1, wins: 5, matches: 12 }, { id: 2, wins: 5, matches: 8 }, { id: 3, wins: 2, matches: 2 }])?.id).toBe(2);
    expect(pickMostWon([{ id: 3, wins: 2, matches: 2 }])).toBeNull();
  });
});

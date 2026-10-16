import { describe, expect, it } from 'vitest';
import { calloutAt, moveKey, type Grade, type Move } from '../recap';

const mv = (t: number, player: string, grade: Grade = 'B', kind: Move['kind'] = 'kill'): Move =>
  ({ t, player, side: 'CT', kind, gain: 0.05, grade, title: `${player} at ${t}`, why: [], tags: [] });

// a multi-kill (three at once), a grenade right after it, and a quiet kill later
const moves = [mv(10, 'a'), mv(10, 'b'), mv(10, 'c'), mv(10.3, 'd', 'A', 'utility'), mv(14, 'e', 'C')];

describe('move windows', () => {
  it('while playing, shows every graded move in order, one at a time, until it has been read', () => {
    const read = new Set<string>();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { move, pending, backlog } = calloutAt(moves, 10.4, true, read, 0);
      expect(move).toBe(pending);
      expect(backlog).toBe(i < 3);
      seen.push(move!.player);
      read.add(moveKey(move!));
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    // all read: the latest one stays up, nothing is pending any more
    expect(calloutAt(moves, 10.4, true, read, 0).pending).toBeUndefined();
  });

  it('paused, pages through the moves of the same moment', () => {
    const at = calloutAt(moves, 10.1, false, new Set(), 1);
    expect(at.group.map(m => m.player)).toEqual(['a', 'b', 'c']);
    expect(at.move!.player).toBe('b');
  });

  it('a quiet kill still gets a window (it is a moment you can step to)', () => {
    expect(calloutAt(moves, 14.1, false, new Set(), 0).move!.player).toBe('e');
  });
});

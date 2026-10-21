import { describe, expect, it } from 'vitest';
import { rageLine, rageSummary } from '../rage';
import type { Move } from '../recap';

const move = (o: Partial<Move>): Move => ({ t: 30, player: '1', side: 'CT', kind: 'death', gain: -0.2, note: '?', title: 'x', why: [], tags: [], ...o });

describe('rage mode', () => {
  it('rants about the mistake the move was graded for, the same way every time', () => {
    const alone = move({ tags: ['ISOLATED'] });
    expect(rageLine(alone)).toMatch(/alone|team|solo/i);
    expect(rageLine(alone)).toBe(rageLine({ ...alone }));
    expect(rageLine(move({ kind: 'flash', note: '??', tags: ['TEAM FLASH'] }))).toMatch(/flash|blinded/i);
    expect(rageLine(move({ kind: 'position', note: '??' }))).toBeTruthy();
  });

  it('leaves plain, expected moves alone and is grudging about good ones', () => {
    expect(rageLine(move({ kind: 'utility', note: 'book', gain: 0 }))).toBeNull();
    expect(rageLine(move({ kind: 'kill', note: '!', gain: 0.15 }))).toBeTruthy();
    expect(rageSummary('unusedUtil')).toMatch(/grenades|THROW/);
    expect(rageSummary(null)).toBeTruthy();
  });
});

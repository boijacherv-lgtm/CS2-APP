import { describe, expect, it } from 'vitest';
import { rageLine, rageSummary } from '../rage';
import type { Move } from '../recap';
import REMARKS from '../coach-remarks.json';
import { FEATURE_IDS, MECH_IDS } from '../profile';

const move = (o: Partial<Move>): Move => ({ t: 30, player: '1', side: 'CT', kind: 'death', gain: -0.2, note: '?', title: 'x', why: [], tags: [], ...o });

describe('rage mode', () => {
  it('rants about the mistake the move was graded for, the same way every time', () => {
    const alone = move({ tags: ['ISOLATED'] });
    // from that situation's lines in coach-remarks.json, whatever they say
    expect(REMARKS.rage.moves.isolated.lines).toContain(rageLine(alone));
    expect(rageLine(alone)).toBe(rageLine({ ...alone }));
    expect(REMARKS.rage.moves.teamFlashDied.lines).toContain(rageLine(move({ kind: 'flash', note: '??', tags: ['TEAM FLASH'] })));
    expect(rageLine(move({ kind: 'position', note: '??' }))).toBeTruthy();
  });

  it('leaves plain, expected moves alone and is grudging about good ones', () => {
    expect(rageLine(move({ kind: 'utility', note: 'book', gain: 0 }))).toBeNull();
    expect(rageLine(move({ kind: 'kill', note: '!', gain: 0.15 }))).toBeTruthy();
    expect(rageSummary('unusedUtil')).toBe(REMARKS.rage.summary.unusedUtil);
    expect(rageSummary(null)).toBeTruthy();
  });

  it('has a line for every situation, a summary and a tip for every habit', () => {
    for (const [k, v] of Object.entries(REMARKS.rage.moves)) expect(v.lines.length, k).toBeGreaterThan(0);
    for (const id of [...FEATURE_IDS, ...MECH_IDS]) expect((REMARKS.tips as Record<string, string>)[id], id).toBeTruthy();
    expect(REMARKS.rage.summary.none).toBeTruthy();
  });
});

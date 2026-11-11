import { describe, expect, it } from 'vitest';
import { RAGE_GAP, rageLine, rageLines, rageSummary } from '../rage';
import type { Move } from '../recap';
import REMARKS from '../coach-remarks.json';
import { FEATURE_IDS, MECH_IDS } from '../profile';

const move = (o: Partial<Move>): Move => ({ t: 30, player: '1', side: 'CT', kind: 'death', gain: -0.2, note: '?', title: 'x', why: [], tags: [], ...o });
const texts = (k: keyof typeof REMARKS.rage.moves) => REMARKS.rage.moves[k].lines.map(l => (typeof l === 'string' ? l : l.text));

describe('rage mode', () => {
  it('rants about the mistake the move was graded for, the same way every time', () => {
    // a chance-1 situation always gets a line, from its own list
    const tk = move({ tags: ['TEAM KILL'], kind: 'kill' });
    expect(texts('teamKill')).toContain(rageLine(tk));
    expect(rageLine(tk)).toBe(rageLine({ ...tk }));
    expect(texts('teamFlashDied')).toContain(rageLine(move({ kind: 'flash', note: '??', tags: ['TEAM FLASH'] })));
  });

  it('follows the chance: some cards get nothing, a lower chance gets fewer lines', () => {
    const many = Array.from({ length: 400 }, (_, i) => move({ t: i * 1.3, player: String(i % 10), tags: ['WASTED'], kind: 'flash' }));
    const hit = many.filter(m => rageLine(m)).length / many.length;
    expect(hit).toBeGreaterThan(REMARKS.rage.moves.wasted.chance - 0.12);
    expect(hit).toBeLessThan(REMARKS.rage.moves.wasted.chance + 0.12);
    expect(many.filter(m => rageLine(m, 'mild')).length).toBeLessThan(many.filter(m => rageLine(m)).length);
    expect(many.every(m => rageLine(m, 'off') === null)).toBe(true);
  });

  it('mild never swears', () => {
    const many = Array.from({ length: 300 }, (_, i) => move({ t: i, player: String(i % 10), kind: 'position', note: '??' }));
    for (const m of many) expect(rageLine(m, 'mild') ?? '').not.toMatch(/fuck|shit/i);
  });

  it('spaces the lines: at most one per 10 s of a round', () => {
    const round = Array.from({ length: 40 }, (_, i) => move({ t: i * 2, player: String(i), tags: ['TEAM KILL'], kind: 'kill' }));
    const got = [...rageLines(round, 'full').keys()].map(m => m.t).sort((a, b) => a - b);
    expect(got.length).toBeGreaterThan(3);
    for (let i = 1; i < got.length; i++) expect(got[i] - got[i - 1]).toBeGreaterThanOrEqual(RAGE_GAP);
  });

  it('leaves plain, expected moves alone', () => {
    expect(rageLine(move({ kind: 'utility', note: 'book', gain: 0 }))).toBeNull();
    expect(rageSummary('unusedUtil')).toBe(REMARKS.rage.summary.unusedUtil);
    expect(rageSummary(null)).toBeTruthy();
    expect(rageSummary(null, false, 'off')).toBeNull();
  });

  it('has a chance and lines for every situation, a summary and a tip for every habit', () => {
    for (const [k, v] of Object.entries(REMARKS.rage.moves)) {
      expect(v.lines.length, k).toBeGreaterThan(0);
      expect(v.chance, k).toBeGreaterThan(0);
      expect(v.chance, k).toBeLessThanOrEqual(1);
    }
    for (const id of [...FEATURE_IDS, ...MECH_IDS]) expect((REMARKS.tips as Record<string, string>)[id], id).toBeTruthy();
    expect(REMARKS.rage.summary.none).toBeTruthy();
  });
});

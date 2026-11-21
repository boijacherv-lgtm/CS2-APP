import { describe, expect, it } from 'vitest';
import { LETTER_SCORE, noteOf, scoreOf } from '../reportCard';
import { letterOfScore } from '../grades';

describe("Dota 2's report card", () => {
  it('puts the match grade on the 0–100 scale band for band, B from 50', () => {
    // the match grade's steps land on the other games' steps
    expect(scoreOf(3.6)).toBe(50);
    expect(scoreOf(4.2)).toBe(62);
    expect(scoreOf(5.4)).toBe(85);
    expect(scoreOf(0)).toBe(0);
    expect(scoreOf(9)).toBe(100);
    for (const v of [2.5, 3.2, 3.9, 4.5, 5]) expect(scoreOf(v)).toBeGreaterThan(scoreOf(v - 0.1));
    expect(letterOfScore(3.9)).toBe('B');
  });
  it('colours a score as the coach marks a move', () => {
    expect(noteOf(null)).toBe('book');
    expect(noteOf(80)).toBe('!!');
    expect(noteOf(LETTER_SCORE.A)).toBe('!');
    expect(noteOf(LETTER_SCORE.B)).toBe('book');
    expect(noteOf(LETTER_SCORE.F)).toBe('??');
  });
});

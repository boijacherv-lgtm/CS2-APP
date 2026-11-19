import { describe, expect, it } from 'vitest';
import { swingNote } from '../notes';

describe('swingNote', () => {
  it('never lets a mark fight its number', () => {
    expect(swingNote('?', 0.025)?.text).toBe('Your team still won the fight');
    expect(swingNote('!', -0.03)?.text).toBe('Your team still lost the fight');
    expect(swingNote('?', -0.12)).toEqual({ text: '▼ −12%', tone: 'down' });
    expect(swingNote('!', 0.081)).toEqual({ text: '▲ +8%', tone: 'up' });
  });
  it('shows nothing under 1%', () => {
    expect(swingNote('?!', -0.004)).toBeNull();
    expect(swingNote('!', 0.004)).toBeNull();
  });
});

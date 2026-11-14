import { describe, expect, it } from 'vitest';
import { swingNote } from '../notes';

describe('swingNote', () => {
  it('never lets a mark fight its number', () => {
    expect(swingNote('?', 0.025)?.text).toBe('Your team still won the fight');
    expect(swingNote('!', -0.03)?.text).toBe('Your team still lost the fight');
    expect(swingNote('?', -0.12)).toEqual({ text: '(−12.0 pts)', tone: 'down' });
    expect(swingNote('!', 0.081)).toEqual({ text: '(+8.1 pts)', tone: 'up' });
  });
  it('shows no number under half a point, never +0.0 or −0.0', () => {
    expect(swingNote('?!', -0.0004)).toBeNull();
    expect(swingNote('!', 0.003)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { matchFromMetadata } from '../match';
import { ACTIONS, actionAt, playChances, playInput } from '../playNet';
import PLAY from '../generated/playnet.json';
import type { Mlp } from '../../engine/mlp';
import slice from './match-124566656-slice.json';

describe('the play network', () => {
  const m = matchFromMetadata(slice);
  const p = m.players[0], t = Math.min(600, m.duration - 30);
  it('reads a moment the same size as it was trained on', () => {
    const x = playInput(m, p.slot, t);
    if (!x) return; // dead at that second
    expect(x.f).toHaveLength((PLAY as { net: Mlp }).net.mu.length);
  });
  it('gives every action a chance, adding up to 1', () => {
    const c = playChances((PLAY as { net: Mlp }).net, m, p.slot, t);
    if (!c) return;
    expect(Object.keys(c)).toEqual([...ACTIONS]);
    expect(Object.values(c).reduce((a, v) => a + v, 0)).toBeCloseTo(1, 6);
  });
  it('labels what a player really did as one of the actions', () => {
    const a = actionAt(m, p.slot, t);
    if (a) expect(ACTIONS).toContain(a);
  });
});

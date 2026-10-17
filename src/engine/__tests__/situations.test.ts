import { describe, expect, it } from 'vitest';
import { radarToWorld } from '../coords';
import { getEngine } from '../../map/catalog';
import { phaseOf, placeOf, roundDecisions } from '../situations';
import type { DemoRound } from '../recap';

describe('situations and decisions', () => {
  it('turns a round into holds and moves, with the trigger that came before a move', () => {
    const e = getEngine('de_mirage');
    const spot = (name: string) => radarToWorld(e.map.callouts.find(c => c.name === name)!.pos, e.map.radar);
    const a = spot('Short'), b = spot('Jungle'), t1 = spot('Top Mid');
    const t = Array.from({ length: 41 }, (_, i) => i);
    // the CT holds Short for 15 s, a teammate dies at Top Mid at 14 s, then they fall back to Jungle
    const ct = { side: 'CT' as const, x: t.map(s => (s < 16 ? a.x : b.x)), y: t.map(s => (s < 16 ? a.y : b.y)), z: t.map(() => 0), yaw: t.map(() => 0), hp: t.map(() => 100), alive: t.map(() => 1) };
    const mate = { side: 'CT' as const, x: t.map(() => t1.x), y: t.map(() => t1.y), z: t.map(() => 0), yaw: t.map(() => 0), hp: t.map(s => (s < 14 ? 100 : 0)), alive: t.map(s => (s < 14 ? 1 : 0)) };
    const r = {
      n: 1, winner: 'CT', reason: '', duration: 40, plant: null, frames: { t, players: { me: ct, mate } },
      kills: [{ t: 14, attacker: 'x', victim: 'mate', weapon: 'ak47', headshot: false, x: t1.x, y: t1.y, ax: 0, ay: 0 }], util: [], blind: [],
    } as unknown as DemoRound;
    const { holds, moves } = roundDecisions(e, r);
    const mine = holds.filter(h => h.player === 'me');
    expect(mine.map(h => h.place)).toEqual(['Short', 'Jungle']);
    expect(mine[0].ended).toBe('moved');
    const mv = moves.find(m => m.player === 'me')!;
    expect(mv).toMatchObject({ from: 'Short', to: 'Jungle', phase: 'early' });
    expect(mv.trigger).toBe('teammate died at Top Mid');
    expect(placeOf(e, e.map.callouts.find(c => c.name === 'Ticket')!.pos)).toBe('Ticket');
    expect(phaseOf(70, null)).toBe('late');
    expect(phaseOf(70, 50)).toBe('post-plant');
  });
});

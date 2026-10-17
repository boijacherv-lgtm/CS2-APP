import { describe, expect, it } from 'vitest';
import { radarToWorld } from '../coords';
import { getEngine } from '../../map/catalog';
import { analyzeRound } from '../analyst';
import type { DemoRound } from '../recap';

describe('analyst facts', () => {
  it('finds a trade, a missed trade chance, who peeked and who hit first', () => {
    const e = getEngine('de_mirage');
    const w = (name: string) => radarToWorld(e.map.callouts.find(c => c.name === name)!.pos, e.map.radar);
    const t = Array.from({ length: 81 }, (_, i) => i / 4); // 4 frames a second, 20 s
    const still = (p: { x: number; y: number }, side: 'CT' | 'T', deadAt = Infinity) => ({
      side, x: t.map(() => p.x), y: t.map(() => p.y), z: t.map(() => 0), yaw: t.map(() => 0),
      hp: t.map(s => (s < deadAt ? 100 : 0)), alive: t.map(s => (s < deadAt ? 1 : 0)),
    });
    // T1 runs from Top Mid to Mid and kills CT1 (holding Mid) at 10 s; CT2 at Mid trades T1 at 11 s; CT3 at Mid sees it all and does nothing
    const top = w('Top Mid'), mid = w('Mid');
    // runs from Top Mid (until 7 s) to the fight spot (at 10.5 s)
    const f = (s: number) => Math.max(0, Math.min(1, (s - 7) / 3.5));
    const t1 = { ...still(top, 'T', 11), x: t.map(s => top.x + (mid.x + 60 - top.x) * f(s)), y: t.map(s => top.y + (mid.y - top.y) * f(s)) };
    const r = {
      n: 2, winner: 'CT', reason: '', duration: 20, plant: null, util: [], blind: [], bomb: [],
      frames: { t, players: { T1: t1, CT1: still(mid, 'CT', 10), CT2: still({ x: mid.x - 80, y: mid.y }, 'CT'), CT3: still({ x: mid.x + 40, y: mid.y + 40 }, 'CT') } },
      kills: [
        { t: 10, attacker: 'T1', victim: 'CT1', weapon: 'ak47', headshot: true, x: mid.x, y: mid.y, ax: mid.x + 60, ay: mid.y },
        { t: 11, attacker: 'CT2', victim: 'T1', weapon: 'm4a1', headshot: false, x: mid.x + 60, y: mid.y, ax: mid.x - 80, ay: mid.y },
      ],
      hits: [{ t: 9.8, attacker: 'T1', victim: 'CT1', dmg: 100, head: true }],
    } as unknown as DemoRound;
    const a = analyzeRound(e, r);
    const death = a.trades.find(x => x.victim === 'CT1')!;
    expect(death.traded).toBe(true);
    expect(death.tradedBy).toBe('CT2');
    expect(death.tradeTime).toBe(1);
    expect(death.chances.find(c => c.mate === 'CT3')).toMatchObject({ traded: false });
    const duel = a.duels.find(d => d.victim === 'CT1')!;
    expect(duel).toMatchObject({ style: 'peeked', firstHit: 'killer', opening: true, headshot: true });
    expect(a.economy).toHaveLength(2);
  });
});

describe('learned win chance', () => {
  it('learns that more men and pending trades favour a side', async () => {
    const { fitWin, winFeatures } = await import('../winprob');
    const x: number[][] = [], y: number[] = [];
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000; i++) {
      const ct = 1 + Math.floor(rnd() * 5), t = 1 + Math.floor(rnd() * 5), trade = rnd() < 0.2 ? 1 : 0;
      const z = 0.8 * (ct - t) + 0.9 * trade;
      x.push(winFeatures({ ct, t, ctHp: ct * 100, tHp: t * 100, ctEquip: 4000, tEquip: 4000, planted: null, time: 30, ctAreas: 5, tAreas: 5, tradeCT: trade, tradeT: 0 }));
      y.push(rnd() < 1 / (1 + Math.exp(-z)) ? 1 : 0);
    }
    const m = fitWin(x, y);
    expect(m.coef[0] + m.coef[1] + m.coef[2]).toBeGreaterThan(0.3); // men (in all their forms)
    expect(m.coef[8]).toBeGreaterThan(0.3); // trades pending
    expect(m.logLoss).toBeLessThan(0.6);
  });
});

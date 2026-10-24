import { describe, expect, it } from 'vitest';
import { activeSmokes, smokeOpenAt, SMOKE_CLEAR } from '../grid';
import type { Utility } from '../types';

const PX = 5; // game units per radar px: the smoke is 144 / 5 ≈ 29 px across
const smoke: Utility = { id: 's', type: 'smoke', pos: { x: 100, y: 100 }, throwAt: 0, flight: 1, duration: 18 }; // up 1 → 19 s
const he = (t: number, x = 105): Utility => ({ id: `h${t}`, type: 'he', pos: { x, y: 100 }, throwAt: t - 1, flight: 1 });

describe('smoke blown open by an HE', () => {
  it('opens at the blast, stays open, then fills back in', () => {
    const util = [smoke, he(6)];
    expect(smokeOpenAt(smoke, util, 5.9, PX).open).toBe(0);
    expect(smokeOpenAt(smoke, util, 6 + SMOKE_CLEAR.open / 2, PX).open).toBe(1);
    const mid = smokeOpenAt(smoke, util, 6 + SMOKE_CLEAR.open + SMOKE_CLEAR.refill / 2, PX).open;
    expect(mid).toBeGreaterThan(0.4); expect(mid).toBeLessThan(0.6);
    expect(smokeOpenAt(smoke, util, 6 + SMOKE_CLEAR.open + SMOKE_CLEAR.refill + 0.1, PX).open).toBe(0);
  });

  it("doesn't block sight while it's open", () => {
    const util = [smoke, he(6)];
    expect(activeSmokes(util, 5, PX)).toHaveLength(1);
    expect(activeSmokes(util, 6.5, PX)).toHaveLength(0);
    expect(activeSmokes(util, 12, PX)).toHaveLength(1);
  });

  it('only for an HE inside the smoke, while the smoke is up', () => {
    expect(smokeOpenAt(smoke, [smoke, he(6, 200)], 6.5, PX).open).toBe(0); // went off far away
    expect(smokeOpenAt(smoke, [smoke, he(0.5)], 0.8, PX).open).toBe(0); // before the smoke bloomed
  });
});

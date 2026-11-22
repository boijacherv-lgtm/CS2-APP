import { describe, expect, it } from 'vitest';
import { features, HAS_WIN_MODEL, radiantChance, winChance, type WinInput } from '../winmodel';

const even: WinInput = { goldAdv: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], xpAdv: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], downs: [], roshan: [] };
const flip = (m: WinInput): WinInput => ({
  goldAdv: m.goldAdv.map(v => -v), xpAdv: m.xpAdv.map(v => -v),
  downs: m.downs.map(d => ({ ...d, uid: `${d.uid[0] === '0' ? 1 : 0}${d.uid.slice(1)}` })), roshan: m.roshan.map(r => ({ ...r, team: (1 - r.team) as 0 | 1 })),
});

describe("Dota 2's win chance", () => {
  it('reads every input as Radiant minus Dire', () => {
    const ahead: WinInput = { ...even, goldAdv: even.goldAdv.map((_, i) => i * 800), downs: [{ uid: '1_tower1_mid', t: 300 }, { uid: '1_range_rax_top', t: 500 }], roshan: [{ t: 480, team: 0 }] };
    const x = features(ahead, 540), y = features(flip(ahead), 540);
    x.forEach((v, i) => expect(v).toBeCloseTo(-y[i]));
    // the Aegis counts only for a while
    expect(features(ahead, 540)[10]).toBe(1);
    expect(features(ahead, 480 + 400)[10]).toBe(0);
  });
  it('a trained model favours the team ahead, and the chances of both sides add up to one', () => {
    expect(HAS_WIN_MODEL).toBe(true);
    const ahead: WinInput = { ...even, goldAdv: even.goldAdv.map((_, i) => i * 1000), xpAdv: even.xpAdv.map((_, i) => i * 1200) };
    expect(radiantChance(ahead, 600)).toBeGreaterThan(0.6);
    expect(radiantChance(flip(ahead), 600)).toBeLessThan(0.4);
    expect(winChance(ahead, 0, 600) + winChance(ahead, 1, 600)).toBeCloseTo(1);
    expect(Math.abs(radiantChance(even, 300) - 0.5)).toBeLessThan(0.08);
  });
});

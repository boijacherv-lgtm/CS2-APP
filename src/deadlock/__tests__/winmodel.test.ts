import { describe, expect, it } from 'vitest';
import { chance, type State } from '../winmodel';
import WM from '../generated/winmodel.json';
import { mirror as swapTeams, valueChance, VALUE_FEATURES, type ValueState } from '../valueNet';
import { valueStateAt } from '../winChance';
import type { Mlp } from '../../engine/mlp';
import type { DlMatch } from '../match';

const s: State = { t: 1200, souls: [90000, 80000], kills: [20, 14], guardians: [1, 2], walkers: [0, 1], base: [0, 0], midBoss: [1, 0] };
const mirror = (x: State): State => ({ t: x.t, souls: [x.souls[1], x.souls[0]], kills: [x.kills[1], x.kills[0]], guardians: [x.guardians[1], x.guardians[0]], walkers: [x.walkers[1], x.walkers[0]], base: [x.base[1], x.base[0]], midBoss: [x.midBoss[1], x.midBoss[0]] });

describe('the win-chance model', () => {
  it('is the same from either side (up to the small side bias)', () => {
    const w = (WM as { weights: number[] }).weights, noBias = [0, ...w.slice(1)];
    expect(chance(noBias, s) + chance(noBias, mirror(s))).toBeCloseTo(1, 6);
  });
  it('favours the team ahead in souls and objectives', () => {
    const w = (WM as { weights: number[] }).weights;
    expect(chance(w, s)).toBeGreaterThan(0.6);
    expect(chance(w, { ...s, souls: [80000, 80000], kills: [14, 14], guardians: [0, 0], walkers: [0, 0], midBoss: [0, 0] })).toBeGreaterThan(0.4);
  });
});

describe('the value network', () => {
  const team = (souls: number, alive: number) => ({ souls, richest: souls / 4, level: 20, kills: 10, alive, guardians: 1, walkers: 0, baseGuardians: 0, shrines: 0, patron: 0, midBoss: 0, recentBoss: 0 });
  const v: ValueState = { t: 1200, teams: [team(90000, 6), team(80000, 2)] };
  // a small random network: the symmetry holds whatever it learned
  const rand = (() => { let x = 7; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5; })();
  const grid = (r: number, c: number) => Array.from({ length: r }, () => Array.from({ length: c }, rand));
  const IN = VALUE_FEATURES.length + 1;
  const net: Mlp = { vocab: {}, emb: [[0]], w1: grid(8, IN), b1: new Array(8).fill(0), w2: grid(4, 8), b2: new Array(4).fill(0), w3: grid(2, 4), b3: [0, 0], mu: new Array(IN - 1).fill(0), sd: new Array(IN - 1).fill(1) };
  it("gives team 1 exactly 1 minus team 0's chance", () => {
    expect(valueChance(net, v) + valueChance(net, swapTeams(v))).toBeCloseTo(1, 9);
  });
  it('reads a moment: players alive, kills and objectives lost', () => {
    const m = {
      duration: 1500, players: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(slot => ({ slot, team: slot < 6 ? 0 : 1 })),
      stats: {}, midBoss: [{ t: 1100, team: 0 }],
      // two of team 1 died to team 0 at 1150 and are still dead at 1200; one of team 0 died long before
      deaths: [{ t: 1150, slot: 6, killer: 0, respawn: 60 }, { t: 1150, slot: 7, killer: 1, respawn: 60 }, { t: 600, slot: 2, killer: 9, respawn: 20 }],
      objectives: [{ team: 1, kind: 'guardian', destroyed: 900 }, { team: 1, kind: 'walker', destroyed: 1300 }, { team: 0, kind: 'guardian', destroyed: null }],
    } as unknown as DlMatch;
    const s = valueStateAt(m, null, 1200);
    expect(s.teams[0]).toMatchObject({ alive: 6, kills: 2, guardians: 0, midBoss: 1, recentBoss: 1 });
    expect(s.teams[1]).toMatchObject({ alive: 4, kills: 1, guardians: 1, walkers: 0 });
  });
});

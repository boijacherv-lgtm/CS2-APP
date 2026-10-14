import type { Econ, Phase, SiteId } from './types';

/** One squad of Ts moving through an ordered list of chokepoints. */
export interface StratGroup {
  route: string[]; // chokepoint ids, in order
  size: number;
  delay: number; // seconds of hold-back on top of raw travel time
  util: ('smoke' | 'flash')[];
}

export type StratKind = 'rush' | 'split' | 'execute';

export interface StrategyArchetype {
  id: string;
  label: string;
  kind: StratKind;
  target: SiteId;
  basePrior: number;
  groups: StratGroup[];
  counter: string;
}

const KIND_ECON: Record<StratKind, Record<Econ, number>> = {
  rush: { eco: 3, force: 1.6, half: 1.3, full: 0.7 },
  split: { eco: 0.5, force: 0.9, half: 1, full: 1.3 },
  execute: { eco: 0.25, force: 0.7, half: 0.9, full: 1.4 },
};
const KIND_PHASE: Record<StratKind, Record<Phase, number>> = {
  rush: { early: 1.4, late: 0.3 },
  split: { early: 0.9, late: 1.3 },
  execute: { early: 0.9, late: 1.3 },
};

export function prior(a: StrategyArchetype, enemyEcon: Econ, phase: Phase) {
  return a.basePrior * KIND_ECON[a.kind][enemyEcon] * KIND_PHASE[a.kind][phase];
}

export const MIRAGE_STRATS: StrategyArchetype[] = [
  {
    id: 'a_exec', label: 'A execute (Ramp + Palace + Connector)', kind: 'execute', target: 'A', basePrior: 1,
    groups: [
      { route: ['ramp'], size: 2, delay: 8, util: ['smoke', 'flash'] },
      { route: ['palace'], size: 2, delay: 8, util: ['smoke', 'flash'] },
      { route: ['top_mid', 'connector'], size: 1, delay: 6, util: ['smoke'] },
    ],
    counter: 'Keep a crossfire on Ramp/Palace and save a molotov for the plant.',
  },
  {
    id: 'a_split', label: 'A split (Palace + Ramp + Mid→Connector)', kind: 'split', target: 'A', basePrior: 0.9,
    groups: [
      { route: ['ramp'], size: 1, delay: 4, util: ['flash'] },
      { route: ['palace'], size: 2, delay: 6, util: ['flash'] },
      { route: ['top_mid', 'connector'], size: 2, delay: 3, util: ['smoke', 'flash'] },
    ],
    counter: 'Hold Connector from Jungle/Window so the mid half of the split is stopped.',
  },
  {
    id: 'b_rush', label: 'B Apps rush', kind: 'rush', target: 'B', basePrior: 0.6,
    groups: [{ route: ['apps'], size: 5, delay: 0, util: ['flash'] }],
    counter: 'Molotov Apps exit early and get two players on B fast.',
  },
  {
    id: 'b_exec', label: 'B execute (Apps + Short)', kind: 'execute', target: 'B', basePrior: 1,
    groups: [
      { route: ['apps'], size: 3, delay: 6, util: ['smoke', 'flash'] },
      { route: ['top_mid', 'short'], size: 2, delay: 8, util: ['smoke'] },
    ],
    counter: 'Put a Short player where they can fall back to Market and cross with B.',
  },
  {
    id: 'mid_b_split', label: 'Mid → B split (Short + Underpass + Apps)', kind: 'split', target: 'B', basePrior: 0.9,
    groups: [
      { route: ['top_mid', 'short'], size: 2, delay: 2, util: ['smoke', 'flash'] },
      { route: ['top_mid', 'underpass'], size: 1, delay: 4, util: [] },
      { route: ['apps'], size: 2, delay: 6, util: ['flash'] },
    ],
    counter: 'Contest Mid early (Window/Short) so B is not hit from two sides.',
  },
  {
    id: 'fast_cat', label: 'Fast Catwalk / Short take', kind: 'rush', target: 'B', basePrior: 0.6,
    groups: [
      { route: ['top_mid', 'short'], size: 3, delay: 0, util: ['flash'] },
      { route: ['apps'], size: 2, delay: 3, util: [] },
    ],
    counter: 'Hold Short from Window or smoke Top Mid early.',
  },
  {
    id: 'mid_a', label: 'Mid control → Connector A hit', kind: 'split', target: 'A', basePrior: 0.8,
    groups: [
      { route: ['top_mid', 'connector'], size: 3, delay: 2, util: ['smoke', 'flash'] },
      { route: ['ramp'], size: 2, delay: 6, util: ['flash'] },
    ],
    counter: 'A Jungle/Connector player plus a Window AWP denies the mid take.',
  },
  {
    id: 'a_rush', label: 'Palace / Ramp rush', kind: 'rush', target: 'A', basePrior: 0.6,
    groups: [
      { route: ['palace'], size: 3, delay: 0, util: ['flash'] },
      { route: ['ramp'], size: 2, delay: 0, util: [] },
    ],
    counter: 'Molotov Palace early; Ticket/Stairs crossfire on the exits.',
  },
];

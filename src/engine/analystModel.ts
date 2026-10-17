import type { Bench } from './analystBench';
import MODEL from './models/analyst.json';

/** The level-10 analyst benchmarks (tools/learn-analyst.ts → models/analyst.json): the map's when there are enough rounds, else all maps. */
const DATA = MODEL as unknown as { overall: Bench | null; maps: Record<string, Bench> };
export const analystBench = (map: string): Bench | null => {
  const m = DATA.maps?.[map];
  return m && m.rounds >= 100 ? m : DATA.overall;
};
/** Level-10 share of trade chances taken (for the "didn't trade" move), with a sensible default before training. */
export const proTradeConversion = (): number => DATA.overall?.trades.chanceConversion ?? 0.3;

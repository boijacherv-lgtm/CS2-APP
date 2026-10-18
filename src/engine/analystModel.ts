import type { Bench } from './analystBench';
import MODEL from './models/analyst.json';
import PRO from './models/analyst-pro.json';

/**
 * The analyst benchmarks (tools/learn-analyst.ts): level 10 (models/analyst.json) or pro (models/analyst-pro.json,
 * from HLTV demos: --name pro). The map's when there are enough rounds, else all maps.
 */
type Data = { overall: Bench | null; maps: Record<string, Bench> };
const DATA = MODEL as unknown as Data, PRO_DATA = PRO as unknown as Data;
export const proAnalystAvailable = !!PRO_DATA.overall;
export const analystBench = (map: string, level: 'lvl10' | 'pro' = 'lvl10'): Bench | null => {
  const d = level === 'pro' && PRO_DATA.overall ? PRO_DATA : DATA;
  const m = d.maps?.[map];
  return m && m.rounds >= 100 ? m : d.overall;
};
/** Level-10 share of trade chances taken (for the "didn't trade" move), with a sensible default before training. */
export const proTradeConversion = (): number => DATA.overall?.trades.chanceConversion ?? 0.3;

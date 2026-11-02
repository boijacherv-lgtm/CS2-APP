/**
 * What normal looks like, learned from everyone's recent public matches (tools/dl-learn.ts → generated/bench.json):
 * per position (by farm, Pos 1 = richest on the team) and per hero in a position, the average and spread of net
 * worth, last hits, kills, deaths, damage, healing and souls by source at 3, 6, 9, 12, 15, 20, 25 and 30 minutes.
 */
import BENCH from './generated/bench.json';
import { statAt, type DlMatch } from './match';
import type { Pos } from './positions';

type Metric = 'nw' | 'lh' | 'dn' | 'k' | 'd' | 'dmg' | 'heal' | 'lane' | 'camps' | 'kills' | 'urn' | 'boss';
const DATA = BENCH as unknown as { since: string; matches: number; marks: number[]; rows: Record<string, Record<string, Record<Metric, [number, number]>>> };
export const BENCH_SOURCE = { since: DATA.since, matches: DATA.matches };
export const BENCH_MARKS = DATA.marks;

/**
 * The average and spread of a number at a minute mark: for this hero in this position when there's enough of them,
 * else the hero in any position, else anyone in the position. Says which it used.
 */
export function benchAt(hero: number, pos: Pos | null, minute: number, metric: Metric): { mean: number; sd: number; of: 'hero+pos' | 'hero' | 'pos' } | null {
  const pick = (key: string, of: 'hero+pos' | 'hero' | 'pos') => { const r = DATA.rows[key]?.[minute]?.[metric]; return r ? { mean: r[0], sd: r[1], of } : null; };
  return (pos ? pick(`h${hero}p${pos}`, 'hero+pos') : null) ?? pick(`h${hero}`, 'hero') ?? (pos ? pick(`pos${pos}`, 'pos') : null);
}

/** A player's position in a match: their rank by net worth on their team at the end (as the benchmarks count it). */
export function matchPosition(m: DlMatch, slot: number): Pos | null {
  const me = m.players.find(p => p.slot === slot);
  if (!me) return null;
  const worth = (s: number) => statAt(m, s, m.duration)?.netWorth ?? 0;
  const team = m.players.filter(p => p.team === me.team).sort((a, b) => worth(b.slot) - worth(a.slot));
  const i = team.findIndex(p => p.slot === slot);
  return i >= 0 && i < 6 ? ((i + 1) as Pos) : null;
}

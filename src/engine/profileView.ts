import { habits, type HabitRow } from './habits';
import type { GoalId, ProfileMatch } from './profile';

/**
 * The profile's reading of your matches: the biggest leak (the habit that costs you most), your superpower (your best
 * habit against level 10) and the skill map (the 6 skills the CS2 page lists, each as a percentile against level 10).
 * Percentiles assume level-10 players spread normally around the coach model's baseline (its spread): a reading, not a
 * ranking of real players.
 */

/** The share of level-10 players below a gap of z spreads (the normal curve). */
export function percentile(z: number): number {
  // Abramowitz–Stegun erf, enough for whole percent
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.round(50 * (1 + Math.sign(z) * erf));
}

/** Each habit as the problem, in plain words. */
export const LEAK_TITLE: Record<string, string> = {
  untradedDeaths: 'Your deaths go untraded', isolatedDeaths: 'You die where nobody can trade you', openingDeaths: 'You give away the first kill',
  whiffs: 'You miss sprays you should hit', unusedUtil: 'You die with grenades in your pocket', wastedFlashes: 'Your flashes blind nobody',
  teamHarm: 'You hurt your own team', awpLost: 'You lose the AWP', lowHpFights: 'You take fights on low HP', adr: 'Your damage is low',
  kast: 'Too many rounds without impact', hs: 'Few of your kills are headshots', utilDamage: 'Your grenades do little damage',
  flashAssists: 'Your flashes rarely set up kills', trades: 'You don\'t trade your teammates', impact: 'You rarely swing rounds',
  loud: 'You run near enemies', react: 'You react late', aim: 'Your crosshair sits off the head', stopped: 'You shoot while moving',
};
/** Each habit as a strength. */
export const SUPER_TITLE: Record<string, string> = {
  untradedDeaths: 'Your deaths get traded', isolatedDeaths: 'You play with your team', openingDeaths: 'You survive the opening',
  whiffs: 'Your sprays land', unusedUtil: 'You use your grenades', wastedFlashes: 'Your flashes land', teamHarm: 'You never hurt your team',
  awpLost: 'You keep the AWP', lowHpFights: 'You hide when hurt', adr: 'High damage', kast: 'Useful every round', hs: 'Headshots',
  utilDamage: 'Grenade damage', flashAssists: 'Flashes that set up kills', trades: 'You trade your teammates', impact: 'You swing rounds',
  loud: 'Quiet moving', react: 'Fast reactions', aim: 'Crosshair on the head', stopped: 'Counter-strafing',
};

export interface Leak {
  row: HabitRow;
  title: string;
  /** Average win chance it costs a match (0–1), from the matches that have the number; null for older matches. */
  cost: number | null;
  /** The newest match with costly rounds of it, and those rounds. */
  clip: { match: ProfileMatch; rounds: number[] } | null;
}

const costOf = (ms: ProfileMatch[], id: GoalId) => {
  const known = ms.filter(m => m.leaks !== undefined);
  return known.length ? known.reduce((a, m) => a + (m.leaks?.[id]?.[0] ?? 0), 0) / known.length : null;
};

/** The habit that costs you most: by win chance lost where the matches have it, else the furthest below level 10. */
export function biggestLeak(ms: ProfileMatch[]): Leak | null {
  const h = habits(ms);
  if (!h) return null;
  const below = h.rows.filter(r => r.z < -0.1 && LEAK_TITLE[r.id]);
  if (!below.length) return null;
  const costed = below.map(r => ({ r, cost: costOf(ms, r.id as GoalId) }));
  const ranked = costed.some(x => (x.cost ?? 0) > 0)
    ? costed.filter(x => (x.cost ?? 0) > 0).sort((a, b) => b.cost! - a.cost!)
    : costed.sort((a, b) => a.r.z - b.r.z);
  const { r, cost } = ranked[0];
  const withRounds = [...ms].sort((a, b) => b.at - a.at).find(m => (m.leaks?.[r.id as GoalId]?.[1].length ?? 0) > 0);
  return { row: r, title: LEAK_TITLE[r.id], cost, clip: withRounds ? { match: withRounds, rounds: withRounds.leaks![r.id as GoalId]![1] } : null };
}

/** Your best habit against level 10, and the share of level-10 players you beat at it. */
export function superpower(ms: ProfileMatch[]): { row: HabitRow; title: string; better: number } | null {
  const h = habits(ms);
  // not losing an AWP you never bought isn't a strength
  const best = h?.rows.filter(r => r.z > 0.25 && r.id !== 'awpLost' && SUPER_TITLE[r.id]).sort((a, b) => b.z - a.z)[0];
  return best ? { row: best, title: SUPER_TITLE[best.id], better: percentile(best.z) } : null;
}

/** The skill map's 6 skills (the CS2 page's), and the habits each is read from. */
export const SKILLS: { name: string; ids: string[] }[] = [
  { name: 'Aim duels', ids: ['hs', 'whiffs', 'aim', 'stopped', 'react'] },
  { name: 'Trades', ids: ['trades', 'untradedDeaths'] },
  { name: 'Utility', ids: ['utilDamage', 'flashAssists', 'wastedFlashes', 'unusedUtil', 'teamHarm'] },
  { name: 'Positioning', ids: ['isolatedDeaths', 'openingDeaths', 'loud', 'lowHpFights'] },
  // Economy has no level-10 number yet, so it isn't on the map (nor on the CS2 page's grades); Clutches shows once you've played one
  { name: 'Clutches', ids: [] },
];
/** The skill map opens at this many matches. */
export const SKILL_MAP_FROM = 3;

export interface Skill {
  name: string;
  /** Percentile against level 10 (50 = a typical level-10 player); null when not measured. */
  pct: number | null;
  /** Your last 5 matches against the 5 before. */
  trend: 'up' | 'down' | 'flat' | null;
  rows: HabitRow[];
  /** Clutches only: played and won (no level-10 number for it yet). */
  clutch?: [number, number];
}

const meanZ = (rows: HabitRow[]) => (rows.length ? rows.reduce((a, r) => a + r.z, 0) / rows.length : null);

export function skillMap(ms: ProfileMatch[]): Skill[] | null {
  if (ms.length < SKILL_MAP_FROM) return null;
  const sorted = [...ms].sort((a, b) => b.at - a.at);
  const all = habits(sorted), last = habits(sorted.slice(0, 5)), prev = sorted.length >= 7 ? habits(sorted.slice(5, 10)) : null;
  if (!all) return null;
  return SKILLS.map((s): Skill => {
    if (!s.ids.length && s.name !== 'Clutches') return { name: s.name, pct: null, trend: null, rows: [] };
    if (s.name === 'Clutches') {
      const c = sorted.filter(m => m.clutch).reduce<[number, number]>((a, m) => [a[0] + m.clutch![0], a[1] + m.clutch![1]], [0, 0]);
      return { name: s.name, pct: null, trend: null, rows: [], clutch: c };
    }
    const pick = (h: ReturnType<typeof habits>) => h?.rows.filter(r => s.ids.includes(r.id)) ?? [];
    const rows = pick(all), z = meanZ(rows);
    const a = meanZ(pick(last)), b = meanZ(pick(prev));
    const trend: Skill['trend'] = a === null || b === null ? null : Math.abs(a - b) < 0.15 ? 'flat' : a > b ? 'up' : 'down';
    return { name: s.name, pct: z === null ? null : percentile(z), trend, rows: rows.sort((x, y) => x.z - y.z) };
  }).filter(s => !(s.name === 'Clutches' && !s.clutch?.[0]));
}

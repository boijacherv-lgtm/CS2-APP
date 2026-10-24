
/**
 * Your profile: every match you reviewed as yourself, summed up (no demo data, a few hundred bytes each), your goals
 * and your settings. Kept per Steam account by the Worker (worker/src/profile.ts) when you're logged in, otherwise in
 * this browser. This file has no heavy imports: the Worker uses it to check what it stores.
 */
// the coach's numbers, the mechanics and the grades, spelled out here (the same as coach.ts, level.ts and recap.ts,
// which a test checks) so the Worker can use this file without the coach's models
export const FEATURE_IDS = ['untradedDeaths', 'isolatedDeaths', 'openingDeaths', 'whiffs', 'unusedUtil', 'wastedFlashes', 'teamHarm',
  'awpLost', 'lowHpFights', 'adr', 'kast', 'hs', 'utilDamage', 'flashAssists', 'trades', 'impact'] as const;
export const MECH_IDS = ['react', 'aim', 'loud', 'stopped'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export type Features = Record<FeatureId, number>;
export type Mechanics = Record<(typeof MECH_IDS)[number], number | null>;
export type Letter = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ProfileMatch {
  /** The match's identity (map, rounds, kill times: see matchKey). */
  id: string;
  map: string;
  /** When it was played (the demo file's date), or else when it was reviewed (ms). */
  at: number;
  rounds: number;
  result: 'win' | 'loss' | 'tie';
  /** Rounds won: yours first. */
  score: [number, number];
  kills: number; deaths: number; adr: number; kast: number; hs: number;
  /** Win chance added per round, % points. */
  impact: number;
  /** Grades: among the lobby, and on the level-10 → pro ladder. */
  lobby: Letter; level: Letter | null;
  gameRating: number | null; rank: number | null;
  engine: number | null;
  /** Your in-game name in that match (for the share card when you're not logged in). */
  name?: string;
  features: Features;
  mech: Mechanics;
}

export type GoalId = FeatureId | keyof Mechanics;
export interface Goal { id: GoalId; since: number }
export interface ProfilePrefs {
  /** Friends can look you up and compare (your last matches' numbers, name and avatar). Off by default. */
  public: boolean;
  /** What the coach compares you with by default. */
  compare: 'lvl10' | 'pro';
}
export interface ProfileData {
  matches: ProfileMatch[];
  goals: Goal[];
  prefs: ProfilePrefs;
  /** Asked to hear when Pro launches. */
  notifyPro: boolean;
  /** Games they asked to hear about when they go live ("deadlock"). */
  notifyGames: string[];
}

/** Pro is free for everyone while there are no payments: the limits below apply once it launches. */
export const PRO_EARLY_ACCESS = true;
/** Matches the profile shows on the free plan, and keeps at most. */
export const FREE_HISTORY = 5, MAX_HISTORY = 100;
export const MAX_GOALS = 3;
export const hasPro = () => PRO_EARLY_ACCESS;

export const EMPTY_PROFILE: ProfileData = { matches: [], goals: [], prefs: { public: false, compare: 'lvl10' }, notifyPro: false, notifyGames: [] };

/** A list of game ids ("deadlock"), cleaned: short lowercase ids, no repeats, at most 10. */
export function cleanNotifyGames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((g): g is string => typeof g === 'string' && /^[a-z0-9]{2,12}$/.test(g)))].slice(0, 10);
}

const LETTERS: Letter[] = ['S+', 'S', 'A', 'B', 'C', 'D', 'F'];

/** A match's identity: the map, the rounds and when the first rounds' kills happened (the same for every player in it). */
export function matchKey(map: string, rounds: { kills: { t: number }[] }[]) {
  return `${map}|${rounds.length}|${rounds.slice(0, 3).map(r => r.kills.map(k => k.t.toFixed(1)).join(',')).join(';')}`;
}

// ---- checking what comes in (the Worker stores only this) ----------------------------------------------------
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, +v.toFixed(4))) : null);
const int = (v: unknown, lo: number, hi: number) => { const n = num(v, lo, hi); return n === null ? null : Math.round(n); };
const letter = (v: unknown) => (LETTERS.includes(v as Letter) ? (v as Letter) : null);

/** A match summary as sent by a browser, or null when it isn't one. Every number is clamped, strings are cut. */
export function cleanMatch(raw: unknown): ProfileMatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.slice(0, 300) : '';
  const map = typeof r.map === 'string' && /^de_[a-z0-9_]{2,30}$/.test(r.map) ? r.map : '';
  const result = r.result === 'win' || r.result === 'loss' || r.result === 'tie' ? r.result : null;
  const score = Array.isArray(r.score) && r.score.length === 2 ? [int(r.score[0], 0, 99), int(r.score[1], 0, 99)] : null;
  const lobby = letter(r.lobby);
  const f = r.features && typeof r.features === 'object' ? (r.features as Record<string, unknown>) : null;
  const m = r.mech && typeof r.mech === 'object' ? (r.mech as Record<string, unknown>) : {};
  if (!id || !map || !result || !score || score[0] === null || score[1] === null || !lobby || !f) return null;
  const features = {} as Features;
  for (const k of FEATURE_IDS) { const v = num(f[k], -1000, 1000); if (v === null) return null; features[k] = v; }
  const mech = {} as Mechanics;
  for (const k of MECH_IDS) mech[k] = m[k] === null ? null : num(m[k], -1000, 1000);
  const out: ProfileMatch = {
    id, map, at: int(r.at, 0, 4e12) ?? 0, rounds: int(r.rounds, 1, 99) ?? 1, result, score: [score[0], score[1]],
    kills: int(r.kills, 0, 200) ?? 0, deaths: int(r.deaths, 0, 200) ?? 0, adr: num(r.adr, 0, 1000) ?? 0, kast: num(r.kast, 0, 100) ?? 0,
    hs: num(r.hs, 0, 100) ?? 0, impact: num(r.impact, -100, 100) ?? 0, lobby, level: letter(r.level),
    gameRating: int(r.gameRating, 0, 60000), rank: int(r.rank, 0, 60000), engine: num(r.engine, 0, 100), features, mech,
    ...(typeof r.name === 'string' && r.name.trim() ? { name: r.name.trim().slice(0, 40) } : {}),
  };
  return out;
}
export function cleanGoals(raw: unknown): Goal[] {
  if (!Array.isArray(raw)) return [];
  const ok = new Set<string>([...FEATURE_IDS, ...MECH_IDS]);
  const seen = new Set<string>();
  return raw.flatMap(g => {
    const id = typeof g === 'string' ? g : g && typeof g === 'object' ? (g as Goal).id : null;
    if (!id || !ok.has(id) || seen.has(id)) return [];
    seen.add(id);
    const since = g && typeof g === 'object' ? int((g as Goal).since, 0, 4e12) : null;
    return [{ id: id as GoalId, since: since ?? Date.now() }];
  }).slice(0, MAX_GOALS);
}
export function cleanPrefs(raw: unknown, was: ProfilePrefs = EMPTY_PROFILE.prefs): ProfilePrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    public: typeof r.public === 'boolean' ? r.public : was.public,
    compare: r.compare === 'pro' || r.compare === 'lvl10' ? r.compare : was.compare,
  };
}
/** Adds or replaces a match, newest first, keeping at most MAX_HISTORY. */
export function withMatch(list: ProfileMatch[], m: ProfileMatch): ProfileMatch[] {
  return [m, ...list.filter(x => x.id !== m.id)].sort((a, b) => b.at - a.at).slice(0, MAX_HISTORY);
}

// ---- what the profile page shows ------------------------------------------------------------------------------
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface Averages {
  matches: number; wins: number; winRate: number; kd: number | null; adr: number; kast: number; hs: number; impact: number; engine: number | null;
  /** The in-game Premier rating at the newest of these matches, and how far it moved since the oldest (both need it in the demo). */
  premier: number | null; premierMoved: number | null;
}
/** A Premier rating as the game shows it (competitive skill groups and missing ratings don't count). */
export const premierOf = (m: Pick<ProfileMatch, 'rank'>) => (m.rank !== null && m.rank >= 1000 ? m.rank : null);
export function averages(list: ProfileMatch[]): Averages | null {
  if (!list.length) return null;
  const deaths = list.reduce((a, m) => a + m.deaths, 0);
  const wins = list.filter(m => m.result === 'win').length;
  return {
    matches: list.length, wins, winRate: wins / list.length,
    kd: deaths ? list.reduce((a, m) => a + m.kills, 0) / deaths : null,
    adr: avg(list.map(m => m.adr))!, kast: avg(list.map(m => m.kast))!, hs: avg(list.map(m => m.hs))!, impact: avg(list.map(m => m.impact))!,
    ...(() => {
      // newest first: the first rating is the latest, the last one where these matches started
      const rs = [...list].sort((a, b) => b.at - a.at).flatMap(m => (premierOf(m) !== null ? [premierOf(m)!] : []));
      return { premier: rs[0] ?? null, premierMoved: rs.length >= 2 ? rs[0] - rs[rs.length - 1] : null };
    })(),
    engine: avg(list.flatMap(m => (m.engine !== null ? [m.engine] : []))),
  };
}

export interface MapStat { map: string; matches: number; wins: number; winRate: number; adr: number; kd: number | null; best: Letter | null }
/** Per map, most played first. */
export function mapStats(list: ProfileMatch[]): MapStat[] {
  const by = new Map<string, ProfileMatch[]>();
  for (const m of list) by.set(m.map, [...(by.get(m.map) ?? []), m]);
  return [...by].map(([map, ms]) => {
    const a = averages(ms)!;
    const best = ms.map(m => m.level ?? m.lobby).sort((x, y) => LETTERS.indexOf(x) - LETTERS.indexOf(y))[0] ?? null;
    return { map, matches: ms.length, wins: a.wins, winRate: a.winRate, adr: a.adr, kd: a.kd, best };
  }).sort((a, b) => b.matches - a.matches || b.winRate - a.winRate);
}

/** A goal's value in each match, oldest first (null where it wasn't measured). */
export function goalSeries(list: ProfileMatch[], id: GoalId): (number | null)[] {
  const isMech = (MECH_IDS as readonly string[]).includes(id);
  return [...list].sort((a, b) => a.at - b.at).map(m => (isMech ? m.mech[id as keyof Mechanics] : m.features[id as FeatureId]) ?? null);
}

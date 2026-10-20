import { BETTER, coachFeatures, FEATURE_LABEL, modelFor, type FeatureId, type Features } from './coach';
import { COACH_MODEL, PRO_MODEL } from './coachModels';
import { LEVEL_MODEL, mechanicsOf, type Mechanics } from './level';
import type { AnalystRound } from './analyst';
import type { MatchReport, PlayerReport } from './match';
import { matchKey, type GoalId, type ProfileMatch } from './profile';
import type { DemoData } from './recap';

/**
 * Your habits across matches: each match you open (as yourself) is summed up and kept on your profile; together they
 * say what you do differently from level-10 players and pros, match after match. One match is noise; several are a
 * habit. The coach's numbers and the mechanics (sound, reaction, crosshair, counter-strafing) both count.
 */
export interface MatchSummary {
  id: string; map: string; at: number; rounds: number;
  features: Features; mech: Mechanics; engine: number | null; level: string | null;
}
export function summarizeMatch(id: string, map: string, p: PlayerReport, analyst: (AnalystRound | undefined)[]): MatchSummary {
  const m = mechanicsOf(analyst, p.id);
  return { id, map, at: Date.now(), rounds: p.played, features: coachFeatures(p), mech: { react: m.react, aim: m.aim, loud: m.loud, stopped: m.stopped },
    engine: p.engineAccuracy, level: p.level?.letter ?? null };
}

/** The match for your profile: the habit numbers plus the result and the scoreboard line. */
export function profileMatchOf(data: DemoData, view: MatchReport, p: PlayerReport, analyst: (AnalystRound | undefined)[]): ProfileMatch {
  const s = summarizeMatch(matchKey(data.map, data.rounds), data.map, p, analyst);
  const us = view.score[p.team], them = view.score[p.team === 0 ? 1 : 0];
  return {
    ...s, level: p.level?.letter ?? null, result: us > them ? 'win' : us < them ? 'loss' : 'tie', score: [us, them],
    kills: p.kills, deaths: p.deaths, adr: +p.adr.toFixed(1), kast: +p.kast.toFixed(1), hs: +p.hs.toFixed(1), impact: +p.impactPerRound.toFixed(2),
    lobby: p.letter, gameRating: p.gameRating, rank: p.rank, name: p.name,
  };
}

export interface HabitRow {
  id: string; label: string;
  you: number; lvl10: number; pro: number | null;
  /** Your gap from level 10 in their spreads (+ = better than level 10). */
  z: number;
  fmt: (v: number) => string;
  tip: string;
}
const PCT = (v: number) => `${Math.round(v * 100)}%`;
const FMT: Partial<Record<FeatureId, (v: number) => string>> = {
  adr: v => v.toFixed(0), kast: v => `${v.toFixed(0)}%`, hs: v => `${v.toFixed(0)}%`, utilDamage: v => v.toFixed(1), impact: v => v.toFixed(1),
};
/** What to do about each one, in a line. */
const TIP: Record<string, string> = {
  untradedDeaths: 'Fight where a teammate can trade you: push with someone a step behind, or from a spot a teammate sees.',
  isolatedDeaths: 'When you push alone and it fails, nobody can trade. Keep the aggression, but take it where a teammate can follow.',
  openingDeaths: 'The first death of the round costs most: take the first fight with a flash, or let the entry go first.',
  whiffs: 'Sprays that miss: stop before shooting, burst at range, and reset instead of spraying on the move.',
  unusedUtil: 'You die with grenades in your pocket: throw something into a fight you\'re about to take.',
  wastedFlashes: 'Flashes that blind nobody: pop them over the angle you\'re about to peek, for yourself or called for a teammate.',
  teamHarm: 'Your utility hurts teammates: call your flashes, and throw them where your team isn\'t looking.',
  awpLost: 'You lose the AWP often: after a shot, move back instead of re-peeking the same angle.',
  lowHpFights: 'You take fights already hurt: reset, wait for the trade, or play for information.',
  adr: 'Damage per round: get into more fights that matter, with utility first.',
  kast: 'Rounds where you did something (kill, assist, survive, traded): stay alive and tradeable.',
  hs: 'Headshots: keep your crosshair at head height while moving, and stop before the shot.',
  utilDamage: 'Grenade damage: HEs and mollies on spots enemies hold or cross (they also soften fights).',
  flashAssists: 'Flashes that win fights: flash for a teammate\'s peek, not only for your own.',
  trades: 'Trading teammates: stay close enough to swing when one dies; the window is about 2 s.',
  impact: 'Win chance you add per round: plays that change rounds, not just kills.',
  loud: 'You run near enemies: shift-walk within about 20 m of where an enemy could be. They hear you coming.',
  react: 'Reaction: hold angles you expect them on, crosshair already there, so you react instead of searching.',
  aim: 'Crosshair placement: pre-aim where heads appear (corners, boxes) while you move.',
  stopped: 'Counter-strafe: stop (tap the opposite key) before the first shot.',
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Your averages across the matches, against level 10 and pros, worst first. */
export function habits(list: MatchSummary[]): { rows: HabitRow[]; work: HabitRow[]; good: HabitRow[]; matches: number } | null {
  if (list.length < 2) return null;
  const L = modelFor(COACH_MODEL, 'Rifler').features, P = PRO_MODEL ? modelFor(PRO_MODEL, 'Rifler').features : null;
  const rows: HabitRow[] = [];
  for (const id of Object.keys(L) as FeatureId[]) {
    const you = mean(list.map(m => m.features[id]).filter(Number.isFinite));
    const m = L[id];
    if (you === null || !m || m.spread <= 0) continue;
    const z = ((you - m.baseline) / m.spread) * (BETTER[id] === 'low' ? -1 : 1);
    rows.push({ id, label: FEATURE_LABEL[id], you, lvl10: m.baseline, pro: P?.[id]?.baseline ?? null, z, fmt: FMT[id] ?? PCT, tip: TIP[id] });
  }
  if (LEVEL_MODEL) {
    const M = LEVEL_MODEL.mech;
    const mech: [keyof Mechanics, string, (v: number) => string, 1 | -1][] = [
      ['loud', 'Running near enemies', PCT, -1], ['react', 'Reaction time', v => `${(v * 1000).toFixed(0)} ms`, -1],
      ['aim', 'Crosshair off the head', v => `${v.toFixed(1)}°`, -1], ['stopped', 'Counter-strafed shots', PCT, 1],
    ];
    for (const [k, label, fmt, sign] of mech) {
      const you = mean(list.map(m => m.mech[k]).filter((v): v is number => v != null));
      if (you === null || !M[k]?.sd) continue;
      rows.push({ id: k, label, you, lvl10: M[k].mean, pro: null, z: (sign * (you - M[k].mean)) / M[k].sd, fmt, tip: TIP[k] });
    }
  }
  const work = rows.filter(r => r.z <= -0.25).sort((a, b) => a.z - b.z).slice(0, 3);
  const good = rows.filter(r => r.z >= 0.4).sort((a, b) => b.z - a.z).slice(0, 3);
  return { rows: rows.sort((a, b) => a.z - b.z), work, good, matches: list.length };
}

/** One habit as a goal: its name, how to show it, the level-10 value and which way is better. */
export interface GoalInfo { id: GoalId; label: string; fmt: (v: number) => string; lvl10: number | null; higherBetter: boolean; tip: string }
const MECH_GOAL: Record<keyof Mechanics, { label: string; fmt: (v: number) => string; higherBetter: boolean }> = {
  loud: { label: 'Running near enemies', fmt: PCT, higherBetter: false },
  react: { label: 'Reaction time', fmt: v => `${(v * 1000).toFixed(0)} ms`, higherBetter: false },
  aim: { label: 'Crosshair off the head', fmt: v => `${v.toFixed(1)}°`, higherBetter: false },
  stopped: { label: 'Counter-strafed shots', fmt: PCT, higherBetter: true },
};
export function goalInfo(id: GoalId): GoalInfo {
  if (id in MECH_GOAL) {
    const k = id as keyof Mechanics, g = MECH_GOAL[k];
    return { id, ...g, lvl10: LEVEL_MODEL?.mech[k]?.mean ?? null, tip: TIP[k] };
  }
  const f = id as FeatureId;
  return { id, label: FEATURE_LABEL[f], fmt: FMT[f] ?? PCT, lvl10: modelFor(COACH_MODEL, 'Rifler').features[f]?.baseline ?? null, higherBetter: BETTER[f] !== 'low', tip: TIP[f] };
}
/** Every habit that can be a goal, in a sensible order. */
export const GOAL_CHOICES: GoalId[] = ['isolatedDeaths', 'untradedDeaths', 'openingDeaths', 'loud', 'stopped', 'aim', 'react', 'unusedUtil', 'wastedFlashes',
  'teamHarm', 'whiffs', 'lowHpFights', 'trades', 'utilDamage', 'flashAssists', 'adr', 'kast', 'hs', 'impact', 'awpLost'];

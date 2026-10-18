import type { AnalystRound } from './analyst';
import { coachFeatures, zAgainst } from './coach';
import { COACH_MODEL } from './coachModels';
import type { Letter } from './recap';
import type { PlayerReport } from './match';
import MODEL from './models/level.json';

/**
 * One grade on a ladder from FACEIT level 10 to pro, from two parts:
 *   performance  the coach's numbers against level-10 players (trades, deaths alone, ADR, KAST, utility, impact…)
 *   mechanics    reaction time, crosshair placement when an enemy appears, staying quiet near enemies, and
 *                counter-strafing: what separates a pro's game from a level-10's (results and decisions look the same
 *                at both levels, because each is measured against opponents of their own level)
 * Each part is scaled by how much level-10 games vary (tools/learn-level.ts → models/level.json); the grade's B is a
 * typical level-10 game and its S a typical pro game, measured the same way.
 */
export interface Mechanics { react: number | null; aim: number | null; loud: number | null; stopped: number | null }
type Stat = { mean: number; sd: number };
interface LevelModel {
  mech: Record<keyof Mechanics, Stat>;
  /** The mechanics index and the performance z for level-10 and pro games: medians and level-10 spread. */
  index: { lvl10: number; pro: number; sd: number };
  perf: { lvl10: number; pro: number; sd: number };
  games: { lvl10: number; pro: number };
}
const M = MODEL as unknown as Partial<LevelModel>;
export const LEVEL_MODEL: LevelModel | null = M.index && M.perf && M.mech ? (M as LevelModel) : null;

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
/** A player's mechanics over a match's rounds (the analyst facts of each round). */
export function mechanicsOf(rounds: (AnalystRound | undefined)[], player: string): Mechanics & { fights: number; near: number } {
  const react: number[] = [], aim: number[] = [];
  let loud = 0, near = 0, stopped = 0, bursts = 0;
  for (const r of rounds) {
    if (!r) continue;
    for (const d of r.duels) {
      if (!d.detail) continue;
      if (d.killer === player) { if (d.detail.kReact != null) react.push(d.detail.kReact); if (d.detail.kAim != null) aim.push(d.detail.kAim); }
      if (d.victim === player) { if (d.detail.vReact != null) react.push(d.detail.vReact); if (d.detail.vAim != null) aim.push(d.detail.vAim); }
    }
    const m = r.micro?.[player];
    if (m) { loud += m.loudSamples; near += m.nearSamples; stopped += m.stoppedBursts; bursts += m.bursts; }
  }
  return {
    react: react.length >= 3 ? median(react) : null, aim: aim.length >= 3 ? median(aim) : null,
    loud: near >= 30 ? loud / near : null, stopped: bursts >= 10 ? stopped / bursts : null,
    fights: react.length, near,
  };
}
const SIGN: Record<keyof Mechanics, 1 | -1> = { react: -1, aim: -1, loud: -1, stopped: 1 };
/** The mechanics index: each one in level-10 spreads (+ = better), averaged over the ones measured. */
export function mechanicsIndex(m: Mechanics, model: Pick<LevelModel, 'mech'>): number | null {
  const zs = (Object.keys(SIGN) as (keyof Mechanics)[]).flatMap(k => {
    const v = m[k], s = model.mech[k];
    return v == null || !s?.sd ? [] : [Math.max(-3, Math.min(3, (SIGN[k] * (v - s.mean)) / s.sd))];
  });
  return zs.length >= 2 ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
}

export interface LevelGrade {
  letter: Letter;
  /** On the ladder: 0 = a typical level-10 game, `proAt` = a typical pro game. */
  score: number; proAt: number;
  perf: number; mech: number | null;
}
/** The one grade for a player's match. */
export function levelGrade(p: PlayerReport, rounds: (AnalystRound | undefined)[]): LevelGrade | null {
  if (!LEVEL_MODEL || !p.played) return null;
  const L = LEVEL_MODEL;
  const perf = (zAgainst(coachFeatures(p), COACH_MODEL, p.roles[0]?.role ?? 'Rifler') - L.perf.lvl10) / L.perf.sd;
  const idx = mechanicsIndex(mechanicsOf(rounds, p.id), L);
  const mech = idx === null ? null : (idx - L.index.lvl10) / L.index.sd;
  // both parts in level-10 spreads; without mechanics (older demos), performance alone
  const score = mech === null ? perf : (perf + mech) / 2;
  const proAt = Math.max(0.15, mech === null ? (L.perf.pro - L.perf.lvl10) / L.perf.sd : ((L.perf.pro - L.perf.lvl10) / L.perf.sd + (L.index.pro - L.index.lvl10) / L.index.sd) / 2);
  // steps of half the level-10 → pro gap; S+ is clearly beyond a typical pro game, D/F clearly below level 10
  const d = proAt / 2;
  const letter: Letter = score >= 2 * proAt ? 'S+' : score >= proAt ? 'S' : score >= d ? 'A' : score >= -d ? 'B' : score >= -2 * d ? 'C' : score >= -4 * d ? 'D' : 'F';
  return { letter, score: +score.toFixed(3), proAt: +proAt.toFixed(3), perf: +perf.toFixed(3), mech: mech === null ? null : +mech.toFixed(3) };
}

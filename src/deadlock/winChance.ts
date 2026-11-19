/**
 * Win chance in a Deadlock match, from the coach's model (trained by tools/dl-train.ts on high-rank matches since the
 * patch): the value network (valueNet.ts) when it beat the simple model (winmodel.ts) on matches neither saw, else the
 * simple one. Both read the same moment: each team's souls (from the demo or between the match's snapshots), levels,
 * kills, players alive, objectives lost and Mid Bosses.
 */
import WM from './generated/winmodel.json';
import type { Mlp } from '../engine/mlp';
import type { DlDemo } from './demo';
import type { DlTeam } from './data';
import { worthAt } from './grade';
import { statAt, type DlMatch } from './match';
import { chance, type State } from './winmodel';
import { simpleState, valueChance, type TeamState, type ValueState } from './valueNet';

export const WIN_MODEL = WM as { since: string; patch: string | null; minBadge: number; matches: number; weights: number[]; kind?: 'simple' | 'network'; net?: Mlp;
  test: { accuracy: number; matches: number } };

/** A Mid Boss counts as recent this long (s): the Rejuvenator's push. */
const RECENT_BOSS = 180;
/** Everything both models read at time t, each team as it is. */
export function valueStateAt(m: DlMatch, demo: DlDemo | null, t: number): ValueState {
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  const one = (team: DlTeam): TeamState => {
    const mine = m.players.filter(p => p.team === team);
    const worth = mine.map(p => worthAt(m, demo, p.slot, t));
    const lost = (kinds: string[]) => m.objectives.filter(o => o.team === team && o.destroyed !== null && o.destroyed > 0 && o.destroyed <= t && kinds.includes(o.kind)).length;
    const bosses = m.midBoss.filter(b => b.team === team && b.t <= t);
    return {
      souls: worth.reduce((a, v) => a + v, 0), richest: Math.max(0, ...worth),
      level: mine.length ? mine.reduce((a, p) => a + (statAt(m, p.slot, t)?.level ?? 1), 0) / mine.length : 0,
      kills: m.deaths.filter(d => d.t <= t && d.killer !== null && teamOf.get(d.killer) === team && teamOf.get(d.slot) !== team).length,
      alive: mine.filter(p => !m.deaths.some(d => d.slot === p.slot && t >= d.t && t < d.t + d.respawn)).length,
      guardians: lost(['guardian']), walkers: lost(['walker']), baseGuardians: lost(['base guardian']), shrines: lost(['shrine']),
      patron: lost(['titan']) > 0 ? 1 : 0, midBoss: bosses.length, recentBoss: bosses.some(b => t - b.t < RECENT_BOSS) ? 1 : 0,
    };
  };
  return { t, teams: [one(0), one(1)] };
}

/** The simple model's state at time t (team 0's side). */
export function stateAt(m: DlMatch, demo: DlDemo | null, t: number): State {
  return simpleState(valueStateAt(m, demo, t));
}

/** Team 0's chance to win from a moment (real, or one the search imagines), with the model that shipped. */
export function stateChance(vs: ValueState) {
  return WIN_MODEL.kind === 'network' && WIN_MODEL.net ? valueChance(WIN_MODEL.net, vs) : chance(WIN_MODEL.weights, simpleState(vs));
}

/** A team's chance to win at time t (0–1). */
export function winChance(m: DlMatch, demo: DlDemo | null, t: number, team: DlTeam) {
  const p0 = stateChance(valueStateAt(m, demo, t));
  return team === 0 ? p0 : 1 - p0;
}

/** Team 0's chance every `step` seconds. */
export function winCurve(m: DlMatch, demo: DlDemo | null, step = 15) {
  const out: { t: number; p: number }[] = [];
  for (let t = 0; t <= m.duration; t += step) out.push({ t, p: winChance(m, demo, t, 0) });
  return out;
}

/** How a team's chance moved around a moment: just before it, and `after` seconds later (what it led to). */
export function swingAt(m: DlMatch, demo: DlDemo | null, t: number, team: DlTeam, after = 30) {
  const before = winChance(m, demo, Math.max(0, t - 1), team), then = winChance(m, demo, Math.min(m.duration, t + after), team);
  return { before, after: then, swing: then - before };
}

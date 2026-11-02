/**
 * Win chance in a Deadlock match, from the coach's model (winmodel.ts, trained by tools/dl-train.ts on high-rank
 * matches since the patch): the game state at any moment (souls from the demo or between the match's snapshots,
 * kills, objectives lost, Mid Bosses) → each team's chance to win.
 */
import WM from './generated/winmodel.json';
import type { DlDemo } from './demo';
import type { DlTeam } from './data';
import { worthAt } from './grade';
import type { DlMatch } from './match';
import { chance, type State } from './winmodel';

export const WIN_MODEL = WM as { since: string; patch: string | null; minBadge: number; matches: number; weights: number[]; test: { accuracy: number; matches: number } };

/** The state at time t (team 0's side). */
export function stateAt(m: DlMatch, demo: DlDemo | null, t: number): State {
  const souls: [number, number] = [0, 0], kills: [number, number] = [0, 0];
  for (const p of m.players) souls[p.team] += worthAt(m, demo, p.slot, t);
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  for (const d of m.deaths) {
    const k = d.killer !== null ? teamOf.get(d.killer) : undefined, v = teamOf.get(d.slot);
    if (d.t <= t && k !== undefined && k !== v) kills[k]++;
  }
  const lost = (team: DlTeam, kinds: string[]) => m.objectives.filter(o => o.team === team && o.destroyed !== null && o.destroyed <= t && kinds.includes(o.kind)).length;
  const pair = (kinds: string[]): [number, number] => [lost(0, kinds), lost(1, kinds)];
  return {
    t, souls, kills, guardians: pair(['guardian']), walkers: pair(['walker']), base: pair(['base guardian', 'shrine']),
    midBoss: [m.midBoss.filter(b => b.team === 0 && b.t <= t).length, m.midBoss.filter(b => b.team === 1 && b.t <= t).length],
  };
}

/** A team's chance to win at time t (0–1). */
export function winChance(m: DlMatch, demo: DlDemo | null, t: number, team: DlTeam) {
  const p0 = chance(WIN_MODEL.weights, stateAt(m, demo, t));
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

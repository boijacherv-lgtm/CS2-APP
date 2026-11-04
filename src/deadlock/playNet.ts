/**
 * The Deadlock play network: what a good player (Phantom and up) in your position does at a moment, like a chess
 * engine's list of candidate moves. Six actions, judged by what players really did over the next 20 s (actionAt): fight,
 * push an objective, farm a camp, play a lane, go to base, or move (rotate). A small neural network (src/engine/mlp.ts)
 * reads the moment as the player has it (where they are, health, souls, allies and enemies near, what's standing, the
 * score) and gives each action a chance. Trained by tools/dl-play.ts; the 2-step search will try its top actions.
 *
 * Everything is turned so the player's own base is at the bottom (the map is the same turned 180°), and it reads the
 * match data (heroes once a second), so a match with or without a demo is read the same.
 * The enemies near are where they really were, not only the ones the player could see: a known limit for now.
 */
import { DL_MAP, objectiveSpot, type DlTeam } from './data';
import { worthAt } from './grade';
import { playerAt, statAt, type DlMatch } from './match';
import { mlpPredict, type Mlp } from '../engine/mlp';

export const ACTIONS = ['fight', 'objective', 'farm', 'lane', 'base', 'move'] as const;
export type Action = (typeof ACTIONS)[number];
export const ACTION_LABEL: Record<Action, string> = { fight: 'Fight', objective: 'Objective', farm: 'Farm', lane: 'Lane', base: 'Base', move: 'Move' };

/** How far ahead an action is judged (s), and the grid the spot is learned on. */
export const WINDOW = 20;
const GRID = 12;
const NEAR = 0.08;

const turn = (team: DlTeam, p: { x: number; y: number }) => (team === 0 ? { x: p.x, y: p.y } : { x: 1 - p.x, y: 1 - p.y });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const u = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
}
const laneDist = (p: { x: number; y: number }) => {
  let best = 1;
  for (const l of DL_MAP.lanes) for (let i = 1; i < l.pts.length; i++) best = Math.min(best, segDist(p, l.pts[i - 1], l.pts[i]));
  return best;
};
const campDist = (p: { x: number; y: number }) => Math.min(1, ...DL_MAP.camps.map(c => dist(p, c)));
/** The other team's objectives still standing at t, on the map. */
const standing = (m: DlMatch, team: DlTeam, t: number) => m.objectives
  .filter(o => o.team === team && (o.destroyed === null || o.destroyed > t))
  .map(o => objectiveSpot(team, o.id)).filter((s): s is { x: number; y: number } => !!s);

/** The moment as the play network reads it: numbers, and the spot (a cell of the turned map) it learns on its own. */
export function playInput(m: DlMatch, slot: number, t: number): { f: number[]; spot: string } | null {
  const me = m.players.find(p => p.slot === slot), at = playerAt(m, slot, t);
  if (!me || !at) return null;
  const team = me.team, foe = (1 - team) as DlTeam;
  const pos = (s: number) => playerAt(m, s, t);
  const allies = m.players.filter(p => p.team === team && p.slot !== slot).map(p => pos(p.slot)).filter(Boolean) as { x: number; y: number }[];
  const enemies = m.players.filter(p => p.team === foe).map(p => pos(p.slot)).filter(Boolean) as { x: number; y: number }[];
  const mine = m.players.filter(p => p.team === team), worth = mine.map(p => worthAt(m, null, p.slot, t));
  const teamSouls = worth.reduce((a, v) => a + v, 0) || 1, mySouls = worthAt(m, null, slot, t);
  const foeSouls = m.players.filter(p => p.team === foe).reduce((a, p) => a + worthAt(m, null, p.slot, t), 0);
  const rank = 1 + worth.filter(v => v > mySouls).length;
  const lost = (tm: DlTeam, kind: string) => m.objectives.filter(o => o.team === tm && o.kind === kind && o.destroyed !== null && o.destroyed <= t).length;
  const boss = (tm: DlTeam) => (m.midBoss.some(b => b.team === tm && b.t <= t && t - b.t < 180) ? 1 : 0);
  const p = turn(team, at);
  const theirs = standing(m, foe, t), ours = standing(m, team, t);
  const nearest = (list: { x: number; y: number }[]) => Math.min(0.5, ...list.map(q => dist(at, q)));
  const f = [
    t / 60, p.x, p.y, at.hp / 100, rank, mySouls / teamSouls, statAt(m, slot, t)?.level ?? 1,
    allies.length + 1, enemies.length,
    allies.filter(q => dist(q, at) < NEAR).length, enemies.filter(q => dist(q, at) < NEAR).length, nearest(enemies),
    campDist(at), laneDist(at), nearest(theirs), nearest(ours),
    (teamSouls - foeSouls) / Math.max(1, teamSouls + foeSouls),
    lost(team, 'guardian'), lost(foe, 'guardian'), lost(team, 'walker'), lost(foe, 'walker'), boss(team), boss(foe),
  ];
  return { f, spot: `${Math.min(GRID - 1, Math.floor(p.x * GRID))},${Math.min(GRID - 1, Math.floor(p.y * GRID))}` };
}

/** What a player really did over the next 20 s (for training): the first that fits, in this order. */
export function actionAt(m: DlMatch, slot: number, t: number): Action | null {
  const me = m.players.find(p => p.slot === slot);
  if (!me || !playerAt(m, slot, t)) return null;
  const team = me.team, foe = (1 - team) as DlTeam;
  const end = Math.min(m.duration, t + WINDOW);
  // a kill or a death in the window, or a real exchange: 30% health or more lost with an enemy hero close (being near
  // enemies alone is just laning)
  if (m.deaths.some(d => d.t > t && d.t <= end && (d.slot === slot || d.killer === slot))) return 'fight';
  let hurt = false, obj = 0, camp = 0, lane = 0, base = 0;
  const theirs = standing(m, foe, t), bossKill = m.midBoss.find(b => b.t > t && b.t <= end + 10), hp0 = playerAt(m, slot, t)!.hp;
  for (let s = t; s < end; s++) {
    const at = playerAt(m, slot, s);
    if (!at) continue;
    if (!hurt && hp0 - at.hp >= 30 && m.players.some(p => p.team === foe && (() => { const e = playerAt(m, p.slot, s); return !!e && dist(e, at) < 0.04; })())) hurt = true;
    if (theirs.some(o => dist(o, at) < 0.05) || (bossKill && dist(at, DL_MAP.midBoss) < 0.05)) obj++;
    if (campDist(at) < 0.03) camp++;
    if (laneDist(at) < 0.025) lane++;
    if (turn(team, at).y > 0.86) base++;
  }
  return hurt ? 'fight' : obj >= 8 ? 'objective' : camp >= 6 ? 'farm' : base >= 10 ? 'base' : lane >= 10 ? 'lane' : 'move';
}

/** Each action's chance for a good player in this player's place at t (null without a network or while dead). */
export function playChances(net: Mlp | null | undefined, m: DlMatch, slot: number, t: number): Record<Action, number> | null {
  const x = net ? playInput(m, slot, t) : null;
  if (!x) return null;
  const p = mlpPredict(net!, x.f, x.spot);
  return Object.fromEntries(ACTIONS.map((a, i) => [a, p[i]])) as Record<Action, number>;
}

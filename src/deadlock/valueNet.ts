/**
 * The Deadlock value network: how winning a moment is, like a chess engine's evaluation. A small neural network
 * (src/engine/mlp.ts, the same as the CS2 play model) reads both teams' state and gives team 0's chance to win. It's
 * trained by tools/dl-train.ts next to the simple model (winmodel.ts) and ships only when it beats it on matches neither
 * saw; winChance.ts uses whichever shipped.
 *
 * Unlike the simple model, which only sees differences, it sees each team as it is: a 5k souls lead means something
 * else at 10k each than at 40k, and 2 alive against 6 right after a fight changes everything for the next half minute.
 * The teams are read both ways round and averaged, so team 1's chance is exactly 1 minus team 0's.
 */
import { mlpPredict, type Mlp } from '../engine/mlp';
import type { State } from './winmodel';

export interface TeamState {
  /** total net worth, and the richest player's */ souls: number; richest: number;
  /** average hero level */ level: number;
  /** hero kills so far */ kills: number;
  /** players alive now (0–6) */ alive: number;
  /** objectives this team has LOST */ guardians: number; walkers: number; baseGuardians: number; shrines: number;
  /** 1 once their Patron is weakened (both shrines down) */ patron: number;
  /** Mid Bosses taken, and 1 if one was taken in the last 3 minutes (the Rejuvenator's push) */ midBoss: number; recentBoss: number;
}
export interface ValueState { t: number; teams: [TeamState, TeamState] }

const team = (s: TeamState) => [s.souls / 1000, s.richest / 1000, s.level, s.kills / 10, s.alive, s.guardians, s.walkers, s.baseGuardians, s.shrines, s.patron, s.midBoss, s.recentBoss];
const TEAM_FEATURES = ['souls', 'richest', 'level', 'kills', 'alive', 'guardians', 'walkers', 'baseGuardians', 'shrines', 'patron', 'midBoss', 'recentBoss'];
export const VALUE_FEATURES = ['minute', ...TEAM_FEATURES.map(f => `${f}0`), ...TEAM_FEATURES.map(f => `${f}1`)];

export const valueFeatures = (s: ValueState) => [s.t / 60, ...team(s.teams[0]), ...team(s.teams[1])];
/** The same moment with the teams swapped. */
export const mirror = (s: ValueState): ValueState => ({ t: s.t, teams: [s.teams[1], s.teams[0]] });

/** Team 0's chance to win (0–1): the network's answer both ways round, averaged. */
export function valueChance(net: Mlp, s: ValueState) {
  const a = mlpPredict(net, valueFeatures(s))[1], b = mlpPredict(net, valueFeatures(mirror(s)))[1];
  return (a + 1 - b) / 2;
}

/** The simple model's state (differences only) from the same moment. */
export function simpleState(s: ValueState): State {
  const [a, b] = s.teams;
  return {
    t: s.t, souls: [a.souls, b.souls], kills: [a.kills, b.kills], guardians: [a.guardians, b.guardians], walkers: [a.walkers, b.walkers],
    base: [a.baseGuardians + a.shrines, b.baseGuardians + b.shrines], midBoss: [a.midBoss, b.midBoss],
  };
}

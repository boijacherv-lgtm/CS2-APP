/**
 * The Deadlock win-chance model's inputs, shared by the trainer (tools/dl-train.ts) and the coach (winChance.ts): the
 * game state at a moment from team 0's side. Every input is a difference (team 0 minus team 1; the clock only scales the souls
 * lead), so team 1's chance is 1 minus team 0's, up to a small side bias (the intercept).
 */
export interface State {
  /** seconds into the match */ t: number;
  /** each team's total net worth */ souls: [number, number];
  /** each team's kills */ kills: [number, number];
  /** objectives each team has LOST: guardians, walkers, base (base guardians and shrines) */
  guardians: [number, number]; walkers: [number, number]; base: [number, number];
  /** Mid Bosses each team has taken */ midBoss: [number, number];
}

export const FEATURES = ['soulsK', 'soulsShare', 'soulsShareLate', 'kills', 'guardians', 'walkers', 'base', 'midBoss'] as const;

export function features(s: State): number[] {
  const diff = s.souls[0] - s.souls[1], total = Math.max(1, s.souls[0] + s.souls[1]);
  const share = diff / total;
  return [
    diff / 1000,
    share,
    // the same lead matters more late, when there's less game left to turn it round
    share * Math.min(1, s.t / 1800),
    (s.kills[0] - s.kills[1]) / 10,
    // objectives taken (the other team's lost) minus objectives lost
    s.guardians[1] - s.guardians[0],
    s.walkers[1] - s.walkers[0],
    s.base[1] - s.base[0],
    s.midBoss[0] - s.midBoss[1],
  ];
}

/** Team 0's chance to win from a state, with a model's weights (intercept first). */
export function chance(weights: number[], s: State) {
  const x = features(s);
  const z = weights[0] + x.reduce((a, v, i) => a + v * weights[i + 1], 0);
  return 1 / (1 + Math.exp(-z));
}

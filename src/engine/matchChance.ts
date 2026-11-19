/**
 * Chance to win the match from the score alone: each round a coin flip, first to 16 (MR15). From 15–15 it's overtime,
 * which is a coin flip again. Not a prediction about the teams: the shape of how close the match was.
 */
const memo = new Map<string, number>();
export function chanceToWin(a: number, b: number, target = 16): number {
  if (a >= target) return 1;
  if (b >= target) return 0;
  if (a === target - 1 && b === target - 1) return 0.5;
  const k = `${a},${b},${target}`;
  const hit = memo.get(k);
  if (hit !== undefined) return hit;
  const v = 0.5 * chanceToWin(a + 1, b, target) + 0.5 * chanceToWin(a, b + 1, target);
  memo.set(k, v);
  return v;
}

/** The curve over a match: the chance (0–100) after each round for the team (0 started CT), with round 0 at 50%. `winners`:
 * the team (0 or 1) that won each round, in order. */
export function matchCurve(winners: (0 | 1 | null)[], team: 0 | 1): { t: number; v: number }[] {
  const pts = [{ t: 0, v: 50 }];
  let a = 0, b = 0;
  winners.forEach((w, i) => {
    if (w === team) a++; else if (w !== null) b++;
    pts.push({ t: i + 1, v: Math.round(chanceToWin(a, b) * 1000) / 10 });
  });
  return pts;
}

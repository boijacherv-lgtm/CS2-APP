import type { PlayerReport, RoundLine } from './match';
import type { Role, Tag } from './recap';

/**
 * The built-in coach: what a player should work on after a match, and what went well.
 *
 * It works in three steps, kept apart so the coach can be trained on more games later:
 *   1. features   coachFeatures() turns one player's match into numbers (untraded deaths per round, ADR, …)
 *   2. model      a CoachModel says what's normal for each number (baseline), how much it usually varies
 *                 (spread) and how much it matters (weight). DEFAULT_MODEL is set by hand from typical
 *                 Premier games.
 *   3. advice     coach() compares the player with the model: the numbers furthest on the wrong side become
 *                 "work on this" notes (with the rounds where it happened), the best ones "keep doing this".
 *
 * Training: trainCoach() fits baselines and spreads to the feature numbers of many games (yours, your team's, or
 * better players' as a target), starting from the current model. Weights stay as they are for now; fitting them to
 * round wins is the next step once there are enough games.
 */

export type FeatureId =
  | 'untradedDeaths' | 'isolatedDeaths' | 'openingDeaths' | 'whiffs' | 'unusedUtil' | 'wastedFlashes' | 'teamHarm'
  | 'awpLost' | 'lowHpFights' | 'adr' | 'kast' | 'hs' | 'utilDamage' | 'flashAssists' | 'trades' | 'impact';

export type Features = Record<FeatureId, number>;

export interface FeatureModel { baseline: number; spread: number; weight: number }
export interface CoachModel { version: 1; trainedOn: number; features: Record<FeatureId, FeatureModel> }

export interface CoachNote {
  feature: FeatureId;
  kind: 'improve' | 'strength';
  title: string;
  detail: string;
  /** How far from normal, weighted (bigger = more important). */
  score: number;
  /** Rounds (index) where it happened, to watch. */
  rounds: number[];
}

export interface Coaching { player: string; improve: CoachNote[]; strengths: CoachNote[]; sides: { CT: number | null; T: number | null }; summary: string }

/** Typical values for a Premier player (per round unless it says otherwise). */
export const DEFAULT_MODEL: CoachModel = {
  version: 1,
  trainedOn: 0,
  features: {
    untradedDeaths: { baseline: 0.38, spread: 0.12, weight: 1.3 },
    isolatedDeaths: { baseline: 0.12, spread: 0.08, weight: 1.1 },
    openingDeaths: { baseline: 0.1, spread: 0.06, weight: 1.0 },
    whiffs: { baseline: 0.05, spread: 0.05, weight: 0.9 },
    unusedUtil: { baseline: 0.08, spread: 0.06, weight: 0.9 },
    wastedFlashes: { baseline: 0.15, spread: 0.1, weight: 0.7 },
    teamHarm: { baseline: 0.03, spread: 0.04, weight: 0.8 },
    awpLost: { baseline: 0.04, spread: 0.05, weight: 0.8 },
    lowHpFights: { baseline: 0.08, spread: 0.06, weight: 0.7 },
    adr: { baseline: 75, spread: 18, weight: 1.0 },
    kast: { baseline: 70, spread: 8, weight: 1.0 },
    hs: { baseline: 45, spread: 12, weight: 0.6 },
    utilDamage: { baseline: 6, spread: 5, weight: 0.6 },
    flashAssists: { baseline: 0.06, spread: 0.06, weight: 0.6 },
    trades: { baseline: 0.1, spread: 0.07, weight: 0.8 },
    impact: { baseline: 0, spread: 3, weight: 1.2 },
  },
};

/** Which way is better for each number. */
const BETTER: Record<FeatureId, 'low' | 'high'> = {
  untradedDeaths: 'low', isolatedDeaths: 'low', openingDeaths: 'low', whiffs: 'low', unusedUtil: 'low', wastedFlashes: 'low',
  teamHarm: 'low', awpLost: 'low', lowHpFights: 'low', adr: 'high', kast: 'high', hs: 'high', utilDamage: 'high',
  flashAssists: 'high', trades: 'high', impact: 'high',
};

/**
 * How far from normal (in spreads) a number must be before it's worth a "work on this" note. Counting good things
 * (flash assists, trades) varies too much in one game to blame a player for having none: those only praise.
 */
const IMPROVE_AT: Partial<Record<FeatureId, number>> = { flashAssists: Infinity, trades: Infinity, utilDamage: 1.5 };

type Lines = { line: RoundLine; i: number }[];
const has = (l: RoundLine, t: Tag) => l.tags.includes(t);
const roundsWith = (lines: Lines, f: (l: RoundLine) => boolean) => lines.filter(x => f(x.line)).map(x => x.i);

/** One player's match as numbers (the coach's input, and what training learns from). */
export function coachFeatures(p: PlayerReport): Features {
  const lines = played(p);
  const n = Math.max(1, lines.length);
  const rate = (f: (l: RoundLine) => boolean) => lines.filter(x => f(x.line)).length / n;
  const count = (t: Tag) => lines.reduce((a, x) => a + x.line.tags.filter(y => y === t).length, 0) / n;
  return {
    untradedDeaths: rate(l => l.deaths > 0 && !has(l, 'TRADED')),
    isolatedDeaths: rate(l => l.deaths > 0 && has(l, 'ISOLATED')),
    openingDeaths: p.openingDeaths / n,
    whiffs: count('WHIFF'),
    unusedUtil: count('UNUSED UTIL'),
    wastedFlashes: count('WASTED'),
    teamHarm: count('TEAM FLASH') + count('TEAM DAMAGE'),
    awpLost: count('AWP LOST'),
    lowHpFights: rate(l => l.deaths > 0 && has(l, 'LOW HP')),
    adr: p.adr, kast: p.kast, hs: p.hs,
    utilDamage: p.utilDamage / n,
    flashAssists: p.flashAssists / n,
    trades: count('TRADE'),
    impact: p.impactPerRound,
  };
}

function played(p: PlayerReport): Lines {
  return p.rounds.map((line, i) => ({ line, i })).filter((x): x is { line: RoundLine; i: number } => !!x.line);
}

const per = (v: number, n: number) => `${Math.round(v * n)} of ${n} rounds`;

/** The words for each number: what to work on when it's bad, what to keep when it's good. */
function words(id: FeatureId, v: number, n: number, role: Role): { improve: [string, string]; strength: [string, string] } {
  switch (id) {
    case 'untradedDeaths': return {
      improve: ['Die where a teammate can trade you', `You died without a trade in ${per(v, n)}. Fight close enough to a teammate (in their line of sight, a second or two behind or ahead) that your death costs the enemy one back.`],
      strength: ['Your deaths got traded', `Only ${per(v, n)} ended with an untraded death: you fought near your team.`],
    };
    case 'isolatedDeaths': return {
      improve: ['Stop dying alone', `${per(v, n)} you died with no teammate near you. ${role === 'Lurk' ? 'Lurking is fine, but time it with your team\'s push so your fights happen at the same time as theirs.' : 'Hold or move with a partner; a lone player gives the enemy a free 1v1.'}`],
      strength: ['Good spacing', 'You rarely got caught alone.'],
    };
    case 'openingDeaths': return {
      improve: [role === 'Entry' ? 'Make your entries count' : 'Avoid giving the first kill', role === 'Entry'
        ? `You died first in ${per(v, n)}. Entry with a flash from a teammate and a trade partner behind you, or wait for utility before you swing.`
        : `You died first in ${per(v, n)}, which leaves your team 4v5. Don't take the first duel without utility or a reason (info, an entry role); let the entry go first.`],
      strength: ['Safe early rounds', 'You rarely gave away the opening kill.'],
    };
    case 'whiffs': return {
      improve: ['Fewer missed sprays', `You died right after spraying and missing ${per(v, n)}. Burst or tap at range, reset your crosshair to head height, and stop moving before you shoot.`],
      strength: ['Clean aim', 'You almost never died after missing a spray.'],
    };
    case 'unusedUtil': return {
      improve: ['Use your grenades before you die', `${per(v, n)} you died holding two or more grenades. Throw them earlier: a flash for your peek, a molotov to delay, a smoke to cross. Grenades in the pocket of a dead player are wasted money.`],
      strength: ['You used your utility', 'You rarely died with grenades left.'],
    };
    case 'wastedFlashes': return {
      improve: ['Make your flashes blind someone', `About ${per(v, n)} had a flash that blinded nobody. Learn 2–3 pop-flashes for the spots you play, and throw them where an enemy is likely to be looking, not just at the corner.`],
      strength: ['Effective flashes', 'Your flashes usually blinded enemies.'],
    };
    case 'teamHarm': return {
      improve: ['Stop hurting your team', `You flashed or damaged teammates about ${Math.max(1, Math.round(v * n))} times. Call your flashes and check where your team is before throwing molotovs or HEs.`],
      strength: ['', ''],
    };
    case 'awpLost': return {
      improve: ['Don\'t lose the AWP', `You died with the AWP ${Math.max(1, Math.round(v * n))} times ($4,750 each). After a shot, reposition; don't re-peek the same angle, and play deeper so a rifler has to come to you.`],
      strength: ['', ''],
    };
    case 'lowHpFights': return {
      improve: ['Don\'t fight while hurt', `${per(v, n)} you died in a fight you took while already hurt. When low, play for information or a trade: let a healthy teammate take the duel.`],
      strength: ['', ''],
    };
    case 'adr': return {
      improve: ['Do more damage', `Your ADR was ${Math.round(v)}. Even when you lose a duel, damage helps: pre-aim common spots, use HEs on stacked positions, and don't stop shooting a weak enemy.`],
      strength: ['High damage', `ADR ${Math.round(v)}: you hurt the enemy every round.`],
    };
    case 'kast': return {
      improve: ['Be useful in more rounds', `KAST ${Math.round(v)}%: in many rounds you had no kill, no assist, didn't survive and weren't traded. Saving when the round is lost, or dying where you can be traded, both count.`],
      strength: ['Useful every round', `KAST ${Math.round(v)}%: you contributed in most rounds.`],
    };
    case 'hs': return {
      improve: ['Aim for the head', `${Math.round(v)}% of your kills were headshots. Keep your crosshair at head height when you move and clear angles (crosshair placement); a few minutes in an aim map before playing helps.`],
      strength: ['Headshots', `${Math.round(v)}% of your kills were headshots.`],
    };
    case 'utilDamage': return {
      improve: ['Get damage from grenades', `Your HEs and molotovs did ${Math.round(v * n)} damage in total. Throw HEs at stacked sites and molotovs at common hiding spots before you go in.`],
      strength: ['Damaging utility', `Your HEs and molotovs did ${Math.round(v * n)} damage.`],
    };
    case 'flashAssists': return {
      improve: ['Flash for your teammates', 'You had almost no flash assists. Pop-flash for the player peeking next to you, so they swing into a blind enemy.'],
      strength: ['Great support flashes', `${Math.round(v * n)} kills came on enemies you flashed.`],
    };
    case 'trades': return {
      improve: ['Trade your teammates', `You traded a teammate's killer only ${Math.round(v * n)} times. Stay a few steps behind your entry, ready to swing as soon as they fight.`],
      strength: ['Quick trades', `You traded ${Math.round(v * n)} teammates' killers.`],
    };
    case 'impact': return {
      improve: ['Swing more rounds', `On average you changed your team's win chance by ${v.toFixed(1)}% a round. Look at your lowest round grades below and what happened in them.`],
      strength: ['Round-winning plays', `You added ${v.toFixed(1)}% win chance a round on average.`],
    };
  }
}

/** Rounds to watch for each note. */
function examples(id: FeatureId, lines: Lines): number[] {
  switch (id) {
    case 'untradedDeaths': return roundsWith(lines, l => l.deaths > 0 && !has(l, 'TRADED'));
    case 'isolatedDeaths': return roundsWith(lines, l => l.deaths > 0 && has(l, 'ISOLATED'));
    case 'openingDeaths': return roundsWith(lines, l => has(l, 'OPENING') && l.deaths > 0 && !l.duels.some(d => d.won));
    case 'whiffs': return roundsWith(lines, l => has(l, 'WHIFF'));
    case 'unusedUtil': return roundsWith(lines, l => has(l, 'UNUSED UTIL'));
    case 'wastedFlashes': return roundsWith(lines, l => has(l, 'WASTED'));
    case 'teamHarm': return roundsWith(lines, l => has(l, 'TEAM FLASH') || has(l, 'TEAM DAMAGE'));
    case 'awpLost': return roundsWith(lines, l => has(l, 'AWP LOST'));
    case 'lowHpFights': return roundsWith(lines, l => l.deaths > 0 && has(l, 'LOW HP'));
    case 'flashAssists': return roundsWith(lines, l => has(l, 'FLASH ASSIST'));
    case 'trades': return roundsWith(lines, l => has(l, 'TRADE'));
    case 'impact': return [...lines].sort((a, b) => a.line.points - b.line.points).slice(0, 3).map(x => x.i).sort((a, b) => a - b);
    default: return [];
  }
}

/** Coaching for one player from their match report. */
export function coach(p: PlayerReport, model: CoachModel = DEFAULT_MODEL): Coaching {
  const lines = played(p);
  const n = lines.length;
  const f = coachFeatures(p);
  const role = p.roles[0]?.role ?? 'Rifler';
  const notes: CoachNote[] = [];
  for (const id of Object.keys(f) as FeatureId[]) {
    const m = model.features[id];
    if (!m || m.spread <= 0) continue;
    // positive = worse than normal
    const z = ((f[id] - m.baseline) / m.spread) * (BETTER[id] === 'low' ? 1 : -1);
    // entries are expected to die first more often
    const adj = id === 'openingDeaths' && role === 'Entry' ? z - 1 : z;
    const w = words(id, f[id], n, role);
    if (adj > (IMPROVE_AT[id] ?? 0.8)) notes.push({ feature: id, kind: 'improve', title: w.improve[0], detail: w.improve[1], score: adj * m.weight, rounds: examples(id, lines) });
    else if (adj < -0.8 && w.strength[0]) notes.push({ feature: id, kind: 'strength', title: w.strength[0], detail: w.strength[1], score: -adj * m.weight, rounds: examples(id, lines) });
  }
  const sideImpact = (s: 'CT' | 'T') => {
    const got = lines.filter(x => x.line.side === s);
    return got.length >= 4 ? (got.reduce((a, x) => a + x.line.impact, 0) / got.length) * 100 : null;
  };
  const sides = { CT: sideImpact('CT'), T: sideImpact('T') };
  if (sides.CT !== null && sides.T !== null && Math.abs(sides.CT - sides.T) > 5) {
    const weak = sides.CT < sides.T ? 'CT' : 'T';
    notes.push({
      feature: 'impact', kind: 'improve', title: `Your ${weak} side`, score: Math.abs(sides.CT - sides.T) / 5,
      detail: `You did much better on ${weak === 'CT' ? 'T' : 'CT'} (${(weak === 'CT' ? sides.T! : sides.CT!).toFixed(1)}% a round) than on ${weak} (${(weak === 'CT' ? sides.CT : sides.T)!.toFixed(1)}%). ${weak === 'CT'
        ? 'On CT: hold one angle at a time, fall back after first contact instead of re-peeking, and save utility to retake.'
        : 'On T: come in with utility and a teammate, don\'t peek alone for info, and play the post-plant from safe spots.'}`,
      rounds: lines.filter(x => x.line.side === weak).sort((a, b) => a.line.points - b.line.points).slice(0, 3).map(x => x.i).sort((a, b) => a - b),
    });
  }
  const improve = notes.filter(x => x.kind === 'improve').sort((a, b) => b.score - a.score).slice(0, 4);
  const strengths = notes.filter(x => x.kind === 'strength').sort((a, b) => b.score - a.score).slice(0, 3);
  const summary = n === 0 ? 'Not graded yet.'
    : improve.length === 0 ? `A solid game as ${role.toLowerCase()}: nothing stands out as a weakness.`
    : `Main thing to work on: ${improve[0].title.toLowerCase()}.${strengths.length ? ` Keep it up: ${strengths[0].title.toLowerCase()}.` : ''}`;
  return { player: p.id, improve, strengths, sides, summary };
}

/**
 * Training: refit what's "normal" to a set of games (each one player's features from one match). Starts from
 * `prior` and moves toward the games' averages as more games come in (`priorGames` = how many games the prior
 * counts as). Use your own games for "compared with your usual", or stronger players' games as a target.
 */
export function trainCoach(samples: Features[], prior: CoachModel = DEFAULT_MODEL, priorGames = 10): CoachModel {
  const features = { ...prior.features };
  for (const id of Object.keys(features) as FeatureId[]) {
    const xs = samples.map(s => s[id]).filter(Number.isFinite);
    if (!xs.length) continue;
    const p = prior.features[id];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    const w = xs.length / (xs.length + priorGames);
    const baseline = p.baseline * (1 - w) + mean * w;
    const spread = Math.sqrt(p.spread ** 2 * (1 - w) + varr * w);
    features[id] = { ...p, baseline, spread: Math.max(spread, p.spread * 0.25) };
  }
  return { version: 1, trainedOn: prior.trainedOn + samples.length, features };
}

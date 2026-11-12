import type { Moment, MomentOption } from './moments';

/**
 * The puzzle rules (round 8, B6): 3–4 answers, each a different idea; the best at least 8 points ahead of the second;
 * no two answers within 3 points; nothing under 5%; no decided moments (85%+ or 15%-); never two puzzles from the same
 * round within 20 s; at most a fifth of a set about planting; labels say the idea and the place. A puzzle that can't be
 * made to fit is left out. Used by the generator (tools/puzzles.ts) and on the Puzzles page for older sets.
 */
export const RULES = { margin: 0.08, apart: 0.03, floor: 0.05, decidedHi: 0.85, decidedLo: 0.15, sameRoundSecs: 20, plantShare: 0.2, min: 3, max: 4 };
/** Deadlock's engine puts its answers much closer together (a team fight swings less than a CS2 round): the same
 * rules on its scale, gaps at about half. */
const GAPS = { cs2: { margin: RULES.margin, apart: RULES.apart }, deadlock: { margin: 0.045, apart: 0.015 } };

/** The idea behind an answer: plant, defuse, hold, reposition, peek, utility, fall back, wait, fight, farm … */
export function ideaOf(label: string): string {
  const l = label.toLowerCase();
  if (/plant/.test(l)) return 'plant';
  if (/defus/.test(l)) return 'defuse';
  if (/^(flash|smoke|molotov|he |throw|incendiary)/.test(l)) return 'utility';
  if (/^peek|take the fight|fight/.test(l)) return 'peek';
  if (/^hold|^stay|stay in lane/.test(l)) return 'hold';
  if (/fall back|back off|save|retreat|guardian|base/.test(l)) return 'fall back';
  if (/^wait/.test(l)) return 'wait';
  if (/farm|camp/.test(l)) return 'farm';
  if (/objective|walker|urn|boss/.test(l)) return 'objective';
  if (/^(move|go|rotate|reposition)/.test(l)) return 'reposition';
  return l.split(' ')[0];
}

/** Words that say the idea and the place ("Move to Hut" → "Reposition to Hut"). */
export const ideaLabel = (label: string) => label.replace(/^Move to\b/, 'Reposition to').replace(/^Go to\b/, 'Rotate to');

/** One puzzle to the rules, or null when it can't fit them. */
export function shapePuzzle(m: Moment): Moment | null {
  const gap = GAPS[m.game];
  const opts = m.options.map((o, i) => ({ o, i })).sort((a, b) => b.o.value - a.o.value);
  const best = opts[0];
  if (!best || best.o.value >= RULES.decidedHi || best.o.value <= RULES.decidedLo) return null;
  const kept: typeof opts = [best];
  const ideas = new Set([ideaOf(best.o.label)]);
  // what was really played stays when it can (it's the lesson), then the rest, best first
  const rest = [...opts.slice(1)].sort((a, b) => Number(b.i === m.played) - Number(a.i === m.played) || b.o.value - a.o.value);
  for (const x of rest) {
    if (kept.length >= RULES.max) break;
    const idea = ideaOf(x.o.label);
    if (x.o.value < RULES.floor || ideas.has(idea) || kept.some(k => Math.abs(k.o.value - x.o.value) < gap.apart)) continue;
    kept.push(x); ideas.add(idea);
  }
  if (kept.length < RULES.min) return null;
  kept.sort((a, b) => b.o.value - a.o.value);
  if (kept[0].o.value - kept[1].o.value < gap.margin) return null;
  const played = Math.max(0, kept.findIndex(k => k.i === m.played));
  const options: MomentOption[] = kept.map(k => ({ ...k.o, label: ideaLabel(k.o.label) }));
  return { ...m, options, played };
}

/** Seconds into the round from a "R13 1:46" label (the round clock counts down from 1:55); null without one. */
function roundAndClock(when: string): { round: string; t: number } | null {
  const r = when.match(/^R(\d+)\s+(\d+):(\d+)/);
  return r ? { round: r[1], t: +r[2] * 60 + +r[3] } : null;
}

/** A set to the rules: every puzzle shaped, no two from the same round within 20 s, at most a fifth about planting. */
export function shapeSet(ms: Moment[]): Moment[] {
  const out: Moment[] = [];
  let plants = 0;
  for (const raw of ms) {
    const m = shapePuzzle(raw);
    if (!m) continue;
    const rc = roundAndClock(m.when);
    if (rc && out.some(o => o.match === m.match && o.id.split('#')[0] === m.id.split('#')[0] && (() => { const x = roundAndClock(o.when); return !!x && x.round === rc.round && Math.abs(x.t - rc.t) < RULES.sameRoundSecs; })())) continue;
    const plant = ideaOf(m.options[0].label) === 'plant';
    if (plant) plants++;
    out.push(m);
  }
  // planting at most a fifth of what's left
  while (plants > Math.floor(out.length * RULES.plantShare)) {
    const i = out.map(m => ideaOf(m.options[0].label)).lastIndexOf('plant');
    if (i < 0) break;
    out.splice(i, 1); plants--;
  }
  return out;
}

/** How hard: the gap between the best and the second (easy 25+ points, hard 8–12). */
export const difficulty = (m: Moment): 'easy' | 'medium' | 'hard' => {
  const v = m.options.map(o => o.value).sort((a, b) => b - a), gap = v[0] - (v[1] ?? 0);
  return gap >= 0.25 ? 'easy' : gap >= 0.12 ? 'medium' : 'hard';
};

import { isDecision, type Hold, type Move } from './situations';
import { judgeHold, judgeMove, type HoldVerdict, type MoveVerdict } from './positioning';
import { engineHold, engineMove, type MoveClass } from './engineEval';
import { proPositions } from '../map/positions';

/**
 * Step 4 of the decision coach: a written analysis of a player's positioning over a match (and a line per round),
 * built only from the facts steps 1–3 produce: where they stood and moved, what level-10 players do in the same
 * situation, and how those choices go for them. Every sentence comes from a counted pattern, so nothing is made up.
 * (A language model can later rewrite these same facts in freer words; the facts stay the same.)
 */
export interface AnalysisItem { title: string; detail: string; rounds: number[]; weight: number }
export interface MatchAnalysis {
  /** A few sentences: how they positioned overall, the main thing to change, what to keep. */
  summary: string;
  work: AnalysisItem[];
  good: AnalysisItem[];
  /** Decisions compared; the share that level-10 players also make (anything but "Pros don't"); the share that are their most common choice. */
  decisions: number;
  likePros: number | null;
  mostCommon: number | null;
  demos: number;
  /** The engine's view (engineEval.ts): positioning accuracy over the match (0–100) and how many moves of each class. */
  accuracy: number | null;
  classes: Partial<Record<MoveClass, number>>;
  /** The worst positional moves, with the best alternative. */
  worst: { round: number; t: number; what: string; best: string; loss: number; cls: MoveClass }[];
}

type Judged =
  | { round: number; kind: 'hold'; h: Hold; v: HoldVerdict }
  | { round: number; kind: 'move'; m: Move; v: MoveVerdict };

const PLURAL: Record<MoveClass, string> = { Best: 'best', Excellent: 'excellent', Good: 'good', Inaccuracy: 'inaccuracies', Mistake: 'mistakes', Blunder: 'blunders' };
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** "Try X…" → "try X…" inside a sentence, but place names (Big Box…) keep their capitals. */
const lower = (t: string) => (/^(Try|Don't|Fall|After|You) /.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Every decision of one player over the match, judged. `rounds[i]` = that round's holds and moves (or null). */
export function judgeMatch(map: string, player: string, rounds: ({ holds: Hold[]; moves: Move[] } | null | undefined)[]): Judged[] {
  const out: Judged[] = [];
  rounds.forEach((d, round) => {
    if (!d) return;
    for (const h of d.holds) if (h.player === player && isDecision(h)) out.push({ round, kind: 'hold', h, v: judgeHold(map, h) });
    for (const m of d.moves) if (m.player === player && isDecision({ place: m.from, from: m.t })) out.push({ round, kind: 'move', m, v: judgeMove(map, m) });
  });
  return out;
}

/** The match analysis for one player. `won[i]` = their side won round i. */
export function matchAnalysis(map: string, player: string, rounds: ({ holds: Hold[]; moves: Move[] } | null | undefined)[], won: boolean[]): MatchAnalysis | null {
  const pos = proPositions(map);
  if (!pos) return null;
  const all = judgeMatch(map, player, rounds);
  const known = all.filter(x => x.v.kind !== 'unknown');
  const likePros = known.length ? known.filter(x => x.v.kind !== 'unusual').length / known.length : null;
  const mostCommon = known.length ? known.filter(x => x.v.kind === 'common').length / known.length : null;
  const holds = all.filter((x): x is Extract<Judged, { kind: 'hold' }> => x.kind === 'hold');
  const moves = all.filter((x): x is Extract<Judged, { kind: 'move' }> => x.kind === 'move');
  const group = <T,>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return [...m.values()];
  };
  const roundsOf = (xs: Judged[]) => [...new Set(xs.map(x => x.round))].sort((a, b) => a - b);

  const work: AnalysisItem[] = [];
  // 1. stayed under fire where pros leave
  for (const g of group(holds.filter(x => x.v.flags.includes('stayed-under-fire')), x => x.h.place)) {
    const x = g[0];
    work.push({
      title: `Fall back from ${x.h.place} once they're on you`,
      detail: `You died holding ${x.h.place} with enemies in sight ${times(g.length)}. ${x.v.reasons[0] ?? ''} ${x.v.fallback ? `Give up the spot to ${x.v.fallback} and make them come to you.` : 'Give up the spot and make them come to you.'}`.trim(),
      rounds: roundsOf(g), weight: 3 * g.length,
    });
  }
  // 2. alone where pros need a teammate
  for (const g of group(holds.filter(x => x.v.flags.includes('alone') && !x.v.flags.includes('stayed-under-fire')), x => x.h.place)) {
    const x = g[0];
    work.push({
      title: `Don't hold ${x.h.place} alone`,
      detail: `You died alone at ${x.h.place} ${times(g.length)}. ${x.v.reasons.find(r => r.startsWith('Alone')) ?? ''} Play it with a teammate close enough to trade, or from a spot your team can see.`.trim(),
      rounds: roundsOf(g), weight: 2.5 * g.length,
    });
  }
  // 3. spots level-10 players don't use, that cost a life
  for (const g of group(holds.filter(x => x.v.kind === 'unusual' && x.h.ended === 'died'), x => x.h.place)) {
    const x = g[0];
    const top = x.v.pros.slice(0, 3).map(p => `${p.place} (${pct(p.share)})`).join(', ');
    work.push({
      title: `${x.h.place} isn't a level-10 spot at that point`,
      detail: `You died there ${times(g.length)}. In the same situation level-10 ${x.h.side === 'CT' ? 'CTs' : 'Ts'} play ${top}.`,
      rounds: roundsOf(g), weight: 2 * g.length,
    });
  }
  // 4. a better-winning spot they keep choosing over
  for (const g of group(holds.filter(x => x.v.better && x.v.kind !== 'common'), x => `${x.h.place}>${x.v.better!.place}`)) {
    if (g.length < 2) continue;
    const x = g[0];
    work.push({
      title: `Try ${x.v.better!.place} instead of ${x.h.place}`,
      detail: `You played ${x.h.place} ${times(g.length)} at that point of the round. Level-10 ${x.h.side === 'CT' ? 'CTs' : 'Ts'} there win ${pct(x.v.winRate ?? 0)} of rounds; from ${x.v.better!.place} they win ${pct(x.v.better!.winRate)}.`,
      rounds: roundsOf(g), weight: 1 * g.length,
    });
  }
  // 5. reactions that differ from what pros do after the same trigger
  for (const g of group(moves.filter(x => x.v.kind === 'unusual' && x.m.trigger), x => `${x.m.from}|${x.m.trigger}`)) {
    const x = g[0];
    const top = x.v.pros.slice(0, 2).map(p => `${p.place} (${pct(p.share)})`).join(' or ');
    work.push({
      title: `After "${x.m.trigger}" at ${x.m.from}`,
      detail: `You went to ${x.m.to}${g.length > 1 ? ` (${times(g.length)})` : ''}; level-10 players in that spot go to ${top}.`,
      rounds: roundsOf(g), weight: 1.2 * g.length,
    });
  }
  work.sort((a, b) => b.weight - a.weight);

  const good: AnalysisItem[] = [];
  // never praise a spot the same write-up asks them to change
  const flaggedPlaces = new Set(work.map(w => w.title));
  const criticised = (place: string) => [...flaggedPlaces].some(t => t.includes(place));
  for (const g of group(holds.filter(x => x.v.kind === 'common' && won[x.round]), x => x.h.place)) {
    if (g.length < 2 || criticised(g[0].h.place)) continue;
    const x = g[0];
    good.push({
      title: `${x.h.place} like a level-10 player`,
      detail: `You played ${x.h.place} ${times(g.length)} the way level-10 players do (${pct(x.v.share ?? 0)} of them are there at that point) and your team won those rounds.`,
      rounds: roundsOf(g), weight: g.length,
    });
  }
  const goodMoves = moves.filter(x => x.v.kind === 'common' && x.m.trigger);
  if (goodMoves.length >= 2)
    good.push({
      title: 'You react like they do',
      detail: `${goodMoves.length} of your moves after something happened (${[...new Set(goodMoves.map(x => `"${x.m.trigger}"`))].slice(0, 2).join(', ')}) are what level-10 players do in that spot.`,
      rounds: roundsOf(goodMoves), weight: goodMoves.length,
    });
  good.sort((a, b) => b.weight - a.weight);

  const share = `${pct(likePros ?? 0)} of your ${known.length} decisions are ones level-10 players also make in the same situation (${pct(mostCommon ?? 0)} are their most common choice)`;
  const likeLine = likePros === null ? '' : likePros >= 0.85 ? `Your positioning is close to level-10 play: ${share}.`
    : likePros >= 0.7 ? `${share[0].toUpperCase()}${share.slice(1)}; the rest is where rounds slip.`
    : `Your positioning is often off level-10 play: ${share}.`;
  const summary = [
    likeLine,
    work[0] ? `The main thing: ${lower(work[0].title)} (${work[0].rounds.map(i => `R${i + 1}`).join(', ')}).` : 'Nothing stands out as a positioning mistake.',
    work[1] ? `Also: ${lower(work[1].title)}.` : '',
    good[0] ? `Keep it up: ${lower(good[0].title)}.` : '',
  ].filter(Boolean).join(' ');
  // the engine: every decision against the best level-10 option
  const engined = all.map(x => ({ x, e: x.kind === 'hold' ? engineHold(map, x.h) : engineMove(map, x.m) })).filter(y => y.e);
  const accuracy = engined.length ? +(engined.reduce((a, y) => a + y.e!.accuracy, 0) / engined.length).toFixed(1) : null;
  const classes: Partial<Record<MoveClass, number>> = {};
  for (const y of engined) classes[y.e!.cls] = (classes[y.e!.cls] ?? 0) + 1;
  const worst = engined.filter(y => y.e!.loss >= 0.05).sort((a, b) => b.e!.loss - a.e!.loss).slice(0, 5).map(y => ({
    round: y.x.round, t: y.x.kind === 'hold' ? y.x.h.from : y.x.m.t,
    what: y.x.kind === 'hold' ? `${y.x.h.contact ? 'Fought at' : 'Held'} ${y.x.h.place}` : `${y.x.m.from} → ${y.x.m.to}`,
    best: y.e!.best!.place, loss: y.e!.loss, cls: y.e!.cls,
  }));
  const engineLine = accuracy === null ? '' : `Positioning accuracy ${accuracy} (${(['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'] as MoveClass[]).filter(c => classes[c]).map(c => `${classes[c]} ${classes[c]! > 1 ? PLURAL[c] : c.toLowerCase()}`).join(', ')}).`;
  return { summary: [engineLine, summary].filter(Boolean).join(' '), work: work.slice(0, 5), good: good.slice(0, 3), decisions: known.length, likePros, mostCommon, demos: pos.demos, accuracy, classes, worst };
}

/** One paragraph about a player's positioning in one round (the Positions tab). */
export function roundAnalysis(map: string, player: string, d: { holds: Hold[]; moves: Move[] }, until = Infinity): string | null {
  if (!proPositions(map)) return null;
  const js = judgeMatch(map, player, [{ holds: d.holds.filter(h => h.from <= until), moves: d.moves.filter(m => m.t <= until) }]);
  const known = js.filter(x => x.v.kind !== 'unknown');
  if (!known.length) return null;
  const like = known.filter(x => x.v.kind !== 'unusual').length;
  const path = js.filter((x): x is Extract<Judged, { kind: 'hold' }> => x.kind === 'hold').map(x => x.h.place);
  const flagged = js.find(x => x.kind === 'hold' && x.v.flags.length) as Extract<Judged, { kind: 'hold' }> | undefined;
  const offMove = js.find(x => x.kind === 'move' && x.v.kind === 'unusual') as Extract<Judged, { kind: 'move' }> | undefined;
  return [
    path.length ? `You played ${[...new Set(path)].join(' → ')}.` : '',
    `${like} of ${known.length} decisions are ones level-10 players also make here.`,
    flagged ? `Key moment: ${flagged.v.flags.includes('stayed-under-fire') ? `you stayed at ${flagged.h.place} with enemies on you${flagged.v.fallback ? `; they fall back to ${flagged.v.fallback}` : ''}` : flagged.v.flags.includes('alone') ? `you held ${flagged.h.place} alone and died; they play it with a teammate` : `${flagged.h.place} isn't where they stand at that point`}.` : '',
    !flagged && offMove ? `Worth a look: after "${offMove.m.trigger ?? 'that'}" you went ${offMove.m.from} → ${offMove.m.to}; they go ${offMove.v.pros[0]?.place ?? 'elsewhere'}.` : '',
  ].filter(Boolean).join(' ');
}

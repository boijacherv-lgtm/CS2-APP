/**
 * The Deadlock coach: every death and kill of a match graded, and each player's laning against the average player on
 * the same hero (deadlock-api's performance curve). Marks as in CS2 (!! ! book ?! ? ??), with the reasons.
 *
 * Map distances are in minimap widths (0–1 across); MAP_UNITS game units across.
 */
import { MAP_UNITS, heroOf, objectiveSpot, type DlTeam } from './data';
import { playerAt, statAt, type DlMatch } from './match';
import type { Annotation } from '../engine/recap';
import type { DlDemo } from './demo';
import { benchAt, matchPosition } from './bench';
import { POS_NAME } from './positions';
import { swingAt } from './winChance';
import { heatAt } from './deathMap';
import { patternOf, type Corrections } from './disputes';

export type DlTag = 'HOT SPOT' | 'ISOLATED' | 'OUTNUMBERED' | 'OVEREXTENDED' | 'TRADED' | 'COST OBJECTIVE' | 'SOLO KILL' | 'MULTI-KILL' | 'UPSET' | 'LANE LOST' | 'LANE WON' | 'FIRST BLOOD' | 'ULT UNUSED';
export interface DlMove {
  t: number; slot: number; team: DlTeam;
  /** engine: a move the 2-step search graded (engineReview.ts) */ kind: 'death' | 'kill' | 'laning' | 'engine';
  note: Annotation; title: string; why: string[]; tags: DlTag[];
  /** The team's win chance just before and 30 s after (what the moment led to), from the coach's model. */
  win?: { before: number; after: number; swing: number };
}
/** The average player on a hero: net worth at each snapshot time (s). */
export type Benchmarks = Record<number, { t: number; avg: number; std: number }[]>;

/** Teammates this close (game units) can help or trade; enemies this close are in the fight. */
const HELP = 2500, FIGHT = 2200;
const near = (u: number) => u / MAP_UNITS;
const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pc = (p: number) => `${Math.round(p * 100)}%`;
const pts = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts`;
/** The worse / better of two marks. */
const BAD: Annotation[] = ['book', '?!', '?', '??'], GOOD: Annotation[] = ['book', '!', '!!'];
const worst = (a: Annotation, b: Annotation) => (BAD.indexOf(b) > BAD.indexOf(a) ? b : a);
const best = (a: Annotation, b: Annotation) => (GOOD.indexOf(a) < 0 ? a : GOOD.indexOf(b) > GOOD.indexOf(a) ? b : a);

export function coachMatch(m: DlMatch, bench: Benchmarks = {}, names: Record<number, { name: string }> = {}, demo: DlDemo | null = null, corrections: Corrections = {}): DlMove[] {
  const moves: DlMove[] = [];
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  const nameOf = (slot: number | null) => {
    const p = m.players.find(x => x.slot === slot);
    return p ? names[p.account]?.name ?? heroOf(p.hero).name : 'creeps';
  };
  const around = (team: DlTeam, at: { x: number; y: number }, t: number, r: number, exclude?: number) =>
    m.players.filter(p => p.team === team && p.slot !== exclude).filter(p => { const a = playerAt(m, p.slot, t); return a && Math.hypot(a.x - at.x, a.y - at.y) <= near(r); }).length;
  const worth = (slot: number, t: number) => statAt(m, slot, t)?.netWorth ?? 0;

  // ---- deaths ------------------------------------------------------------------------------------------------
  const firstKill = m.deaths.find(d => d.killer !== null && teamOf.get(d.killer) !== teamOf.get(d.slot));
  for (const d of m.deaths) {
    const team = teamOf.get(d.slot);
    if (team === undefined) continue;
    const enemy = (1 - team) as DlTeam, t = d.t - 0.5;
    const mates = around(team, d.at, t, HELP, d.slot), foes = around(enemy, d.at, t, FIGHT);
    const traded = d.killer !== null && m.deaths.some(o => o.slot === d.killer && o.t >= d.t && o.t - d.t <= 5 && teamOf.get(o.killer ?? -1) === team);
    // past a guardian of theirs that was still standing, in their half of the map
    const theirHalf = team === 0 ? d.at.y < 0.5 : d.at.y > 0.5;
    const guardUp = m.objectives.some(o => o.team === enemy && o.kind === 'guardian' && (o.destroyed === null || o.destroyed > d.t)
      && (() => { const s = objectiveSpot(enemy, o.id); return !!s && (team === 0 ? d.at.y < s.y : d.at.y > s.y) && Math.abs(d.at.x - s.x) < 0.12; })());
    const overextended = theirHalf && guardUp && d.t < 1200;
    // one of theirs fell within 40 s after: the death opened the way
    const lost = m.objectives.find(o => o.team === team && o.destroyed !== null && o.destroyed > d.t && o.destroyed - d.t <= 40);
    const alone = mates === 0, outnumbered = foes >= mates + 2;
    const tags: DlTag[] = [];
    const why: string[] = [];
    if (alone) { tags.push('ISOLATED'); why.push('No teammate within reach: nobody could help or trade.'); }
    if (outnumbered && !alone) { tags.push('OUTNUMBERED'); why.push(`${foes} enemies against ${mates + 1} of you.`); }
    else if (outnumbered) why.push(`${foes} enemies on you.`);
    if (overextended) { tags.push('OVEREXTENDED'); why.push('Died past one of their standing Guardians: deep in their side with no way back.'); }
    if (traded) { tags.push('TRADED'); why.push('A teammate killed your killer right after: the death was traded.'); }
    if (lost) { tags.push('COST OBJECTIVE'); why.push(`Your ${lost.name} fell ${Math.round(lost.destroyed! - d.t)} s later.`); }
    if (d === firstKill) { tags.push('FIRST BLOOD'); why.push('First death of the match.'); }
    // a spot where high-rank players die a lot at this stage (the death map): a known trap, worth a second look
    const heat = heatAt(d.at.x, d.at.y, d.t, team);
    if (heat !== null && heat >= 85) { tags.push('HOT SPOT'); why.push(`A hot spot: high-rank players die here more than in ${heat}% of the places they die at this stage.`); }
    // from the demo: died with the ultimate ready (last used longer ago than its full cooldown, so surely back:
    // cooldown items only make it shorter)
    const ult = heroOf(m.players.find(p => p.slot === d.slot)?.hero ?? 0).abilities?.find(a => a.ult);
    const lastUlt = demo?.casts.filter(c => c.slot === d.slot && c.ult && c.t < d.t).at(-1);
    // …and had time to use it (a fight of 2 s or more, not a burst from nowhere)
    const ultReady = !!ult && !!lastUlt && ult.cd > 0 && d.t - lastUlt.t >= ult.cd + 20 && (d.ttk ?? 0) >= 2;
    if (ultReady) { tags.push('ULT UNUSED'); why.push(`Died with ${ult!.name} ready: last used ${mins(d.t - lastUlt!.t)} before (it's back in ${ult!.cd} s at most), in a ${d.ttk} s fight.`); }
    why.push(`Out for ${d.respawn} s.`);
    const faults = Number(alone) + Number(outnumbered) + Number(overextended);
    const base: Annotation = traded ? 'book' : faults >= 2 && lost ? '??' : faults >= 1 && (lost || faults >= 2) ? '?' : faults >= 1 ? '?!' : 'book';
    // an ultimate held through a death is a step worse (a traded death too: it could have won the fight)
    const note: Annotation = !ultReady ? base : base === 'book' ? '?!' : base === '?!' ? '?' : base === '?' ? '??' : base;
    // what it cost: the team's win chance over the next 30 s (the model, winChance.ts); a costly death is a mistake
    // whatever else, a very costly one a blunder (a traded death stays sound)
    const win = swingAt(m, demo, d.t, team);
    if (!traded) why.splice(why.length - 1, 0, `Win chance ${pts(win.swing)} (${pc(win.before)} → ${pc(win.after)} over the next 30 s).`);
    const worse = traded ? note : win.swing <= -0.15 ? worst(note, '??') : win.swing <= -0.1 ? worst(note, '?') : win.swing <= -0.06 ? worst(note, '?!') : note;
    moves.push({ t: d.t, slot: d.slot, team, kind: 'death', note: worse, tags, why, win,
      title: `${nameOf(d.slot)} died${d.killer !== null && d.killer !== d.slot ? ` to ${nameOf(d.killer)}` : ''} at ${mins(d.t)}` });
  }

  // ---- kills ---------------------------------------------------------------------------------------------------
  for (const d of m.deaths) {
    if (d.killer === null || d.killer === d.slot) continue;
    const team = teamOf.get(d.killer);
    if (team === undefined || team === teamOf.get(d.slot)) continue;
    const at = playerAt(m, d.killer, d.t - 0.5) ?? d.from ?? d.at;
    const mates = around(team, at, d.t - 0.5, HELP, d.killer), foes = around((1 - team) as DlTeam, d.at, d.t - 0.5, FIGHT);
    const streak = m.deaths.filter(o => o.killer === d.killer && o.t <= d.t && d.t - o.t <= 10).length;
    const richer = worth(d.slot, d.t) - worth(d.killer, d.t);
    const tags: DlTag[] = [], why: string[] = [];
    if (mates === 0) { tags.push('SOLO KILL'); why.push('No teammate around: a kill on your own.'); }
    if (foes >= 2 && mates === 0) why.push(`Against ${foes} of them.`);
    if (streak >= 3) { tags.push('MULTI-KILL'); why.push(`${streak} kills in 10 s.`); }
    if (richer >= 3000) { tags.push('UPSET'); why.push(`They had ${richer.toLocaleString()} more souls.`); }
    const note: Annotation = streak >= 4 || (mates === 0 && foes >= 2) ? '!!' : streak >= 3 || richer >= 3000 || (mates === 0 && foes >= 1 && richer > 0) ? '!' : 'book';
    // what it won: the team's win chance over the next 30 s
    const win = swingAt(m, demo, d.t, team);
    why.push(`Win chance ${pts(win.swing)} (${pc(win.before)} → ${pc(win.after)} over the next 30 s).`);
    const better = win.swing >= 0.15 ? best(note, '!!') : win.swing >= 0.08 ? best(note, '!') : note;
    moves.push({ t: d.t, slot: d.killer, team, kind: 'kill', note: better, tags, why, win, title: `${nameOf(d.killer)} killed ${nameOf(d.slot)} at ${mins(d.t)}` });
  }

  // ---- laning: souls at the end of the laning phase against players of the same hero in the same position --------
  // (bench.ts, from everyone's recent public matches; else the hero's average from deadlock-api's performance curve)
  const LANE_END = 720;
  for (const p of m.players) {
    const s = statAt(m, p.slot, LANE_END);
    if (!s || s.t !== LANE_END || m.duration < LANE_END) continue;
    const pos = matchPosition(m, p.slot);
    const learned = benchAt(p.hero, pos, LANE_END / 60, 'nw'), curve = bench[p.hero]?.find(x => x.t === LANE_END);
    const b = learned ? { avg: learned.mean, std: learned.sd } : curve ? { avg: curve.avg, std: curve.std } : null;
    if (!b) continue;
    const who = learned?.of === 'hero+pos' ? `Pos ${pos} ${heroOf(p.hero).name}` : learned?.of === 'pos' ? `Pos ${pos} player` : heroOf(p.hero).name;
    const z = (s.netWorth - b.avg) / (b.std || 1);
    const cs = s.possibleCreeps ? s.lastHits / s.possibleCreeps : null;
    const lhBench = benchAt(p.hero, pos, LANE_END / 60, 'lh');
    const why = [`${s.netWorth.toLocaleString()} souls at ${mins(LANE_END)}; the average ${who}: ${Math.round(b.avg).toLocaleString()}.`,
      ...(cs !== null ? [`Last hits: ${s.lastHits} of ${s.possibleCreeps} possible (${Math.round(cs * 100)}%)${lhBench ? `; the average ${who}: ${Math.round(lhBench.mean)}` : ''}.`] : []),
      ...(pos ? [`Played Pos ${pos} ${POS_NAME[pos]} this match (by souls on the team at the end).`] : [])];
    const note: Annotation = z <= -1.5 ? '?' : z <= -0.8 ? '?!' : z >= 1.5 ? '!!' : z >= 0.8 ? '!' : 'book';
    const tags: DlTag[] = z <= -0.8 ? ['LANE LOST'] : z >= 0.8 ? ['LANE WON'] : [];
    moves.push({ t: LANE_END, slot: p.slot, team: p.team, kind: 'laning', note, tags, why,
      title: `${nameOf(p.slot)}'s laning: ${z >= 0 ? '+' : '−'}${Math.abs(Math.round(s.netWorth - b.avg)).toLocaleString()} souls vs the average ${who}` });
  }
  // the owner's rulings on disputed moments of the same kind: when players were right clearly more often (3+ rulings,
  // twice the coach's), the mark moves one step the way they asked
  for (const mv of moves) {
    const c = corrections[patternOf(mv.kind, mv.tags)];
    if (!c || c.better + c.worse < 3 || c.better + c.worse < 2 * c.coach) continue;
    const up = c.better >= c.worse, order: Annotation[] = ['??', '?', '?!', 'book', '!', '!!'];
    const i = order.indexOf(mv.note), j = Math.max(0, Math.min(order.length - 1, i + (up ? 1 : -1)));
    if (i < 0 || i === j) continue;
    mv.note = order[j];
    mv.why.push(`Marked ${up ? 'up' : 'down'} after ${c.better + c.worse} rulings on moments like this.`);
  }
  return moves.sort((a, b) => a.t - b.t);
}

/** The average player's net worth over time on each hero (deadlock-api performance curve, normal games, last 30 days). */
export async function loadBenchmarks(heroIds: number[]): Promise<Benchmarks> {
  const out: Benchmarks = {};
  await Promise.all([...new Set(heroIds)].map(async h => {
    try {
      const key = `stratboard.dlbench.${h}`;
      const cached = (() => { try { const c = JSON.parse(localStorage.getItem(key) ?? 'null'); return c && Date.now() - c.at < 86400e3 ? c.rows : null; } catch { return null; } })();
      if (cached) { out[h] = cached; return; }
      const res = await fetch(`https://api.deadlock-api.com/v1/analytics/player-performance-curve?resolution=0&hero_ids=${h}`);
      if (!res.ok) return;
      const rows = ((await res.json()) as { game_time: number; net_worth_avg: number; net_worth_std: number }[]).map(r => ({ t: r.game_time, avg: r.net_worth_avg, std: r.net_worth_std }));
      out[h] = rows;
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), rows })); } catch { /* private mode */ }
    } catch { /* offline: no laning grade */ }
  }));
  return out;
}

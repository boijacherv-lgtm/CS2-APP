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

export type DlTag = 'ISOLATED' | 'OUTNUMBERED' | 'OVEREXTENDED' | 'TRADED' | 'COST OBJECTIVE' | 'SOLO KILL' | 'MULTI-KILL' | 'UPSET' | 'LANE LOST' | 'LANE WON' | 'FIRST BLOOD' | 'ULT UNUSED';
export interface DlMove {
  t: number; slot: number; team: DlTeam;
  kind: 'death' | 'kill' | 'laning';
  note: Annotation; title: string; why: string[]; tags: DlTag[];
}
/** The average player on a hero: net worth at each snapshot time (s). */
export type Benchmarks = Record<number, { t: number; avg: number; std: number }[]>;

/** Teammates this close (game units) can help or trade; enemies this close are in the fight. */
const HELP = 2500, FIGHT = 2200;
const near = (u: number) => u / MAP_UNITS;
const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function coachMatch(m: DlMatch, bench: Benchmarks = {}, names: Record<number, { name: string }> = {}, demo: DlDemo | null = null): DlMove[] {
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
    moves.push({ t: d.t, slot: d.slot, team, kind: 'death', note, tags, why,
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
    moves.push({ t: d.t, slot: d.killer, team, kind: 'kill', note, tags, why, title: `${nameOf(d.killer)} killed ${nameOf(d.slot)} at ${mins(d.t)}` });
  }

  // ---- laning: souls at the end of the laning phase against the average on the hero ------------------------------
  const LANE_END = 720;
  for (const p of m.players) {
    const b = bench[p.hero]?.find(x => x.t === LANE_END);
    const s = statAt(m, p.slot, LANE_END);
    if (!b || !s || s.t !== LANE_END || m.duration < LANE_END) continue;
    const z = (s.netWorth - b.avg) / (b.std || 1);
    const cs = s.possibleCreeps ? s.lastHits / s.possibleCreeps : null;
    const why = [`${s.netWorth.toLocaleString()} souls at ${mins(LANE_END)}; the average ${heroOf(p.hero).name}: ${Math.round(b.avg).toLocaleString()}.`,
      ...(cs !== null ? [`Last hits: ${s.lastHits} of ${s.possibleCreeps} possible (${Math.round(cs * 100)}%).`] : [])];
    const note: Annotation = z <= -1.5 ? '?' : z <= -0.8 ? '?!' : z >= 1.5 ? '!!' : z >= 0.8 ? '!' : 'book';
    const tags: DlTag[] = z <= -0.8 ? ['LANE LOST'] : z >= 0.8 ? ['LANE WON'] : [];
    moves.push({ t: LANE_END, slot: p.slot, team: p.team, kind: 'laning', note, tags, why,
      title: `${nameOf(p.slot)}'s laning: ${z >= 0 ? '+' : '−'}${Math.abs(Math.round(s.netWorth - b.avg)).toLocaleString()} souls vs the average` });
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

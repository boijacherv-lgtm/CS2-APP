/**
 * The Dota 2 coach: every death and kill of a match graded, and each player's lane against who they laned with. Marks as
 * in CS2 (!! ! book ?! ? ??), with the reasons. It only says what the logs show: with no hero positions over time it can
 * tell nobody else died around a death, not how far away your team stood.
 */
import type { Annotation } from '../engine/recap';
import { buildingOf, heroOf, mins, type D2Team } from './data';
import { netWorthAt, seriesAt, type D2Match } from './match';

export type D2Tag = 'PICKED OFF' | 'OUTNUMBERED' | 'EXPENSIVE' | 'TRADED' | 'COST OBJECTIVE' | 'MULTI-KILL' | 'UPSET' | 'LANE LOST' | 'LANE WON' | 'FIRST BLOOD';
export interface D2Move {
  t: number; slot: number; team: D2Team;
  kind: 'death' | 'kill' | 'laning';
  note: Annotation; title: string; why: string[]; tags: D2Tag[];
}

/** A death handing over this much gold (lost plus the bounty) is an expensive one. */
const EXPENSIVE = 1500;
/** Nicknames can be anything: a card shows the hero, and this much of the nick. */
const NICK_MAX = 14;
/** Seconds around a death with no other death, for it to be a pick-off. */
const PICK_OFF = 20;
/** The end of the laning phase, when lanes are compared. */
const LANE_END = 600;

export function coachMatch(m: D2Match): D2Move[] {
  if (!m.parsed) return [];
  const moves: D2Move[] = [];
  const nameOf = (slot: number | null) => {
    if (slot === null) return 'creeps';
    const p = m.players[slot], hero = heroOf(p.hero).name;
    if (!p.name) return hero;
    return `${hero} (${p.name.length > NICK_MAX ? `${p.name.slice(0, NICK_MAX - 1)}…` : p.name})`;
  };
  const teamOf = (slot: number) => m.players[slot].team;

  // ---- deaths ------------------------------------------------------------------------------------------------
  const firstKill = m.deaths.find(d => d.killer !== null && teamOf(d.killer) !== teamOf(d.slot));
  for (const d of m.deaths) {
    const team = teamOf(d.slot), enemy = (1 - team) as D2Team;
    const fight = d.fight !== null ? m.fights[d.fight] : null;
    // OpenDota logs only some fights, so a death counts as a pick-off only when nobody else died around it
    const pickedOff = !fight && !m.deaths.some(o => o !== d && Math.abs(o.t - d.t) <= PICK_OFF);
    const mates = fight?.present[team].length ?? 0, foes = fight?.present[enemy].length ?? 0;
    const outnumbered = !!fight && foes >= mates + 2;
    const cost = d.goldLost + d.goldFed, expensive = cost >= EXPENSIVE;
    const traded = d.killer !== null && m.deaths.some(o => o.slot === d.killer && o.t >= d.t && o.t - d.t <= 5 && o.killer !== null && teamOf(o.killer) === team);
    const down = m.downs.find(o => buildingOf.get(o.uid)?.team === team && o.t > d.t && o.t - d.t <= 40 && buildingOf.get(o.uid)?.kind !== 'fort');
    const rosh = m.roshan.find(r => r.team === enemy && r.t > d.t && r.t - d.t <= 60);
    const tags: D2Tag[] = [], why: string[] = [];
    if (pickedOff) { tags.push('PICKED OFF'); why.push(`Nobody else died within ${PICK_OFF} s: a pick-off, not a fight.`); }
    if (outnumbered) { tags.push('OUTNUMBERED'); why.push(`${foes} of them in that fight against ${mates} of you.`); }
    if (expensive) { tags.push('EXPENSIVE'); why.push(`Cost ${cost.toLocaleString()} gold: ${d.goldLost.toLocaleString()} lost and ${d.goldFed.toLocaleString()} to them.`); }
    if (traded) { tags.push('TRADED'); why.push('Your team killed your killer right after: the death was traded.'); }
    if (down) { tags.push('COST OBJECTIVE'); why.push(`Your ${buildingOf.get(down.uid)!.name} fell ${Math.round(down.t - d.t)} s later.`); }
    else if (rosh) { tags.push('COST OBJECTIVE'); why.push(`They took Roshan ${Math.round(rosh.t - d.t)} s later.`); }
    if (d === firstKill) { tags.push('FIRST BLOOD'); why.push('First death of the match.'); }
    if (d.respawn) why.push(`Out for ${d.respawn} s.`);
    const lost = !!(down || rosh);
    const faults = Number(pickedOff) + Number(outnumbered) + Number(expensive);
    const note: Annotation = traded ? 'book' : faults >= 2 && lost ? '??' : faults >= 1 && (lost || faults >= 2) ? '?' : faults >= 1 ? '?!' : 'book';
    moves.push({ t: d.t, slot: d.slot, team, kind: 'death', note, tags, why,
      title: `${nameOf(d.slot)} died${d.killer !== null && d.killer !== d.slot ? ` to ${nameOf(d.killer)}` : ''} at ${mins(d.t)}` });
  }

  // ---- kills ---------------------------------------------------------------------------------------------------
  for (const d of m.deaths) {
    if (d.killer === null || d.killer === d.slot || teamOf(d.killer) === teamOf(d.slot)) continue;
    const streak = m.deaths.filter(o => o.killer === d.killer && o.t <= d.t && d.t - o.t <= 18).length;
    const richer = netWorthAt(m, d.slot, d.t) - netWorthAt(m, d.killer, d.t);
    const tags: D2Tag[] = [], why: string[] = [];
    if (streak >= 3) { tags.push('MULTI-KILL'); why.push(`${streak} kills in 18 s.`); }
    if (richer >= 3000) { tags.push('UPSET'); why.push(`They had ${Math.round(richer).toLocaleString()} more net worth.`); }
    if (d === firstKill) tags.push('FIRST BLOOD');
    const note: Annotation = streak >= 4 ? '!!' : streak >= 3 || richer >= 3000 ? '!' : 'book';
    moves.push({ t: d.t, slot: d.killer, team: teamOf(d.killer), kind: 'kill', note, tags, why, title: `${nameOf(d.killer)} killed ${nameOf(d.slot)} at ${mins(d.t)}` });
  }

  // ---- laning: net worth at 10:00 against the enemy in the same lane who is doing the same job -------------------
  if (m.duration >= LANE_END) {
    for (const lane of [1, 2, 3]) {
      const rank = (team: D2Team) => m.players.filter(p => p.team === team && p.lane === lane).sort((a, b) => netWorthAt(m, b.slot, LANE_END) - netWorthAt(m, a.slot, LANE_END));
      const sides = [rank(0), rank(1)];
      sides.forEach((mine, s) => {
        const theirs = sides[1 - s];
        if (!theirs.length) return;
        mine.forEach((p, i) => {
          const o = theirs[Math.min(i, theirs.length - 1)];
          const a = netWorthAt(m, p.slot, LANE_END), b = netWorthAt(m, o.slot, LANE_END), diff = a - b;
          const lh = seriesAt(m.minutes[p.slot].lh, LANE_END), dn = seriesAt(m.minutes[p.slot].dn, LANE_END);
          const note: Annotation = diff <= -1000 ? '?' : diff <= -500 ? '?!' : diff >= 1000 ? '!!' : diff >= 500 ? '!' : 'book';
          moves.push({ t: LANE_END, slot: p.slot, team: p.team, kind: 'laning', note,
            tags: diff <= -500 ? ['LANE LOST'] : diff >= 500 ? ['LANE WON'] : [],
            why: [`${Math.round(a).toLocaleString()} net worth at ${mins(LANE_END)}; ${nameOf(o.slot)}: ${Math.round(b).toLocaleString()}.`, `${Math.round(lh)} last hits, ${Math.round(dn)} denies.`],
            title: `${nameOf(p.slot)}'s lane: ${diff >= 0 ? '+' : '−'}${Math.abs(Math.round(diff)).toLocaleString()} gold vs ${nameOf(o.slot)}` });
        });
      });
    }
  }
  return moves.sort((a, b) => a.t - b.t);
}

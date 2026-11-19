/**
 * How a player used their ultimate, judged by what it's for (ultBook.ts): every cast in the demo, where everyone was
 * then (the demo's hero tracks) and what followed in the next 10 s. An ultimate that hits everyone near is good when it
 * catches several enemies; a single-target one when there's someone to hit and they die; an escape when its user gets
 * away; a power-up when there's a fight to win. Needs the demo (casts and exact positions): null without one.
 */
import { MAP_UNITS, type DlTeam } from './data';
import { heroAt, type DlDemo } from './demo';
import { playerAt, type DlMatch } from './match';
import { ultOf, type UltInfo } from './ultKinds';

/** Game units in a metre (the Source engine's inch), and a distance in metres as a share of the map. */
const UNITS_PER_M = 39.37;
const m2map = (m: number) => (m * UNITS_PER_M) / MAP_UNITS;
const AFTER = 10;

export type UltVerdict = 'great' | 'good' | 'ok' | 'wasted';
export interface UltUse {
  t: number; verdict: UltVerdict;
  /** enemies and allies close enough to matter when it was cast */ enemies: number; allies: number;
  /** what followed in the next 10 s: kills by the team, deaths on it, and whether the caster lived */ kills: number; deaths: number; survived: boolean;
  /** what happened, in words */ text: string;
}

/** Every ultimate the player cast, judged (null without a demo, or for a hero not in the book). */
export function ultUses(m: DlMatch, demo: DlDemo | null, slot: number): { ult: UltInfo; uses: UltUse[] } | null {
  const me = m.players.find(p => p.slot === slot), ult = me ? ultOf(me.hero) : null;
  if (!demo || !me || !ult) return null;
  const team = me.team as DlTeam;
  const casts = demo.casts.filter(c => c.slot === slot && c.ult).map(c => c.t)
    // one cast can show twice (a recast, or the channel's end)
    .filter((t, i, all) => i === 0 || t - all[i - 1] > 8);
  // how far it reaches: its radius for one around the caster; its range for one enemy; for one aimed at a spot, ahead or
  // bouncing, the area it can be sent into (the enemies near the caster then, not exactly where it landed)
  const reach = m2map(ult.target === 'around' ? ult.radius || 12 : ult.target === 'one' ? ult.range || 20 : Math.max(ult.range, ult.radius, 40));
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  const uses: UltUse[] = [];
  for (const t of casts) {
    const at = heroAt(demo, slot, t);
    if (!at) continue;
    const near = (tm: DlTeam, r: number) => m.players.filter(p => p.team === tm && p.slot !== slot).filter(p => { const q = heroAt(demo, p.slot, t); return !!q && Math.hypot(q.x - at.x, q.y - at.y) < r; });
    const enemies = near((1 - team) as DlTeam, reach), allies = near(team, m2map(25));
    const later = m.deaths.filter(d => d.t >= t && d.t < t + AFTER);
    const kills = later.filter(d => teamOf.get(d.slot) !== team && d.killer !== null && teamOf.get(d.killer) === team).length;
    const deaths = later.filter(d => teamOf.get(d.slot) === team).length;
    const survived = !later.some(d => d.slot === slot);
    const targetDied = enemies.some(e => later.some(d => d.slot === e.slot));
    const n = enemies.length, got = kills ? ` Your team got ${kills} kill${kills > 1 ? 's' : ''} in the next ${AFTER} s.` : '';
    let verdict: UltVerdict, text: string;
    if (ult.effects.includes('revive')) continue; // it goes off on its own
    if (ult.target === 'map' && ult.effects.includes('heal')) {
      // reaches the whole map: what counts is how many allies anywhere were hurt enough to need it
      const hurt = m.players.filter(p => p.team === team && p.slot !== slot).filter(p => { const q = playerAt(m, p.slot, t); return !!q && q.hp < 70; }).length;
      verdict = hurt >= 3 ? 'great' : hurt === 2 ? 'good' : hurt === 1 ? 'ok' : 'wasted';
      text = hurt ? `${hurt} hurt ${hurt === 1 ? 'ally' : 'allies'} on the map to heal.${got}` : 'Nobody on your team was hurt: nothing to heal.';
    } else if (ult.target === 'map') {
      // a teleport: to escape (did you live?) or to join a fight (did it pay?)
      verdict = !survived ? 'wasted' : kills > deaths ? 'great' : 'good';
      text = survived ? `Teleported and lived.${got}` : `You died within ${AFTER} s of arriving.`;
    } else if (ult.target === 'self' || ult.target === 'ally') {
      const escape = ult.kinds.includes('escape') && !ult.kinds.includes('power');
      if (escape) { verdict = survived ? (n ? 'good' : 'ok') : 'wasted'; text = survived ? `${n ? `Got away from ${n} ${n === 1 ? 'enemy' : 'enemies'}` : 'Used with nobody chasing you'}.${got}` : `You still died within ${AFTER} s.`; }
      else { verdict = !n ? 'wasted' : kills > 0 && survived ? 'great' : survived ? 'good' : 'ok'; text = n ? `Used in a fight with ${n} ${n === 1 ? 'enemy' : 'enemies'} near.${got}${survived ? '' : ' You died in it.'}` : 'No enemy near: nothing to use it on.'; }
    } else if (ult.target === 'one') {
      verdict = !n ? 'wasted' : targetDied ? 'great' : kills ? 'good' : 'ok';
      text = !n ? 'No enemy in its reach when you cast it.' : targetDied ? `An enemy in its reach died within ${AFTER} s.${got}` : `Hit someone, but nobody near died.${got}`;
    } else {
      // hits several: the more it catches the better
      verdict = n >= 3 || (n >= 2 && kills >= 2) ? 'great' : n >= 2 ? 'good' : n === 1 ? 'ok' : 'wasted';
      text = n ? `${n} ${n === 1 ? 'enemy' : 'enemies'} in its reach.${got}` : 'No enemy in its reach when you cast it.';
    }
    uses.push({ t, verdict, enemies: n, allies: allies.length, kills, deaths, survived, text });
  }
  return { ult, uses };
}

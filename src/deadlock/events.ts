/**
 * The match as a feed, like the game's: who killed whom, who destroyed which objective, who carried the urn and what
 * it paid, who took Sinner's Sacrifice, the Rejuvenator, the Unstable Rift. Kills and objectives come
 * from the match data; the rest needs the demo. When the game doesn't say who did it (an objective, a vault),
 * it's the nearest hero (of the team that profited, for an objective), if one was close.
 */
import { campTier, DL_MAP, objectiveKey, type DlTeam } from './data';
import { heroAt, STAT_DT, type DlDemo } from './demo';
import { playerAt, type DlMatch } from './match';

export type FeedKind = 'kill' | 'objective' | 'urn' | 'urnLost' | 'sinners' | 'rejuv' | 'boss' | 'rift';
export interface FeedEvent {
  t: number; kind: FeedKind;
  /** Who did it (a player slot), or only which team. */
  slot: number | null; team: DlTeam | null;
  /** A kill's victim. */
  victim?: number;
  /** What it was (an objective's name), or what it paid (souls). */
  what?: string; souls?: number;
}

/** How close (share of the map) a hero must be to count as the one who did it. */
const NEAR = 0.07;

export function feedEvents(match: DlMatch, demo: DlDemo | null): FeedEvent[] {
  const out: FeedEvent[] = [];
  const teamOf = new Map(match.players.map(p => [p.slot, p.team]));
  const spot = (slot: number, t: number) => (demo ? heroAt(demo, slot, t) : null) ?? playerAt(match, slot, t);
  const nearest = (at: { x: number; y: number }, t: number, team: DlTeam | null) => {
    let best: number | null = null, bd = NEAR;
    for (const p of match.players) {
      if (team !== null && p.team !== team) continue;
      const s = spot(p.slot, t);
      if (!s || Number.isNaN(s.x)) continue;
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d < bd) { bd = d; best = p.slot; }
    }
    return best;
  };

  for (const d of match.deaths) {
    const k = d.killer !== null && d.killer !== d.slot && teamOf.has(d.killer) ? d.killer : null;
    out.push({ t: d.t, kind: 'kill', slot: k, team: k !== null ? teamOf.get(k)! : null, victim: d.slot });
  }
  for (const o of match.objectives) {
    if (o.destroyed === null) continue;
    const by = (1 - o.team) as DlTeam, key = objectiveKey(o.id);
    const at = key ? DL_MAP.objectives.find(x => x.id === `team${o.team}_${key}`) : undefined;
    out.push({ t: o.destroyed, kind: 'objective', slot: at ? nearest(at, o.destroyed, by) : null, team: by, what: o.name });
  }
  if (!demo) {
    for (const b of match.midBoss) out.push({ t: b.t, kind: 'boss', slot: null, team: b.team });
    return out.sort((a, b) => a.t - b.t);
  }

  // the urn: picked up, then delivered (the carrier's souls jump) or lost
  const nw = (slot: number, t: number) => demo.stats[slot]?.nw[Math.max(0, Math.round(t / STAT_DT))] ?? null;
  for (const u of demo.urn) {
    if (u.taken === null || u.slot === null) continue;
    const team = teamOf.get(u.slot) ?? null;
    out.push({ t: u.taken, kind: 'urn', slot: u.slot, team });
    if (u.until === null || u.until >= match.duration) continue;
    const before = nw(u.slot, u.until - STAT_DT), after = nw(u.slot, u.until + 2 * STAT_DT);
    const gain = before !== null && after !== null ? after - before : 0;
    out.push(gain >= 300 ? { t: u.until, kind: 'urn', slot: u.slot, team, souls: gain, what: 'delivered' } : { t: u.until, kind: 'urnLost', slot: u.slot, team });
  }
  // Sinner's Sacrifice (the vaults): cleared by whoever stood there
  demo.camps.forEach((spans, i) => {
    const c = DL_MAP.camps[i];
    if (!c || campTier(c.kind) !== null) return;
    for (const [, z] of spans) {
      if (z >= match.duration) continue;
      const slot = nearest(c, z, null);
      if (slot !== null) out.push({ t: z, kind: 'sinners', slot, team: teamOf.get(slot)! });
    }
  });
  // the mid boss, and who claimed the Rejuvenator it drops
  for (const b of match.midBoss) out.push({ t: b.t, kind: 'boss', slot: null, team: b.team });
  // the demo lists the Rejuvenator's buff more than once: the first claim after each kill
  for (const b of match.midBoss) {
    const r = demo.rejuv.find(x => x.t >= b.t && x.t - b.t < 90 && x.slot !== null);
    if (r) out.push({ t: r.t, kind: 'rejuv', slot: r.slot, team: teamOf.get(r.slot!) ?? null });
  }
  for (const r of demo.rifts) if (r.taken !== null && r.team !== null) out.push({ t: r.taken, kind: 'rift', slot: null, team: r.team });
  return out.sort((a, b) => a.t - b.t);
}

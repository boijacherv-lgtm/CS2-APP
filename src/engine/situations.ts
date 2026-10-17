import { worldToRadar } from './coords';
import type { TacticalEngine } from './predict';
import type { DemoRound } from './recap';
import type { Side, Vec2 } from './types';

/**
 * Step 1 of the decision coach: a round as situations and decisions, the way a player lived it.
 *
 *   holds   where each player stood (a callout) and for how long, with what they knew when they took the spot
 *   moves   each time they left a spot for another one, and what had just happened (the likely trigger)
 *
 * "What they knew" is only what their team could know: enemies one of them had in sight, not the whole server.
 * tools/learn-positions.ts runs this over good players' demos to learn where they stand and why they move.
 */

/**
 * The callout a spot belongs to: the nearest one you can see from there (not one behind a wall), a detailed spot
 * (Boost, Default…) only when it's right there, and the plain nearest one as a fallback.
 */
export function placeOf(engine: TacticalEngine, p: Vec2): string {
  const g = engine.grid;
  let best = '', bd = Infinity;
  for (const c of engine.map.callouts) {
    const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y);
    const limit = c.minor ? 45 : 170;
    if (d < limit && d < bd && g.lineOfSight(p, c.pos)) { bd = d; best = c.name; }
  }
  if (best) return best;
  for (const c of engine.map.callouts) { const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y); if (!c.minor && d < 120 && d < bd) { bd = d; best = c.name; } }
  return best;
}

/** The part of the round a moment belongs to (seconds after freeze time). */
export type Phase = 'early' | 'mid' | 'late' | 'post-plant';
export const PHASES: Phase[] = ['early', 'mid', 'late', 'post-plant'];
export const PHASE_LABEL: Record<Phase, string> = { early: '0–25 s', mid: '25–60 s', late: '60 s+', 'post-plant': 'after the plant' };
export const phaseOf = (t: number, plant: number | null): Phase =>
  plant !== null && t >= plant ? 'post-plant' : t < 25 ? 'early' : t < 60 ? 'mid' : 'late';

export interface Hold {
  player: string; side: Side; place: string;
  from: number; to: number; phase: Phase;
  ended: 'died' | 'moved' | 'round end';
  /** Players alive on their side / the other side when they took the spot. */
  alive: [number, number];
  /** Where their team had enemies in sight in the 5 s before they took it. */
  seen: string[];
  /** After the plant: the site the bomb is on. */
  site?: 'A' | 'B';
  /** Most enemies their team had in sight near them (within ~15 m) at once while they held it. */
  pressure: number;
  /** No living teammate within ~10 m when they took it. */
  alone: boolean;
  /** A teammate died near them (~12 m) while they held it. */
  mateDown: boolean;
  /** Ts only, before the plant: the site the team went for (where the bomb went down, else where the team was). */
  target?: 'A' | 'B';
  /** Their side's learned win chance when they took the spot (training data only; see winprob.roundWinChance). */
  ev?: number;
  /** Not a hold: the spot of their first fight, for a round where they never stood still long enough to hold one. */
  contact?: boolean;
}
export interface Move {
  player: string; side: Side; from: string; to: string; t: number; phase: Phase;
  /** What happened in the 5 s before they left: the likely reason (null = nothing visible to them). */
  trigger: string | null;
  /** Their side's learned win chance when they left (training data only). */
  ev?: number;
  /** Callouts they passed through on the way (without stopping), in order. */
  via?: string[];
}

/** Seconds a player has to stay at one callout for it to count as holding it… */
const HOLD_SECS = 4;
/** …standing, not walking: under this average speed (game units a second; running is ~250, shift-walking ~130). */
const HOLD_SPEED = 70;

/**
 * Whether a hold is a real decision: standing in your own spawn in the first 20 s is just the round starting
 * (buying, waiting for the team), not a position taken.
 */
export const isDecision = (h: Pick<Hold, 'place' | 'from'>) => !(/spawn/i.test(h.place) && h.from < 20);

/** Holds and moves of every player in one round. */
export function roundDecisions(engine: TacticalEngine, r: DemoRound): { holds: Hold[]; moves: Move[] } {
  const ids = Object.keys(r.frames.players);
  // players can appear in kills without frames (disconnected, bots): they have no side here
  const side = (id: string) => r.frames.players[id]?.side;
  const ft = r.frames.t;
  const end = Math.min(r.duration, ft[ft.length - 1] ?? 0);
  const at = (id: string, t: number) => {
    let k = 0;
    while (k < ft.length - 1 && ft[k + 1] <= t) k++;
    const f = r.frames.players[id];
    return { pos: worldToRadar({ x: f.x[k], y: f.y[k] }, engine.map.radar), alive: !!f.alive[k] };
  };

  // one sample a second: place, alive, and which enemies each team could see
  const secs = Array.from({ length: Math.floor(end) + 1 }, (_, s) => s);
  const samples = secs.map(t => {
    const st = new Map(ids.map(id => [id, at(id, t)]));
    const seenBy: Record<Side, Set<string>> = { CT: new Set(), T: new Set() };
    for (const a of ids) {
      const A = st.get(a)!;
      if (!A.alive) continue;
      for (const b of ids) {
        const B = st.get(b)!;
        if (side(a) === side(b) || !B.alive || seenBy[side(a)].has(b)) continue;
        if (engine.grid.lineOfSight(A.pos, B.pos)) seenBy[side(a)].add(b);
      }
    }
    const place = new Map(ids.map(id => [id, st.get(id)!.alive ? placeOf(engine, st.get(id)!.pos) : '']));
    return { t, st, seenBy, place };
  });
  const aliveCount = (s: Side, t: number) => ids.filter(id => side(id) === s && samples[Math.min(samples.length - 1, t)]?.st.get(id)?.alive).length;
  const seenPlaces = (s: Side, t: number) => {
    const out = new Set<string>();
    for (let k = Math.max(0, t - 5); k <= t && k < samples.length; k++)
      for (const e of samples[k].seenBy[s]) { const pl = samples[k].place.get(e); if (pl) out.add(pl); }
    return [...out];
  };
  /** What a player could have reacted to in the 5 s before time t. */
  const triggerAt = (id: string, t: number): string | null => {
    const s = side(id);
    const mateDied = r.kills.filter(k => k.t <= t && t - k.t <= 5 && k.victim !== id && side(k.victim) === s).at(-1);
    if (mateDied) return `teammate died at ${placeOf(engine, worldToRadar({ x: mateDied.x, y: mateDied.y }, engine.map.radar)) || 'somewhere'}`;
    if (r.plant !== null && r.plant <= t && t - r.plant <= 5) return 'bomb planted';
    const before = new Set(t >= 6 ? seenPlaces(s, t - 6) : []);
    const fresh = seenPlaces(s, t).filter(p => !before.has(p));
    if (fresh.length) return `enemy seen at ${fresh[0]}`;
    const enemyDied = r.kills.filter(k => k.t <= t && t - k.t <= 5 && side(k.victim) !== s).at(-1);
    if (enemyDied) return 'an enemy died';
    return null;
  };

  // the site the bomb went down on (nearest site centre to the plant)
  const plantEv = (r.bomb ?? []).find(b => b.kind === 'plant');
  let site: 'A' | 'B' | undefined;
  if (plantEv) {
    const p = worldToRadar({ x: plantEv.x, y: plantEv.y }, engine.map.radar);
    const ss = Object.entries(engine.map.sites) as ['A' | 'B', { center: Vec2 }][];
    site = ss.sort((a, b) => Math.hypot(a[1].center.x - p.x, a[1].center.y - p.y) - Math.hypot(b[1].center.x - p.x, b[1].center.y - p.y))[0]?.[0];
  }

  const sites = Object.entries(engine.map.sites) as ['A' | 'B', { center: Vec2 }][];
  const nearestSite = (p: Vec2) => sites.slice().sort((a, b) => Math.hypot(a[1].center.x - p.x, a[1].center.y - p.y) - Math.hypot(b[1].center.x - p.x, b[1].center.y - p.y))[0]?.[0];
  /** The T team's target at time t: the plant's site, else the site nearest to where the Ts were. */
  const targetAt = (t: number): 'A' | 'B' | undefined => {
    if (site) return site;
    const ts = ids.filter(id => side(id) === 'T' && samples[Math.min(samples.length - 1, t)]?.st.get(id)?.alive).map(id => samples[Math.min(samples.length - 1, t)].st.get(id)!.pos);
    if (!ts.length || sites.length < 2) return undefined;
    return nearestSite({ x: ts.reduce((a, p) => a + p.x, 0) / ts.length, y: ts.reduce((a, p) => a + p.y, 0) / ts.length });
  };
  const units = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) * engine.map.radar.scale;

  const holds: Hold[] = [], moves: Move[] = [];
  for (const id of ids) {
    // runs of the same place, second by second
    const runs: { place: string; from: number; to: number }[] = [];
    for (const smp of samples) {
      const pl = smp.place.get(id)!;
      const last = runs.at(-1);
      if (last && last.place === pl) last.to = smp.t;
      else runs.push({ place: pl, from: smp.t, to: smp.t });
    }
    // a hold is standing there, not running through: path length over the run against its duration
    const speed = (x: { from: number; to: number }) => {
      let len = 0;
      for (let t = x.from + 1; t <= x.to; t++) {
        const a = samples[t - 1].st.get(id)!.pos, b = samples[t].st.get(id)!.pos;
        len += Math.hypot(a.x - b.x, a.y - b.y) * engine.map.radar.scale;
      }
      return len / Math.max(1, x.to - x.from);
    };
    const kept = runs.filter(x => x.place && x.to - x.from >= HOLD_SECS && speed(x) <= HOLD_SPEED);
    // a round with no hold (kept moving, or died early): the spot of their first fight is the decision to judge
    if (!kept.length) {
      const fights = [...(r.hits ?? []).filter(x => x.attacker === id || x.victim === id).map(x => x.t), ...r.kills.filter(k => k.attacker === id || k.victim === id).map(k => k.t)];
      const tf = fights.length ? Math.min(...fights) : null;
      const s0 = tf === null ? null : samples[Math.min(samples.length - 1, Math.max(0, Math.floor(tf) - 1))];
      const pl = s0?.place.get(id);
      if (s0 && pl) {
        const me = s0.st.get(id)!.pos;
        const died = r.kills.some(k => k.victim === id && k.t <= (tf ?? 0) + 3);
        holds.push({
          player: id, side: side(id), place: pl, from: s0.t, to: s0.t, phase: phaseOf(s0.t, r.plant),
          ended: died ? 'died' : 'round end', contact: true,
          alive: [aliveCount(side(id), s0.t), aliveCount(side(id) === 'CT' ? 'T' : 'CT', s0.t)],
          seen: seenPlaces(side(id), s0.t), pressure: [...s0.seenBy[side(id)]].filter(e => units(s0.st.get(e)!.pos, me) < 600).length,
          alone: !ids.some(o => o !== id && side(o) === side(id) && s0.st.get(o)!.alive && units(s0.st.get(o)!.pos, me) < 400),
          mateDown: false,
          ...(site && phaseOf(s0.t, r.plant) === 'post-plant' ? { site } : {}),
          ...(side(id) === 'T' && phaseOf(s0.t, r.plant) !== 'post-plant' && targetAt(Math.min(end, s0.t + 10)) ? { target: targetAt(Math.min(end, s0.t + 10)) } : {}),
        });
      }
    }
    kept.forEach((h, i) => {
      const next = kept[i + 1];
      const died = !samples[Math.min(samples.length - 1, h.to + 1)]?.st.get(id)?.alive;
      const me = samples[h.from].st.get(id)!.pos;
      let pressure = 0;
      for (let t = h.from; t <= h.to; t++) {
        const near = [...samples[t].seenBy[side(id)]].filter(e => units(samples[t].st.get(e)!.pos, me) < 600).length;
        pressure = Math.max(pressure, near);
      }
      const alone = !ids.some(o => o !== id && side(o) === side(id) && samples[h.from].st.get(o)!.alive && units(samples[h.from].st.get(o)!.pos, me) < 400);
      const mateDown = r.kills.some(k => k.t >= h.from && k.t <= h.to + 1 && k.victim !== id && side(k.victim) === side(id)
        && units(worldToRadar({ x: k.x, y: k.y }, engine.map.radar), me) < 480);
      const phase = phaseOf(h.from, r.plant);
      const target = side(id) === 'T' && phase !== 'post-plant' ? targetAt(Math.min(end, h.to + 10)) : undefined;
      holds.push({
        player: id, side: side(id), place: h.place, from: h.from, to: h.to, phase: phaseOf(h.from, r.plant),
        ended: next ? 'moved' : died && h.to < end - 1 ? 'died' : 'round end',
        alive: [aliveCount(side(id), h.from), aliveCount(side(id) === 'CT' ? 'T' : 'CT', h.from)],
        seen: seenPlaces(side(id), h.from),
        ...(site && phase === 'post-plant' ? { site } : {}),
        pressure, alone, mateDown, ...(target ? { target } : {}),
      });
      if (next && next.place !== h.place) {
        const via: string[] = [];
        // the first 8 s after leaving: where they were heading, not a whole rotation
        for (let t = h.to + 1; t < next.from && t <= h.to + 8 && t < samples.length; t++) { const pl = samples[t].place.get(id); if (pl && pl !== h.place && pl !== next.place && via.at(-1) !== pl) via.push(pl); }
        moves.push({ player: id, side: side(id), from: h.place, to: next.place, t: h.to, phase: phaseOf(h.to, r.plant), trigger: triggerAt(id, h.to + 1), ...(via.length ? { via } : {}) });
      }
    });
  }
  return { holds, moves };
}

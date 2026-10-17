import type { DemoRound, FrameTrack } from './recap';
import { FL } from './recap';
import { gunFromName } from './guns';
import type { Side } from './types';

/**
 * Micro play, per player per round, from the demo's detail (FrameTrack.pitch/fl/w/am, shot speed and stance, fight
 * samples). Counts and denominators only, so a match and level-10 benchmarks are measured the same way:
 *
 *   counter-strafing   the first shot of each burst fired at an accurate speed for that gun (CS2 is accurate
 *                      below ~34% of the weapon's max speed)
 *   jump shots         shots fired in the air
 *   long sprays        bursts of 8+ bullets (sprays at range are a waste unless point-blank)
 *   crosshair          while moving with a gun, the share of time aiming at the floor (more than 12° down)
 *   sound              with an enemy within hearing range (~28 m), the share of time running (footsteps)
 *   reloads            reloading with bullets left while an enemy is near; dying with 3 bullets or fewer (needed a reload)
 *   wrong weapon       dying with a knife, grenade or bomb in hand
 *   AWP                scoped when an enemy came into view; no-scope shots
 *   peek technique     in the fights they peeked: jiggle, wide swing or plain peek, and won or lost
 */
export interface MicroFacts {
  bursts: number; stoppedBursts: number; airShots: number; shots: number; longSprays: number;
  movingSamples: number; floorSamples: number;
  nearSamples: number; loudSamples: number;
  reloadsNear: number; reloads: number; diedEmpty: number; deaths: number; diedWrongWeapon: number;
  awpContacts: number; awpScoped: number; awpShots: number; noScopes: number;
  peeks: { jiggle: [number, number]; wide: [number, number]; plain: [number, number] }; // [won, lost]
}
export const emptyMicro = (): MicroFacts => ({
  bursts: 0, stoppedBursts: 0, airShots: 0, shots: 0, longSprays: 0, movingSamples: 0, floorSamples: 0, nearSamples: 0, loudSamples: 0,
  reloadsNear: 0, reloads: 0, diedEmpty: 0, deaths: 0, diedWrongWeapon: 0, awpContacts: 0, awpScoped: 0, awpShots: 0, noScopes: 0,
  peeks: { jiggle: [0, 0], wide: [0, 0], plain: [0, 0] },
});

const BURST_GAP = 0.35; // s between shots that still counts as the same burst
const HEAR = 1100; // game units (~28 m): running footsteps carry about this far
const WRONG = /knife|bayonet|karambit|dagger|flashbang|hegrenade|smokegrenade|molotov|incgrenade|decoy|c4|taser/;
const accurateSpeed = (w: string) => {
  const g = gunFromName(w);
  return g ? 0.34 * (g.speed ?? 215) : null;
};

/** Micro facts for every player of a round (only for parses with the micro detail; else null). */
export function analyzeMicro(r: DemoRound): Record<string, MicroFacts> | null {
  const ids = Object.keys(r.frames.players);
  const any = r.frames.players[ids[0]];
  if (!any?.fl || !(r.shots ?? []).some(s => s.spd !== undefined)) return null;
  const side = (id: string): Side | undefined => r.frames.players[id]?.side;
  const ft = r.frames.t;
  const out: Record<string, MicroFacts> = Object.fromEntries(ids.map(id => [id, emptyMicro()]));
  const sampleSpeed = (f: FrameTrack, k: number) => (k > 0 ? Math.hypot(f.x[k] - f.x[k - 1], f.y[k] - f.y[k - 1]) / ((ft[k] - ft[k - 1]) || 0.25) : 0);
  const idxAt = (t: number) => { let k = 0; while (k < ft.length - 1 && ft[k + 1] <= t) k++; return k; };

  // shots: bursts, counter-strafing, jump shots, sprays, AWP
  const byShooter = new Map<string, NonNullable<DemoRound['shots']>>();
  for (const s of r.shots ?? []) if (out[s.id]) byShooter.set(s.id, [...(byShooter.get(s.id) ?? []), s]);
  for (const [id, shots] of byShooter) {
    const m = out[id];
    shots.sort((a, b) => a.t - b.t);
    let burst = 0;
    shots.forEach((s, i) => {
      m.shots++;
      if ((s.fl ?? 0) & FL.airborne) m.airShots++;
      const awp = s.w === 'awp';
      if (awp) { m.awpShots++; if (!((s.fl ?? 0) & FL.scoped)) m.noScopes++; }
      const first = i === 0 || s.t - shots[i - 1].t > BURST_GAP;
      if (first) {
        if (burst >= 8) m.longSprays++;
        burst = 1;
        const lim = s.w ? accurateSpeed(s.w) : null;
        if (lim !== null && s.spd !== undefined) { m.bursts++; if (s.spd <= lim) m.stoppedBursts++; }
      } else burst++;
    });
    if (burst >= 8) m.longSprays++;
  }

  // frames: crosshair while moving, sound near enemies, reloads, death weapon / ammo
  for (const id of ids) {
    const f = r.frames.players[id], m = out[id];
    if (!f.fl || !f.w || !f.am || !f.pitch) continue;
    const enemies = ids.filter(o => side(o) !== side(id));
    for (let k = 1; k < ft.length; k++) {
      if (!f.alive[k]) continue;
      const spd = sampleSpeed(f, k), fl = f.fl[k], w = f.w[k];
      const gun = !!gunFromName(w) && !WRONG.test(w);
      if (gun && spd > 100 && !(fl & FL.airborne)) { m.movingSamples++; if (f.pitch[k] > 12) m.floorSamples++; }
      const near = enemies.some(e => { const g = r.frames.players[e]; return g.alive[k] && Math.hypot(g.x[k] - f.x[k], g.y[k] - f.y[k]) < HEAR; });
      if (near) { m.nearSamples++; if (spd > 150 && !(fl & (FL.walking | FL.crouching | FL.airborne))) m.loudSamples++; }
      // a reload: ammo goes up with the same weapon; risky if it started (~2 s before) with bullets left and an enemy near
      if (f.w[k] === f.w[k - 1] && f.am[k] > f.am[k - 1] && f.am[k - 1] >= 0 && gun) {
        m.reloads++;
        const s0 = Math.max(0, k - 8);
        const enemyNear = enemies.some(e => { const g = r.frames.players[e]; return g.alive[s0] && Math.hypot(g.x[s0] - f.x[s0], g.y[s0] - f.y[s0]) < 1300; });
        if (enemyNear && f.am[s0] >= 8) m.reloadsNear++;
      }
    }
    const death = r.kills.find(k => k.victim === id && k.attacker && k.attacker !== id);
    if (death) {
      m.deaths++;
      const k = Math.max(0, idxAt(death.t - 0.2));
      if (WRONG.test(f.w[k] ?? '')) m.diedWrongWeapon++;
      // the magazine doesn't empty during a reload: 3 bullets or fewer means they needed one
      const g = gunFromName(f.w[k] ?? '');
      if (g && g.cls !== 'awp' && f.am[k] >= 0 && f.am[k] <= 3) m.diedEmpty++;
    }
  }

  // fights: AWP scoped on contact, peek technique (for the one who was moving)
  for (const fight of r.fights ?? []) {
    for (const [who, tr, won] of [[fight.attacker, fight.a, true], [fight.victim, fight.v, false]] as const) {
      const m = out[who];
      if (!m) continue;
      const n = tr.x.length, dt = fight.dt;
      // the last 1.5 s before the kill: direction reversals (jiggles) and sustained speed (wide swing)
      const from = Math.max(1, n - Math.round(1.5 / dt));
      let reversals = 0, fast = 0, prev: { x: number; y: number } | null = null;
      for (let i = from; i < n; i++) {
        if (!Number.isFinite(tr.x[i]) || !Number.isFinite(tr.x[i - 1])) continue;
        const d = { x: tr.x[i] - tr.x[i - 1], y: tr.y[i] - tr.y[i - 1] };
        const len = Math.hypot(d.x, d.y);
        if (len / dt > 180) fast++;
        if (len < 4) continue;
        if (prev && (prev.x * d.x + prev.y * d.y) / (Math.hypot(prev.x, prev.y) * len) < -0.3) reversals++;
        prev = d;
      }
      const moved = fast > 0 || reversals > 0;
      if (moved) {
        const kind = reversals >= 2 ? 'jiggle' : fast * dt >= 0.4 ? 'wide' : 'plain';
        m.peeks[kind][won ? 0 : 1]++;
      }
      // AWP: holding it when the fight started, and scoped then
      const k = idxAt(fight.t0 + 2);
      const f = r.frames.players[who];
      if (f?.w?.[k] === 'awp') { m.awpContacts++; if ((f.fl?.[k] ?? 0) & FL.scoped) m.awpScoped++; }
    }
  }
  return out;
}

/** Add one player's (or many players') facts into a total. */
export function addMicro(total: MicroFacts, x: MicroFacts): MicroFacts {
  for (const k of Object.keys(x) as (keyof MicroFacts)[]) {
    if (k === 'peeks') for (const p of ['jiggle', 'wide', 'plain'] as const) { total.peeks[p][0] += x.peeks[p][0]; total.peeks[p][1] += x.peeks[p][1]; }
    else (total[k] as number) += x[k] as number;
  }
  return total;
}

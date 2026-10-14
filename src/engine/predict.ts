import { activeSmokes, MapGrid, MOLLY_DURATION, segmentHitsCircle, SMOKE_DURATION, SMOKE_RADIUS_UNITS, popAt, type SmokeDisc } from './grid';
import { gaussian, mulberry32 } from './rng';
import { prior, type StrategyArchetype } from './strategies';
import type { BoardState, Chokepoint, Econ, MapDefinition, Player, SiteId, Vec2, Weapon } from './types';

const SPEED: Record<'T' | 'CT', Record<Weapon, number>> = {
  T: { rifle: 215, awp: 200, smg: 240, pistol: 240 },
  CT: { rifle: 225, awp: 200, smg: 240, pistol: 240 },
};
const REACTION = 0.4; // seconds lost leaving spawn
const INFO_DELAY = 1.5; // first contact -> rotators start moving
const PORTAL_SAMPLES = 5;
const ECON: Record<Econ, number> = { eco: 0, force: 0.55, half: 0.4, full: 1 };
const LATE_ROUND_DELAY = 22;

export interface DefenderCoverage {
  playerId: string;
  visibleFrac: number;
  readyAt: number;
}

export interface ChokeAnalysis {
  choke: Chokepoint;
  tArrival: { min: number; mean: number; max: number }; // fastest T rifle arrival, seconds
  defenders: DefenderCoverage[];
  crossfire: number; // 0..1
  timeAdvantage: number; // + => Ts get there before the hold is set
  reinforceTime: number; // seconds for the 2nd CT to reach the fed site after contact
  threat: number; // 0..1
  reasons: string[];
}

export interface StrategyPrediction {
  id: string;
  label: string;
  target: SiteId;
  probability: number;
  successRate: number;
  firstContact: { choke: string; t: number } | null;
  siteHitAt: number | null;
  counter: string;
}

export interface Analysis {
  chokes: ChokeAnalysis[];
  predictions: StrategyPrediction[];
  summary: string[];
}

/** Precomputes distance fields for a map, then analyses boards against it. */
export class TacticalEngine {
  readonly grid: MapGrid;
  /** Seconds for the fastest T rifler / CT rifler to reach each cell. */
  readonly tTime: Float64Array;
  readonly ctTime: Float64Array;
  private tSpawnFields: Float64Array[];
  private ctSpawnField: Float64Array;
  private siteFields: Record<SiteId, Float64Array>;
  readonly secPerPx: (side: 'T' | 'CT', w: Weapon) => number;
  private facingCache = new Map<string, number>();

  constructor(readonly map: MapDefinition, readonly strats: StrategyArchetype[], private beta = 5) {
    this.grid = new MapGrid(map);
    this.secPerPx = (side, w) => (map.radar.scale * map.timingScale) / SPEED[side][w];
    const kT = this.secPerPx('T', 'rifle'), kC = this.secPerPx('CT', 'rifle');
    // Delayed spawns (entry points) start that many seconds late, expressed as a head-start in px.
    const tDelay = map.spawns.T.map((_, i) => map.spawnDelay?.T?.[i] ?? 0);
    const ctDelay = map.spawns.CT.map((_, i) => map.spawnDelay?.CT?.[i] ?? 0);
    this.tSpawnFields = map.spawns.T.map((s, i) => this.grid.distanceField([s], { start: [tDelay[i] / kT] }));
    this.ctSpawnField = this.grid.distanceField(map.spawns.CT, { start: ctDelay.map(d => d / kC) });
    this.siteFields = {
      A: this.grid.distanceField([map.sites.A.center]),
      B: this.grid.distanceField([map.sites.B.center]),
    };
    const tAll = this.grid.distanceField(map.spawns.T, { start: tDelay.map(d => d / kT) });
    this.tTime = tAll.map(d => d * kT + REACTION);
    this.ctTime = this.ctSpawnField.map(d => d * kC + REACTION);
  }

  /** T arrival at a point across all spawn slots (rifle speed). */
  tArrival(p: Vec2) {
    const k = this.secPerPx('T', 'rifle');
    const ts = this.tSpawnFields.map(f => this.grid.at(f, p) * k + REACTION);
    return { min: Math.min(...ts), max: Math.max(...ts), mean: ts.reduce((a, b) => a + b, 0) / ts.length, all: ts };
  }

  /**
   * Where a player is looking. Explicit facing wins; otherwise aim at the nearby visible
   * spot the enemy reaches soonest (i.e. toward where they will come from).
   */
  facing(pl: Player): number {
    if (pl.facing !== undefined) return pl.facing;
    const key = `${pl.side}:${pl.pos.x.toFixed(1)},${pl.pos.y.toFixed(1)}`;
    const hit = this.facingCache.get(key);
    if (hit !== undefined) return hit;
    const enemy = pl.side === 'CT' ? this.tTime : this.ctTime;
    let best = 0, bestT = Infinity;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      for (const r of [40, 90, 160]) {
        const q = { x: pl.pos.x + Math.cos(a) * r, y: pl.pos.y + Math.sin(a) * r };
        if (!this.grid.isWalkable(q) || !this.grid.lineOfSight(pl.pos, q)) continue;
        // prefer far sightlines a little: holding long angles beats staring at a wall
        const t = this.grid.at(enemy, q) - r * 0.004;
        if (t < bestT) { bestT = t; best = a; }
      }
    }
    if (this.facingCache.size > 2000) this.facingCache.clear();
    this.facingCache.set(key, best);
    return best;
  }

  readyAt(pl: Player) {
    return this.grid.at(this.ctSpawnField, pl.pos) * this.secPerPx('CT', pl.weapon) + REACTION;
  }

  rotationTime(pl: Player, site: SiteId) {
    return this.grid.at(this.siteFields[site], pl.pos) * this.secPerPx('CT', pl.weapon);
  }

  analyze(board: BoardState, iterations = 1500): Analysis {
    const cts = board.players.filter(p => p.side === 'CT');
    const smokeR = SMOKE_RADIUS_UNITS / this.map.radar.scale;

    // ---- [1] static sight samples: which portal samples each CT can see, ignoring smokes
    const sight = new Map<string, Map<string, Vec2[]>>(); // chokeId -> playerId -> visible samples
    for (const c of this.map.chokepoints) {
      const per = new Map<string, Vec2[]>();
      const samples = portalSamples(c.portal);
      for (const pl of cts) {
        const f = this.facing(pl);
        const vis = samples.filter(s => inFov(pl.pos, f, s) && this.grid.lineOfSight(pl.pos, s));
        if (vis.length) per.set(pl.id, vis);
      }
      sight.set(c.id, per);
    }
    const ready = new Map(cts.map(p => [p.id, this.readyAt(p)]));

    const holdersAt = (chokeId: string, t: number, alive: Set<string>, smokes: SmokeDisc[]) => {
      const out: { id: string; frac: number; pos: Vec2 }[] = [];
      for (const [pid, vis] of sight.get(chokeId)!) {
        if (!alive.has(pid) || ready.get(pid)! > t) continue;
        const pos = cts.find(p => p.id === pid)!.pos;
        const seen = vis.filter(s => !smokes.some(sm => segmentHitsCircle(pos, s, sm.pos, sm.r))).length;
        const frac = seen / PORTAL_SAMPLES;
        if (frac >= 0.2) out.push({ id: pid, frac, pos });
      }
      return out;
    };

    // ---- [2..4] per-choke threat
    const allAlive = new Set(cts.map(p => p.id));
    const chokes: ChokeAnalysis[] = this.map.chokepoints.map(c => {
      const center = mid(c.portal);
      const arr = this.tArrival(center);
      const holders = holdersAt(c.id, Infinity, allAlive, activeSmokes(board.utility, arr.mean, this.map.radar.scale));
      const defenders = holders.map(h => ({ playerId: h.id, visibleFrac: h.frac, readyAt: ready.get(h.id)! }));
      const crossfire = crossfireScore(center, holders.map(h => h.pos));
      const holdReady = defenders.length ? Math.min(...defenders.map(d => d.readyAt)) : Infinity;
      const timeAdvantage = holdReady - arr.min;
      const reinforceTime = Math.min(...c.feeds.map(site => {
        const r = cts.map(p => this.rotationTime(p, site)).sort((a, b) => a - b);
        return (r[1] ?? Infinity) + INFO_DELAY;
      }));

      const reasons: string[] = [];
      let threat: number;
      if (!defenders.length) {
        reasons.push(`No CT has a sightline on ${c.name}. Ts get it for free at ~${arr.min.toFixed(1)}s.`);
        if (c.feeds.length > 1 || c.area === 'Mid') reasons.push('It connects to both sites, so Ts can split from here.');
        threat = 0.62 + (c.area === 'Mid' ? 0.18 : 0.08) + 0.15 * sig((reinforceTime - 8) / 2);
      } else {
        if (timeAdvantage > 0)
          reasons.push(`Ts arrive ${timeAdvantage.toFixed(1)}s before your hold is set (${arr.min.toFixed(1)}s vs ${holdReady.toFixed(1)}s).`);
        if (defenders.length === 1) reasons.push('Single holder: one trade or flash opens it.');
        else if (crossfire < 0.5) reasons.push('Holders are stacked on the same line; Ts can clear them one by one.');
        if (reinforceTime > 10) reasons.push(`Second CT needs ~${reinforceTime.toFixed(0)}s to help.`);
        threat =
          0.35 * sig(timeAdvantage) +
          0.3 * (defenders.length === 1 ? 1 : 1 - crossfire) * (defenders.length >= 3 ? 0.4 : 1) +
          0.2 * sig((reinforceTime - 8) / 2) +
          0.15 * (1 - Math.min(1, defenders.reduce((s, d) => s + d.visibleFrac, 0) / 2));
      }
      // CT utility timed for the Ts' arrival makes the push costlier
      const u = utilityOnChoke(board.utility, c, arr.min, arr.max + 3, this.map.radar.scale);
      if (u.flash) { threat *= 0.8; reasons.push(`Your flash pops on ${c.name} as Ts arrive: entry duels swing to you.`); }
      if (u.he) { threat *= 0.9; reasons.push(`HE on ${c.name} softens the first Ts through.`); }
      if (u.molly) { threat *= 0.85; reasons.push(`Molotov blocks ${c.name} while Ts arrive and delays the push.`); }
      return { choke: c, tArrival: arr, defenders, crossfire, timeAdvantage, reinforceTime, threat: clamp01(threat), reasons };
    });

    // ---- [5] Monte Carlo per strategy, [6] softmax with context prior
    const rng = mulberry32(1337);
    const ctx = board.context;
    const econDiff = ECON[ctx.economy.enemy] - ECON[ctx.economy.user];
    const scored = this.strats.map(a => {
      const sim = this.simulate(a, board, cts, ready, holdersAt, econDiff, iterations, rng);
      return { a, sim, prior: prior(a, ctx.economy.enemy, ctx.phase) };
    });
    const logits = scored.map(s => Math.log(s.prior) + this.beta * s.sim.successRate);
    const mx = Math.max(...logits);
    const ex = logits.map(l => Math.exp(l - mx));
    const Z = ex.reduce((a, b) => a + b, 0);
    const predictions = scored
      .map((s, i) => ({
        id: s.a.id, label: s.a.label, target: s.a.target,
        probability: ex[i] / Z, successRate: s.sim.successRate,
        firstContact: s.sim.firstContact, siteHitAt: s.sim.siteHitAt, counter: s.a.counter,
      }))
      .sort((x, y) => y.probability - x.probability);

    const summary = buildSummary(cts, chokes, predictions, this.map);
    return { chokes, predictions, summary };
  }

  private simulate(
    a: StrategyArchetype, board: BoardState, cts: Player[], ready: Map<string, number>,
    holdersAt: (c: string, t: number, alive: Set<string>, sm: SmokeDisc[]) => { id: string; frac: number; pos: Vec2 }[],
    econDiff: number, n: number, rng: () => number,
  ) {
    const late = board.context.phase === 'late' ? LATE_ROUND_DELAY : 0;
    const eco = board.context.economy.enemy === 'eco';
    const k = this.secPerPx('T', 'rifle');
    const scale = this.map.radar.scale;
    const chokeById = new Map(this.map.chokepoints.map(c => [c.id, c]));
    // per-spawn arrival tables for each choke in this strat
    const arrivals = new Map<string, number[]>();
    for (const g of a.groups) for (const c of g.route) if (!arrivals.has(c)) arrivals.set(c, this.tArrival(mid(chokeById.get(c)!.portal)).all);
    const toSite = (c: string) => this.grid.at(this.siteFields[a.target], mid(chokeById.get(c)!.portal)) * k;
    const rot = new Map(cts.map(p => [p.id, this.rotationTime(p, a.target)]));
    const mollies = board.utility.filter(u => u.type === 'molotov');
    const ctSmokes = board.utility.filter(u => u.type === 'smoke');

    let wins = 0;
    const contacts: { choke: string; t: number }[] = [];
    const hits: number[] = [];

    for (let it = 0; it < n; it++) {
      const alive = new Set(cts.map(p => p.id));
      let rotateAt = Infinity;
      const groups = a.groups.map(g => ({
        g, alive: g.size,
        util: eco ? [] : g.util,
        spawn: Math.floor(rng() * this.map.spawns.T.length),
        delay: g.delay + late + Math.abs(gaussian(rng)) * 0.8,
        step: 0, t: 0, done: false, stalled: false,
      }));
      let firstContact: { choke: string; t: number } | null = null;

      // Advance groups through their routes in global time order.
      for (;;) {
        let next: (typeof groups)[number] | null = null;
        for (const gr of groups) {
          if (gr.done || gr.stalled || gr.alive <= 0) continue;
          gr.t = arrivals.get(gr.g.route[gr.step])![gr.spawn] + gr.delay;
          if (!next || gr.t < next.t) next = gr;
        }
        if (!next) break;
        const chokeId = next.g.route[next.step];
        const c = chokeById.get(chokeId)!;
        let t = next.t;
        // CT molotov on the choke: Ts wait it out
        const molly = mollies.find(m => segmentHitsCircle(c.portal[0], c.portal[1], m.pos, 120 / scale) && t >= popAt(m) && t <= popAt(m) + MOLLY_DURATION);
        if (molly) { next.delay += popAt(molly) + MOLLY_DURATION - t + 0.3; continue; }
        // CT smoke on the choke: half the time Ts wait for it to fade
        const smoke = ctSmokes.find(s => segmentHitsCircle(c.portal[0], c.portal[1], s.pos, SMOKE_RADIUS_UNITS / scale) && t >= popAt(s) && t <= popAt(s) + SMOKE_DURATION);
        if (smoke && rng() < 0.5) { next.delay += popAt(smoke) + SMOKE_DURATION - t + 0.3; continue; }

        // CTs who already left to rotate no longer hold anything
        const holdingAlive = new Set([...alive].filter(id => rotateAt + INFO_DELAY > t || rot.get(id)! < 1.5));
        let holders = holdersAt(chokeId, t, holdingAlive, activeSmokes(board.utility, t, scale));
        if (holders.length && next.util.includes('smoke') && rng() < 0.6) holders = holders.slice(1); // T smoke blinds one angle
        if (holders.length) {
          if (!firstContact) firstContact = { choke: chokeId, t };
          rotateAt = Math.min(rotateAt, t);
          const cf = crossfireScore(mid(c.portal), holders.map(h => h.pos));
          let d = holders.length;
          for (let ex = 0; ex < 4 && d > 0 && next.alive > 0; ex++) {
            const u = utilityOnChoke(board.utility, c, t - 2.5, t, scale);
            // CT flash blinds the entry, HE softens it
            const p = duelWinProb(Math.min(next.alive, 2), d, d >= 2 ? cf : 0, next.util.includes('flash'), econDiff)
              * (u.flash ? 0.4 : 1) * (u.he ? 0.8 : 1);
            if (rng() < p) { alive.delete(holders[holders.length - d].id); d--; } else next.alive--;
          }
          if (d > 0 && next.alive > 0) { next.stalled = true; continue; }
        }
        next.step++;
        if (next.step >= next.g.route.length) {
          next.done = true;
          next.t = t + toSite(chokeId);
        }
      }
      if (firstContact) contacts.push(firstContact);

      const arrived = groups.filter(g => g.done && g.alive > 0);
      let tAlive = arrived.reduce((s, g) => s + g.alive, 0);
      if (!tAlive) continue;
      const hitAt = Math.max(...arrived.map(g => g.t));
      hits.push(hitAt);
      if (!isFinite(rotateAt)) rotateAt = Math.min(...arrived.map(g => g.t)); // first sight is the hit itself
      const infoAt = rotateAt + INFO_DELAY;

      // Defenders on site at hit time, then post-plant retake by late rotators.
      const onSite: string[] = [], lateRot: string[] = [];
      for (const id of alive) {
        const r = rot.get(id)!;
        if (r < 1.5) onSite.push(id);
        else if (infoAt + r <= hitAt + 2) onSite.push(id);
        else lateRot.push(id);
      }
      let d = onSite.length;
      while (d > 0 && tAlive > 0) {
        if (rng() < duelWinProb(tAlive, d, d >= 2 ? 0.4 : 0, false, econDiff)) d--; else tAlive--;
      }
      if (!tAlive) continue;
      let r = lateRot.length;
      while (r > 0 && tAlive > 0) {
        if (rng() < duelWinProb(tAlive, r, 0, false, econDiff) + 0.25) r--; else tAlive--; // post-plant edge
      }
      if (tAlive > 0) wins++;
    }

    return {
      successRate: wins / n,
      firstContact: mode(contacts),
      siteHitAt: hits.length ? median(hits) : null,
    };
  }
}

/** Which CT grenades affect a chokepoint between round times `from` and `to`. */
export function utilityOnChoke(util: BoardState['utility'], c: Chokepoint, from: number, to: number, scale: number) {
  const near = (pos: Vec2, units: number) => segmentHitsCircle(c.portal[0], c.portal[1], pos, units / scale);
  return {
    flash: util.some(u => u.type === 'flash' && popAt(u) >= from - 2.4 && popAt(u) <= to && near(u.pos, 500)),
    he: util.some(u => u.type === 'he' && popAt(u) >= from - 3 && popAt(u) <= to && near(u.pos, 300)),
    molly: util.some(u => u.type === 'molotov' && popAt(u) <= to && popAt(u) + MOLLY_DURATION >= from && near(u.pos, 150)),
  };
}

/** CS2's horizontal field of view at 16:9. */
export const FOV = (106 * Math.PI) / 180;

export function inFov(from: Vec2, facing: number, to: Vec2, fov = FOV) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const d = Math.atan2(Math.sin(a - facing), Math.cos(a - facing));
  return Math.abs(d) <= fov / 2;
}

/** Logistic fight model; coefficients hand-tuned until fitted on demo data. */
export function duelWinProb(attackers: number, defenders: number, crossfire: number, flash: boolean, econDiff: number) {
  const z = -0.6 + 0.4 * (attackers - defenders) - 0.7 * crossfire + (flash ? 0.5 : 0) + 0.8 * econDiff;
  return 1 / (1 + Math.exp(-z));
}

/** 0 when defenders sit on one line from the portal, 1 at a 90° L-crossfire. */
export function crossfireScore(target: Vec2, pos: Vec2[]) {
  let best = 0;
  for (let i = 0; i < pos.length; i++)
    for (let j = i + 1; j < pos.length; j++) {
      const a = Math.atan2(pos[i].y - target.y, pos[i].x - target.x);
      const b = Math.atan2(pos[j].y - target.y, pos[j].x - target.x);
      best = Math.max(best, Math.abs(Math.sin(a - b)));
    }
  return best;
}

function buildSummary(cts: Player[], chokes: ChokeAnalysis[], preds: StrategyPrediction[], map: MapDefinition) {
  const out: string[] = [];
  if (!cts.length) return ['Place CT players to get an analysis.'];
  // each player counts once, toward the closer site (Nuke's sites overlap on the flat radar)
  const closer = (p: Player) => (dist(p.pos, map.sites.A.center) <= dist(p.pos, map.sites.B.center) ? 'A' : 'B');
  const nearA = cts.filter(p => closer(p) === 'A' && dist(p.pos, map.sites.A.center) < 200).length;
  const nearB = cts.filter(p => closer(p) === 'B' && dist(p.pos, map.sites.B.center) < 200).length;
  out.push(`Setup: ${nearA} near A, ${nearB} near B, ${cts.length - nearA - nearB} elsewhere.`);
  const worst = [...chokes].sort((a, b) => b.threat - a.threat)[0];
  if (worst && worst.threat > 0.55) out.push(`Biggest hole: ${worst.choke.name} (${Math.round(worst.threat * 100)}% threat).`);
  if (preds[0]) out.push(`Most likely T play: ${preds[0].label} (${Math.round(preds[0].probability * 100)}%).`);
  return out;
}

const portalSamples = ([a, b]: [Vec2, Vec2]) =>
  Array.from({ length: PORTAL_SAMPLES }, (_, i) => {
    const t = (i + 0.5) / PORTAL_SAMPLES;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
const mid = ([a, b]: [Vec2, Vec2]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
function mode(cs: { choke: string; t: number }[]) {
  if (!cs.length) return null;
  const count = new Map<string, number[]>();
  for (const c of cs) (count.get(c.choke) ?? count.set(c.choke, []).get(c.choke)!).push(c.t);
  const [choke, ts] = [...count.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  return { choke, t: median(ts) };
}

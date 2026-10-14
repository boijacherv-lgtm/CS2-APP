import { activeSmokes, MOLLY_DURATION, popAt } from './grid';
import { FOV, inFov, type TacticalEngine } from './predict';
import { mulberry32 } from './rng';
import { bakeRoute, type BakedRoute } from './timeline';
import type { BoardState, Player, Vec2, Weapon } from './types';

/**
 * Round simulation with fights. Players walk their routes; when an enemy is inside their
 * view cone with clear line of sight they stop and shoot. Kills are drawn from a hazard
 * rate (chance per second to land the kill), so crossfires and long angles emerge naturally.
 */

export const SIM_DT = 0.1;
export const MAX_RANGE_PX = 1100;
export const FLASH_POP = 1.2; // seconds after the throw
const FLASH_RADIUS_PX = 140;
export const FLASH_BLIND = 2.4; // seconds when looking at it
export const HE_POP = 1.6;
export const HE_RADIUS_U = 350;
const HE_MAX_DMG = 57; // vs armour
const MOLLY_R_U = 120;
const MOLLY_DPS = 40;
export const PEEKER_EDGE = 0.12;
export const TURN_AFTER = 0.6; // seconds of being shot at before you turn toward the shooter

/** Kills per second while the shooter has a stable sight on the target, before modifiers. */
export const HAZARD: Record<Weapon, number> = { rifle: 2.6, awp: 3.2, smg: 2.3, pistol: 1.5 };

export interface KillEvent {
  t: number;
  killer: string; // '' for utility kills
  victim: string;
  at: Vec2;
  cause: 'gun' | 'he' | 'molotov';
}

/** Something utility did to a player: blinded (amount = seconds) or damaged (amount = hp). */
export interface UtilEvent {
  t: number;
  kind: 'blind' | 'he' | 'burn';
  id: string;
  amount: number;
  /** The grenade that did it. */
  src: string;
}

export interface Simulation {
  end: number;
  steps: number;
  ids: string[];
  /** Per player, per step. */
  x: Float32Array[];
  y: Float32Array[];
  facing: Float32Array[];
  deathT: number[]; // Infinity = survived
  kills: KillEvent[];
  /** Per player, per step: health and whether they are blind. */
  hp: Uint8Array[];
  blind: Uint8Array[];
  utilEvents: UtilEvent[];
}

interface Agent {
  p: Player;
  route: BakedRoute | null;
  progress: number; // seconds of walking done along the route
  pos: Vec2;
  facing: number;
  moving: boolean;
  alive: boolean;
  blindUntil: number;
  hp: number;
  /** Who has been shooting at me, and since when. */
  threatenedBy: Map<number, number>;
}

export function simulate(engine: TacticalEngine, board: BoardState, end: number, seed: number): Simulation {
  const rng = mulberry32(seed);
  const g = engine.grid;
  const agents: Agent[] = board.players.map(p => ({
    p, route: bakeRoute(engine, p), progress: 0, pos: p.pos, facing: p.facing ?? engine.facing(p),
    moving: false, alive: true, blindUntil: -1, hp: 100, threatenedBy: new Map(),
  }));
  const n = agents.length;
  const steps = Math.max(1, Math.ceil(end / SIM_DT) + 1);
  const sim: Simulation = {
    end, steps, ids: agents.map(a => a.p.id),
    x: agents.map(() => new Float32Array(steps)), y: agents.map(() => new Float32Array(steps)),
    facing: agents.map(() => new Float32Array(steps)), deathT: agents.map(() => Infinity), kills: [],
    hp: agents.map(() => new Uint8Array(steps)), blind: agents.map(() => new Uint8Array(steps)), utilEvents: [],
  };
  // Directed sight: how long viewer i has had target j in sight, and the reaction they need.
  const seenFor = new Float32Array(n * n);
  const reaction = new Float32Array(n * n);
  const flashes = board.utility.filter(u => u.type === 'flash').map(u => ({ id: u.id, pos: u.pos, pop: popAt(u), done: false }));
  const pxToUnits = engine.map.radar.scale;
  const hes = board.utility.filter(u => u.type === 'he').map(u => ({ id: u.id, pos: u.pos, pop: popAt(u), done: false }));
  const mollies = board.utility.filter(u => u.type === 'molotov').map(u => ({ id: u.id, pos: u.pos, from: popAt(u), to: popAt(u) + MOLLY_DURATION }));
  const burnEvent = new Map<string, UtilEvent>();
  const kill = (j: number, t: number, killer: string, cause: KillEvent['cause']) => {
    const b = agents[j];
    b.alive = false;
    sim.deathT[j] = t;
    sim.kills.push({ t, killer, victim: b.p.id, at: { ...b.pos }, cause });
  };

  for (let s = 0; s < steps; s++) {
    const t = s * SIM_DT;
    const smokes = activeSmokes(board.utility, t, pxToUnits);

    // 1. Flashes pop: anyone with sight of the flash is blinded (longer if looking at it).
    for (const f of flashes) {
      if (f.done || t < f.pop) continue;
      f.done = true;
      for (const a of agents) {
        if (!a.alive || Math.hypot(a.pos.x - f.pos.x, a.pos.y - f.pos.y) > FLASH_RADIUS_PX * 4) continue;
        if (!g.lineOfSight(a.pos, f.pos, smokes)) continue;
        const secs = inFov(a.pos, a.facing, f.pos) ? FLASH_BLIND : 0.5;
        a.blindUntil = Math.max(a.blindUntil, t + secs);
        sim.utilEvents.push({ t, kind: 'blind', id: a.p.id, amount: secs, src: f.id });
      }
    }

    // 1b. HE grenades: damage falls off with distance; walls block it.
    for (const h of hes) {
      if (h.done || t < h.pop) continue;
      h.done = true;
      agents.forEach((a, j) => {
        if (!a.alive) return;
        const d = dist(a.pos, h.pos) * pxToUnits;
        if (d > HE_RADIUS_U || !g.lineOfSight(a.pos, h.pos)) return;
        const dmg = Math.round(HE_MAX_DMG * (1 - d / HE_RADIUS_U));
        if (dmg <= 0) return;
        a.hp -= dmg;
        sim.utilEvents.push({ t, kind: 'he', id: a.p.id, amount: dmg, src: h.id });
        if (a.hp <= 0) kill(j, t, '', 'he');
      });
    }

    // 1c. Molotovs burn whoever stands in them.
    for (const m of mollies) {
      if (t < m.from || t > m.to) continue;
      agents.forEach((a, j) => {
        if (!a.alive || dist(a.pos, m.pos) * pxToUnits > MOLLY_R_U) return;
        const dmg = MOLLY_DPS * SIM_DT;
        a.hp -= dmg;
        const key = `${a.p.id}@${m.from}`;
        const ev = burnEvent.get(key);
        if (ev) ev.amount += dmg;
        else { const e = { t, kind: 'burn' as const, id: a.p.id, amount: dmg, src: m.id }; burnEvent.set(key, e); sim.utilEvents.push(e); }
        if (a.hp <= 0) kill(j, t, '', 'molotov');
      });
    }

    // 2. Who sees whom.
    const sees: number[][] = agents.map(() => []);
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      for (let j = 0; j < n; j++) {
        const b = agents[j];
        const k = i * n + j;
        const visible = a.alive && b.alive && a.p.side !== b.p.side && t >= a.blindUntil
          && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) <= MAX_RANGE_PX
          && inFov(a.pos, a.facing, b.pos, FOV) && g.lineOfSight(a.pos, b.pos, smokes);
        if (!visible) { seenFor[k] = 0; continue; }
        if (seenFor[k] === 0) {
          // pre-aimed holders react faster than someone running around a corner
          const preAimed = !a.moving && Math.abs(angleDiff(a.facing, heading(a.pos, b.pos))) < 0.26;
          // peeker's advantage: a holder sees someone swinging wide ~0.1 s late
          const peeked = b.moving && !a.moving ? PEEKER_EDGE : 0;
          reaction[k] = (preAimed ? 0.12 : 0.22) + peeked + rng() * 0.22;
        }
        seenFor[k] += SIM_DT;
        sees[i].push(j);
        b.threatenedBy.set(i, b.threatenedBy.get(i) ?? t);
      }
    }
    agents.forEach((b, j) => {
      for (const i of [...b.threatenedBy.keys()]) if (!agents[i].alive || !sees[i].includes(j)) b.threatenedBy.delete(i);
    });

    // 3. Shots: each viewer past their reaction rolls for a kill on their closest target.
    const order = [...Array(n).keys()].sort(() => rng() - 0.5);
    for (const i of order) {
      const a = agents[i];
      if (!a.alive || !sees[i].length) continue;
      const targets = sees[i].filter(j => agents[j].alive && seenFor[i * n + j] >= reaction[i * n + j]);
      if (!targets.length) continue;
      const j = targets.reduce((best, c) => (dist(a.pos, agents[c].pos) < dist(a.pos, agents[best].pos) ? c : best));
      const b = agents[j];
      const d = dist(a.pos, b.pos) * pxToUnits;
      const range = rangeFactor(a.p.weapon, d);
      // hurt players go down to fewer bullets; blind ones can't dodge or fight back
      const hurt = b.hp <= 30 ? 2 : b.hp <= 70 ? 1.4 : 1;
      const blindTarget = t < b.blindUntil ? 1.3 : 1;
      const h = HAZARD[a.p.weapon] * range * (a.moving ? 0.35 : 1) * (b.moving ? 0.85 : 1) * hurt * blindTarget;
      if (rng() < 1 - Math.exp(-h * SIM_DT)) kill(j, t, a.p.id, 'gun');
    }

    // 4. Move and turn.
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      if (a.alive) {
        const enemies = sees[i].filter(j => agents[j].alive);
        const engaged = enemies.length > 0;
        const r = a.route;
        a.moving = false;
        if (r && t >= r.start && !engaged && a.progress < r.end - r.start) {
          a.progress = Math.min(r.end - r.start, a.progress + SIM_DT);
          a.moving = true;
        }
        const st = r ? routeAt(r, r.start + a.progress) : null;
        if (st) a.pos = st.pos;
        // a player holding still inside a burning molotov steps out of it
        const fire = !a.moving && !engaged && mollies.find(m => t >= m.from && t <= m.to && dist(a.pos, m.pos) * pxToUnits <= MOLLY_R_U);
        if (fire) {
          const ang = Math.atan2(a.pos.y - fire.pos.y, a.pos.x - fire.pos.x) || 0;
          const step = SIM_DT / engine.secPerPx(a.p.side, a.p.weapon);
          const next = { x: a.pos.x + Math.cos(ang) * step, y: a.pos.y + Math.sin(ang) * step };
          if (g.isWalkable(next)) { a.pos = next; a.moving = true; }
        }
        if (engaged) {
          const j = enemies.reduce((best, c) => (dist(a.pos, agents[c].pos) < dist(a.pos, agents[best].pos) ? c : best));
          a.facing = heading(a.pos, agents[j].pos);
        } else {
          // being shot from outside my view: turn toward the shooter after a moment
          const shooter = [...a.threatenedBy].find(([, since]) => t - since >= TURN_AFTER);
          if (shooter) a.facing = heading(a.pos, agents[shooter[0]].pos);
          else if (a.moving && st) a.facing = st.heading;
          else if (r && a.progress > 0 && st) a.facing = st.heading;
        }
      }
      sim.x[i][s] = a.pos.x;
      sim.y[i][s] = a.pos.y;
      sim.facing[i][s] = a.facing;
      sim.hp[i][s] = Math.max(0, Math.round(a.hp));
      sim.blind[i][s] = a.alive && t < a.blindUntil ? 1 : 0;
    }
  }
  return sim;
}

export interface SimState { pos: Vec2; facing: number; alive: boolean; deathT: number; hp: number; blind: boolean }

export function simStateAt(sim: Simulation, id: string, t: number): SimState | null {
  const i = sim.ids.indexOf(id);
  if (i < 0) return null;
  const s = Math.max(0, Math.min(sim.steps - 1, Math.floor(t / SIM_DT)));
  const s2 = Math.min(sim.steps - 1, s + 1);
  const f = Math.max(0, Math.min(1, t / SIM_DT - s));
  const alive = t < sim.deathT[i];
  const k = alive ? f : 0;
  return {
    pos: { x: sim.x[i][s] + (sim.x[i][s2] - sim.x[i][s]) * k, y: sim.y[i][s] + (sim.y[i][s2] - sim.y[i][s]) * k },
    facing: sim.facing[i][s],
    alive,
    deathT: sim.deathT[i],
    hp: sim.hp[i][s],
    blind: sim.blind[i][s] === 1,
  };
}

/** Living players at round time t, at their simulated positions. */
export function simPlayersAt(sim: Simulation, players: Player[], t: number): Player[] {
  const out: Player[] = [];
  for (const p of players) {
    const st = simStateAt(sim, p.id, t);
    if (!st) out.push(p);
    else if (st.alive) out.push({ ...p, pos: st.pos, facing: st.facing });
  }
  return out;
}

function routeAt(r: BakedRoute, t: number) {
  const { pts, times } = r;
  if (t >= r.end) return { pos: pts[pts.length - 1], heading: heading(pts[pts.length - 2], pts[pts.length - 1]) };
  let i = 1;
  while (times[i] < t) i++;
  const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
  const a = pts[i - 1], b = pts[i];
  return { pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, heading: heading(a, b) };
}

/** Accuracy falloff with distance (world units); AWPs don't care. */
export const rangeFactor = (w: Weapon, units: number) => (w === 'awp' ? 1 : clamp(1 - (units - 1200) / 3000, 0.35, 1));

const heading = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

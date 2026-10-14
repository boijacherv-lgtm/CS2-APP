import { FLASH_POP, HE_POP, SIM_DT, type KillEvent, type Simulation } from './combat';
import { computeControl } from './control';
import { worldToRadar } from './coords';
import { UTIL_FLIGHT } from './grid';
import type { TacticalEngine } from './predict';
import type { BoardState, Player, Side, Utility, UtilType, Vec2 } from './types';

/**
 * Round review: replays a real round from a demo and grades what each player did, chess-style.
 * Win probability ("eval") is estimated every second from players alive, health, bomb state,
 * time left and map control; every kill, death and flash is graded by how much it moved it.
 */

// ---- demo data (shape produced by tools/demo.mjs) -------------------------------------------

export interface DemoRound {
  n: number;
  winner: Side | null;
  reason: string;
  duration: number;
  plant: number | null;
  frames: { t: number[]; players: Record<string, { side: Side; x: number[]; y: number[]; z: number[]; yaw: number[]; hp: number[]; alive: number[] }> };
  kills: { t: number; attacker: string; victim: string; weapon: string; headshot: boolean; x: number; y: number; ax: number; ay: number }[];
  util: { t: number; type: UtilType; thrower: string; x: number; y: number }[];
  blind: { t: number; victim: string; attacker: string; dur: number }[];
}

export interface DemoData {
  map: string;
  tickrate: number;
  names: Record<string, string>;
  rounds: DemoRound[];
}

// ---- replay -----------------------------------------------------------------------------------

export interface Replay {
  board: BoardState;
  sim: Simulation;
  names: Record<string, string>;
  round: DemoRound;
}

const POP: Record<UtilType, number> = { smoke: UTIL_FLIGHT, molotov: UTIL_FLIGHT, flash: FLASH_POP, he: HE_POP };

/** Builds a board + simulation-shaped replay so the normal board, kill feed and map control work. */
export function buildReplay(engine: TacticalEngine, demo: DemoData, roundIdx: number, context: BoardState['context']): Replay {
  const r = demo.rounds[roundIdx];
  const toR = (x: number, y: number) => worldToRadar({ x, y }, engine.map.radar);
  const ids = Object.keys(r.frames.players);
  const shortName = (id: string) => (demo.names[id] ?? id).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3) || '?';

  const steps = Math.max(1, Math.ceil(r.duration / SIM_DT) + 1);
  const sim: Simulation = {
    end: r.duration, steps, ids,
    x: ids.map(() => new Float32Array(steps)), y: ids.map(() => new Float32Array(steps)),
    facing: ids.map(() => new Float32Array(steps)), deathT: ids.map(() => Infinity), kills: [],
    hp: ids.map(() => new Uint8Array(steps)), blind: ids.map(() => new Uint8Array(steps)), utilEvents: [],
  };
  const ft = r.frames.t;
  ids.forEach((id, i) => {
    const f = r.frames.players[id];
    let k = 0;
    for (let s = 0; s < steps; s++) {
      const t = s * SIM_DT;
      while (k < ft.length - 2 && ft[k + 1] <= t) k++;
      const a = Math.max(0, Math.min(1, (t - ft[k]) / ((ft[k + 1] ?? ft[k]) - ft[k] || 1)));
      const lerp = (arr: number[]) => arr[k] + ((arr[k + 1] ?? arr[k]) - arr[k]) * a;
      const p = toR(lerp(f.x), lerp(f.y));
      sim.x[i][s] = p.x; sim.y[i][s] = p.y;
      sim.facing[i][s] = (-f.yaw[k] * Math.PI) / 180; // world yaw is counter-clockwise, radar y points down
      sim.hp[i][s] = Math.max(0, Math.min(100, f.hp[k]));
      if (!f.alive[k] && !Number.isFinite(sim.deathT[i])) sim.deathT[i] = ft[k];
    }
  });

  for (const k of r.kills) {
    const v = ids.indexOf(k.victim);
    if (v < 0) continue;
    sim.deathT[v] = Math.min(sim.deathT[v], k.t);
    const w = k.weapon.toLowerCase();
    const cause: KillEvent['cause'] = w.includes('hegrenade') ? 'he' : w.includes('inferno') || w.includes('molotov') ? 'molotov' : 'gun';
    sim.kills.push({ t: k.t, killer: ids.includes(k.attacker) && k.attacker !== k.victim ? k.attacker : '', victim: k.victim, at: toR(k.x, k.y), cause });
  }
  sim.kills.sort((a, b) => a.t - b.t);

  const utility: Utility[] = r.util.map((u, i) => ({ id: `u${i}`, type: u.type, pos: toR(u.x, u.y), throwAt: Math.max(0, u.t - POP[u.type]) }));
  for (const b of r.blind) {
    const v = ids.indexOf(b.victim);
    if (v < 0 || !(b.dur > 0)) continue;
    for (let s = Math.floor(b.t / SIM_DT); s < Math.min(steps, Math.ceil((b.t + b.dur) / SIM_DT)); s++) sim.blind[v][s] = 1;
    const src = r.util.findIndex(u => u.type === 'flash' && u.thrower === b.attacker && Math.abs(u.t - b.t) < 0.5);
    sim.utilEvents.push({ t: b.t, kind: 'blind', id: b.victim, amount: b.dur, src: src >= 0 ? `u${src}` : '' });
  }

  const players: Player[] = ids.map((id, i) => {
    const s = r.frames.players[id].side;
    return { id, side: s, pos: { x: sim.x[i][0], y: sim.y[i][0] }, weapon: 'rifle', label: shortName(id) };
  });
  return { board: { players, utility, context }, sim, names: demo.names, round: r };
}

// ---- evaluation ---------------------------------------------------------------------------------

const ROUND_TIME = 115;
const BOMB_TIME = 40;

/** CT win probability from the state of the round at time t. */
export function evalState(state: { ct: number; t: number; ctHp: number; tHp: number; ctMap: number; tMap: number; planted: number | null; time: number }): number {
  const { ct, t } = state;
  if (t === 0 && state.planted === null) return 1;
  if (ct === 0) return 0;
  if (t === 0 && state.planted !== null) return 0.25; // retake vs bomb timer with nobody to stop the defuse attempt
  const diff = ct - t;
  let z = 0.55 * diff + (0.35 * diff) / Math.max(1, Math.min(ct, t)); // man advantage matters more when few are left
  z += 0.004 * (state.ctHp - state.tHp);
  z += 0.9 * (state.ctMap - state.tMap);
  if (state.planted !== null) z -= 0.9 + 0.035 * Math.max(0, state.time - state.planted); // defuse gets harder as the timer runs
  else z += Math.max(0, state.time - (ROUND_TIME - 25)) * 0.07; // Ts running out of time to plant
  return 1 / (1 + Math.exp(-z));
}

export type Grade = 'brilliant' | 'great' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'blunder';
export const GRADE_INFO: Record<Grade, { mark: string; label: string; color: string }> = {
  brilliant: { mark: '!!', label: 'Brilliant', color: '#1bc6c6' },
  great: { mark: '!', label: 'Great', color: '#5c8bd6' },
  good: { mark: '✓', label: 'Good', color: '#7fbf4d' },
  book: { mark: '·', label: 'Book', color: '#a39b8f' },
  inaccuracy: { mark: '?!', label: 'Inaccuracy', color: '#f0c33c' },
  mistake: { mark: '?', label: 'Mistake', color: '#e58f2a' },
  blunder: { mark: '??', label: 'Blunder', color: '#e5483a' },
};

export interface Move {
  t: number;
  player: string;
  side: Side;
  kind: 'kill' | 'death' | 'flash' | 'utility';
  /** Change in this player's team win chance (e.g. +0.12 = +12%). */
  gain: number;
  grade: Grade;
  title: string;
  why: string[];
}

export interface Review {
  curve: { t: number; ct: number }[];
  moves: Move[];
  players: Record<string, { impact: number; counts: Record<Grade, number> }>;
  turningPoint: Move | null;
}

function grade(gain: number, special: boolean): Grade {
  if (gain >= 0.15 && special) return 'brilliant';
  if (gain >= 0.1) return 'great';
  if (gain >= 0.03) return 'good';
  if (gain > -0.03) return 'book';
  if (gain > -0.08) return 'inaccuracy';
  if (gain > -0.15) return 'mistake';
  return 'blunder';
}

/** Full review of a replayed round. */
export function reviewRound(engine: TacticalEngine, rep: Replay): Review {
  const { sim, board, round: r, names } = rep;
  const g = engine.grid;
  const scale = engine.map.radar.scale;
  const sideOf = new Map(board.players.map(p => [p.id, p.side]));
  const name = (id: string) => names[id] ?? id;
  const idx = (id: string) => sim.ids.indexOf(id);
  const posAt = (i: number, t: number): Vec2 => { const s = Math.min(sim.steps - 1, Math.max(0, Math.round(t / SIM_DT))); return { x: sim.x[i][s], y: sim.y[i][s] }; };
  const alive = (i: number, t: number) => t < sim.deathT[i];
  const hpAt = (i: number, t: number) => sim.hp[i][Math.min(sim.steps - 1, Math.max(0, Math.round(t / SIM_DT)))];

  // map control once a second (the expensive part), interpolated in between
  const control: { t: number; ct: number; tt: number }[] = [];
  for (let t = 0; t <= r.duration; t += 1) {
    const c = computeControl(engine, board, t, sim);
    control.push({ t, ct: c.share.ct, tt: c.share.t });
  }
  const mapAt = (t: number) => control[Math.min(control.length - 1, Math.max(0, Math.round(t)))];

  const stateAt = (t: number) => {
    let ct = 0, tt = 0, ctHp = 0, tHp = 0;
    sim.ids.forEach((id, i) => {
      if (!alive(i, t)) return;
      if (sideOf.get(id) === 'CT') { ct++; ctHp += hpAt(i, t); } else { tt++; tHp += hpAt(i, t); }
    });
    const m = mapAt(t);
    return evalState({ ct, t: tt, ctHp, tHp, ctMap: m.ct, tMap: m.tt, planted: r.plant !== null && t >= r.plant ? r.plant : null, time: t });
  };

  const curve: Review['curve'] = [];
  for (let t = 0; t <= r.duration + 0.01; t += 0.5) curve.push({ t, ct: stateAt(t) });

  const moves: Move[] = [];
  const forSide = (s: Side, ctDelta: number) => (s === 'CT' ? ctDelta : -ctDelta);
  const enemiesSeeing = (i: number, t: number, exclude?: number) => {
    const me = posAt(i, t), mySide = sideOf.get(sim.ids[i]);
    return sim.ids.filter((id, j) => j !== exclude && sideOf.get(id) !== mySide && alive(j, t - 0.05) && Math.hypot(posAt(j, t).x - me.x, posAt(j, t).y - me.y) < 1100 && g.lineOfSight(posAt(j, t), me)).length;
  };
  const teammatesNear = (i: number, t: number) => {
    const me = posAt(i, t), mySide = sideOf.get(sim.ids[i]);
    return sim.ids.filter((id, j) => j !== i && sideOf.get(id) === mySide && alive(j, t - 0.05)
      && (Math.hypot(posAt(j, t).x - me.x, posAt(j, t).y - me.y) * scale < 600 || g.lineOfSight(posAt(j, t), me))).length;
  };
  const where = (p: Vec2) => {
    let best = '', bd = 110;
    for (const c of engine.map.callouts) { const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y); if (d < bd) { bd = d; best = c.name; } }
    return best ? ` at ${best}` : '';
  };

  sim.kills.forEach((k, n) => {
    const before = stateAt(k.t - 0.05), after = stateAt(k.t + 0.05);
    const ctDelta = after - before;
    const vi = idx(k.victim);
    const vSide = sideOf.get(k.victim)!;
    const firstKill = n === 0;

    // the victim
    const traded = k.killer && sim.kills.some(o => o.victim === k.killer && o.t > k.t && o.t - k.t <= 5 && sideOf.get(o.killer) === vSide);
    const seers = vi >= 0 ? enemiesSeeing(vi, k.t - 0.1) : 0;
    const support = vi >= 0 ? teammatesNear(vi, k.t - 0.1) : 0;
    const wasBlind = vi >= 0 && sim.blind[vi][Math.max(0, Math.round((k.t - 0.1) / SIM_DT))] === 1;
    const hpBefore = vi >= 0 ? hpAt(vi, k.t - 0.4) : 100;
    let loss = forSide(vSide, ctDelta);
    const why: string[] = [`${vSide} win chance ${pct(vSide === 'CT' ? before : 1 - before)} → ${pct(vSide === 'CT' ? after : 1 - after)}.`];
    if (traded) { loss *= 0.4; why.push('Traded by a teammate, so the death bought information and space.'); }
    else if (support === 0) why.push('No teammate close enough to trade: an isolated death.');
    if (seers >= 2) why.push(`Exposed to ${seers} enemies at once (crossfire).`);
    if (wasBlind) why.push('Was flashed when it happened.');
    if (hpBefore < 50 && hpBefore > 0) why.push(`Already hurt (${hpBefore} hp) before the duel.`);
    if (k.cause !== 'gun') why.push(k.cause === 'he' ? 'Killed by an HE grenade.' : 'Burned by a molotov: stood in fire.');
    if (firstKill) why.push('First death of the round (lost the opening duel).');
    moves.push({
      t: k.t, player: k.victim, side: vSide, kind: 'death', gain: loss, grade: grade(loss, false),
      title: `${name(k.victim)} died${where(k.at)}`, why,
    });

    // the killer
    if (k.killer) {
      const ai = idx(k.killer);
      const aSide = sideOf.get(k.killer)!;
      const gain = forSide(aSide, ctDelta);
      const others = ai >= 0 ? enemiesSeeing(ai, k.t - 0.05, vi) : 0;
      const multi = sim.kills.filter(o => o.killer === k.killer && Math.abs(o.t - k.t) <= 6).length;
      const special = others >= 1 || multi >= 3 || (firstKill && aSide === 'T');
      const awhy = [`${aSide} win chance ${pct(aSide === 'CT' ? before : 1 - before)} → ${pct(aSide === 'CT' ? after : 1 - after)}.`];
      if (firstKill) awhy.push('Opening kill.');
      if (others >= 1) awhy.push(`Won it while ${others} more enemy${others > 1 ? 'ies' : ''} had sight on them.`);
      if (multi >= 2) awhy.push(`Part of a ${multi}-kill burst.`);
      if (vi >= 0 && wasBlind) awhy.push('The victim was flashed: teamwork kill.');
      moves.push({
        t: k.t, player: k.killer, side: aSide, kind: 'kill', gain, grade: grade(gain, special),
        title: `${name(k.killer)} killed ${name(k.victim)}${where(k.at)}`, why: awhy,
      });
    }
  });

  // flashes: enemies blinded, teammates blinded, and whether it led to a kill
  r.util.forEach((u, ui) => {
    if (!u.thrower || !sideOf.has(u.thrower)) return;
    const s = sideOf.get(u.thrower)!;
    if (u.type !== 'flash') {
      moves.push({
        t: u.t, player: u.thrower, side: s, kind: 'utility', gain: 0, grade: 'book',
        title: `${name(u.thrower)}: ${u.type === 'molotov' ? 'molotov' : u.type === 'he' ? 'HE grenade' : 'smoke'}${where(worldToRadar({ x: u.x, y: u.y }, engine.map.radar))}`,
        why: ['Utility used (graded through the fights it affects).'],
      });
      return;
    }
    const hits = sim.utilEvents.filter(e => e.src === `u${ui}` && e.amount >= 0.7);
    const enemy = hits.filter(e => sideOf.get(e.id) !== s), team = hits.filter(e => sideOf.get(e.id) === s);
    const assisted = enemy.filter(e => sim.kills.some(k => k.victim === e.id && k.t >= e.t && k.t - e.t <= 3));
    const gain = 0.035 * Math.min(3, enemy.length) + 0.06 * assisted.length - 0.05 * team.length;
    const why = [];
    if (enemy.length) why.push(`Blinded ${enemy.length} enemy${enemy.length > 1 ? 'ies' : ''} (${enemy.map(e => e.amount.toFixed(1) + 's').join(', ')}).`);
    if (assisted.length) why.push(`${assisted.length} of them died within 3 s: the flash won the duel.`);
    if (team.length) why.push(`Team-flashed ${team.length} teammate${team.length > 1 ? 's' : ''}.`);
    if (!hits.length) why.push('Blinded nobody.');
    moves.push({
      t: u.t, player: u.thrower, side: s, kind: 'flash', gain, grade: hits.length ? grade(gain, assisted.length >= 2) : 'inaccuracy',
      title: `${name(u.thrower)}: flash${where(worldToRadar({ x: u.x, y: u.y }, engine.map.radar))}`, why,
    });
  });

  moves.sort((a, b) => a.t - b.t || (a.kind === 'kill' ? -1 : 1));
  const players: Review['players'] = {};
  for (const id of sim.ids) players[id] = { impact: 0, counts: { brilliant: 0, great: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, blunder: 0 } };
  for (const m of moves) {
    if (!players[m.player]) continue;
    players[m.player].impact += m.gain;
    players[m.player].counts[m.grade]++;
  }
  const turningPoint = moves.reduce<Move | null>((best, m) => (!best || Math.abs(m.gain) > Math.abs(best.gain) ? m : best), null);
  return { curve, moves, players, turningPoint };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

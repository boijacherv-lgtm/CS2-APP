import { FLASH_POP, HE_POP, SIM_DT, type KillEvent, type Simulation } from './combat';
import { computeControl } from './control';
import { worldToRadar } from './coords';
import { gunFromName, primaryGun } from './guns';
import { UTIL_FLIGHT } from './grid';
import type { TacticalEngine } from './predict';
import type { BoardState, Player, Side, Utility, UtilType, Vec2, Weapon } from './types';

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
  /** Each player's economy a few seconds into the round (after buying). */
  econ?: Record<string, PlayerEcon>;
}

export interface PlayerEcon {
  money: number | null; // cash left after buying
  equip: number | null; // value of what they carry
  armor: number;
  helmet: boolean;
  defuser: boolean;
  weapons: string[];
}

// ---- economy ----------------------------------------------------------------------------------

/** Approximate CS2 prices, used when the demo has no equipment value. */
const PRICES: [RegExp, number][] = [
  [/awp/, 4750], [/scar|g3sg1/, 5000], [/m249/, 5200], [/negev/, 1700], [/aug/, 3300], [/sg ?553/, 3000], [/m4a4/, 3100],
  [/m4a1/, 2900], [/ak-?47/, 2700], [/famas/, 2050], [/galil/, 1800], [/ssg ?08|scout/, 1700], [/p90/, 2350],
  [/mp7|mp5/, 1500], [/mp9/, 1250], [/ump/, 1200], [/mac-?10/, 1050], [/bizon/, 1400], [/xm1014/, 2000], [/mag-?7/, 1300],
  [/nova/, 1050], [/sawed/, 1100], [/deagle|desert eagle/, 700], [/revolver|r8/, 600], [/tec-?9|five-?seven|cz75/, 500],
  [/p250/, 300], [/dual/, 300], [/incendiary/, 500], [/molotov/, 400], [/smoke/, 300], [/flash/, 200], [/he ?grenade|high explosive/, 300],
  [/decoy/, 50], [/zeus|taser/, 200],
];

/** What kind of gun a player is really holding (best weapon in their inventory). */
export function weaponClass(weapons: string[]): Weapon {
  const w = weapons.map(x => x.toLowerCase());
  if (w.some(x => /awp/.test(x))) return 'awp';
  if (w.some(x => /ak-?47|m4a|famas|galil|sg ?553|aug|ssg ?08|scout|scar|g3sg1|m249|negev/.test(x))) return 'rifle';
  if (w.some(x => /mp9|mac-?10|mp7|mp5|ump|p90|bizon|nova|xm1014|mag-?7|sawed/.test(x))) return 'smg';
  return 'pistol';
}

/** Equipment value: the demo's own number when present, otherwise priced from the inventory. */
export function equipValue(e: PlayerEcon | undefined): number | null {
  if (!e) return null;
  if (e.equip !== null && e.equip > 0) return e.equip;
  let v = 0;
  for (const w of e.weapons) { const hit = PRICES.find(([re]) => re.test(w.toLowerCase())); if (hit) v += hit[1]; }
  if (e.armor > 0) v += e.helmet ? 1000 : 650;
  if (e.defuser) v += 400;
  return v;
}

export type BuyType = 'Pistol round' | 'Eco' | 'Semi-eco' | 'Force buy' | 'Full buy';

export interface TeamEcon { side: Side; equip: number; avgEquip: number; money: number; buy: BuyType; known: boolean }

/** Each side's buy for the round, classified from average equipment value per player. */
export function teamEconomy(r: DemoRound, totalRounds: number): Record<Side, TeamEcon> {
  const out = {} as Record<Side, TeamEcon>;
  for (const side of ['CT', 'T'] as Side[]) {
    const ids = Object.keys(r.frames.players).filter(id => r.frames.players[id].side === side);
    const vals = ids.map(id => equipValue(r.econ?.[id])).filter((v): v is number => v !== null);
    const equip = vals.reduce((a, b) => a + b, 0);
    const avg = vals.length ? equip / vals.length : 0;
    const money = ids.reduce((a, id) => a + (r.econ?.[id]?.money ?? 0), 0);
    // MR12: rounds 1 and 13 are pistol rounds
    const pistol = r.n === 1 || (totalRounds > 12 && r.n === 13);
    const buy: BuyType = pistol ? 'Pistol round' : avg < 1200 ? 'Eco' : avg < 2500 ? 'Semi-eco' : avg < 3900 ? 'Force buy' : 'Full buy';
    out[side] = { side, equip, avgEquip: avg, money, buy, known: vals.length > 0 };
  }
  return out;
}

const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

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
    const gun = r.econ?.[id] ? primaryGun(r.econ[id].weapons) : undefined;
    return { id, side: s, pos: { x: sim.x[i][0], y: sim.y[i][0] }, weapon: gun?.cls ?? 'rifle', gun: gun?.id, label: shortName(id) };
  });
  return { board: { players, utility, context }, sim, names: demo.names, round: r };
}

// ---- evaluation ---------------------------------------------------------------------------------

const ROUND_TIME = 115;
const BOMB_TIME = 40;

/** CT win probability from the state of the round at time t. */
export function evalState(state: {
  ct: number; t: number; ctHp: number; tHp: number; ctMap: number; tMap: number; planted: number | null; time: number;
  /** Average equipment value of the living players on each side (null = unknown). */
  ctEquip?: number | null; tEquip?: number | null;
}): number {
  const { ct, t } = state;
  if (t === 0 && state.planted === null) return 1;
  if (ct === 0) return 0;
  if (t === 0 && state.planted !== null) return 0.25; // retake vs bomb timer with nobody to stop the defuse attempt
  const diff = ct - t;
  let z = 0.55 * diff + (0.35 * diff) / Math.max(1, Math.min(ct, t)); // man advantage matters more when few are left
  z += 0.004 * (state.ctHp - state.tHp);
  z += 0.9 * (state.ctMap - state.tMap);
  // guns win fights: a full buy (~$4.5k a head) vs an eco (~$700) is worth ~+2 on its own (≈88%)
  if (state.ctEquip != null && state.tEquip != null) z += 0.52 * ((state.ctEquip - state.tEquip) / 1000);
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

  const gear = new Map(sim.ids.map(id => [id, equipValue(r.econ?.[id])]));
  const hasEcon = [...gear.values()].some(v => v !== null);
  const stateAt = (t: number) => {
    let ct = 0, tt = 0, ctHp = 0, tHp = 0, ctGear = 0, tGear = 0;
    sim.ids.forEach((id, i) => {
      if (!alive(i, t)) return;
      const g = gear.get(id) ?? 0;
      if (sideOf.get(id) === 'CT') { ct++; ctHp += hpAt(i, t); ctGear += g; } else { tt++; tHp += hpAt(i, t); tGear += g; }
    });
    const m = mapAt(t);
    return evalState({
      ct, t: tt, ctHp, tHp, ctMap: m.ct, tMap: m.tt, planted: r.plant !== null && t >= r.plant ? r.plant : null, time: t,
      ctEquip: hasEcon && ct ? ctGear / ct : null, tEquip: hasEcon && tt ? tGear / tt : null,
    });
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

  const demoKill = (k: KillEvent) => r.kills.find(x => x.victim === k.victim && Math.abs(x.t - k.t) < 0.05);
  sim.kills.forEach((k, n) => {
    const dk = demoKill(k);
    const kGun = dk ? gunFromName(dk.weapon) : undefined;
    const withGun = kGun ? ` with ${kGun.name}${dk?.headshot ? ' (headshot)' : ''}` : dk?.headshot ? ' (headshot)' : '';
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
    const lost = gear.get(k.victim);
    if (lost != null && lost >= 3000) why.push(`Lost ${money(lost)} of gear${r.econ?.[k.victim] && weaponClass(r.econ[k.victim].weapons) === 'awp' ? ' (incl. the AWP)' : ''}.`);
    moves.push({
      t: k.t, player: k.victim, side: vSide, kind: 'death', gain: loss, grade: grade(loss, false),
      title: `${name(k.victim)} died${where(k.at)}${kGun ? ` (${kGun.name})` : ''}`, why,
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
      const vGear = gear.get(k.victim), aGear = gear.get(k.killer);
      if (vGear != null && r.econ?.[k.victim] && weaponClass(r.econ[k.victim].weapons) === 'awp') awhy.push('Took down the AWP.');
      else if (vGear != null && vGear < 1000) awhy.push('The victim was on an eco, so the kill is worth less.');
      if (aGear != null && vGear != null && aGear + 1500 < vGear) awhy.push(`Won it with ${money(aGear)} of gear against ${money(vGear)}.`);
      const vGun = r.econ?.[k.victim] ? primaryGun(r.econ[k.victim].weapons) : undefined;
      if (kGun && vGun && kGun.cls === 'pistol' && vGun.cls !== 'pistol') awhy.push(`Pistol (${kGun.name}) beat a ${vGun.name}.`);
      if (kGun?.id === 'awp' && dk?.headshot === false) awhy.push('AWP one-shot to the body.');
      moves.push({
        t: k.t, player: k.killer, side: aSide, kind: 'kill', gain, grade: grade(gain, special),
        title: `${name(k.killer)} killed ${name(k.victim)}${withGun}${where(k.at)}`, why: awhy,
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

/** CT win chance at round time t, interpolated from the eval curve. */
export function evalAt(curve: Review['curve'], t: number): number {
  if (!curve.length) return 0.5;
  if (t <= curve[0].t) return curve[0].ct;
  for (let i = 1; i < curve.length; i++)
    if (curve[i].t >= t) {
      const a = curve[i - 1], b = curve[i];
      return a.ct + ((b.ct - a.ct) * (t - a.t)) / (b.t - a.t || 1);
    }
  return curve[curve.length - 1].ct;
}

/** Moves that have happened by round time t (or all of them when spoilers are on). */
export const movesUntil = (rv: Review, t: number, all: boolean) => (all ? rv.moves : rv.moves.filter(m => m.t <= t + 0.01));

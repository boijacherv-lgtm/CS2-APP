import { worldToRadar } from './coords';
import type { TacticalEngine } from './predict';
import { teamEconomy, type BuyType, type DemoRound, type Fight, type FightTrack } from './recap';
import { gunFromName } from './guns';
import { placeOf } from './situations';
import { SMOKE_RADIUS_UNITS, type SmokeDisc } from './grid';
import type { Side, Vec2, Weapon } from './types';

/**
 * The analyst layer: a round the way a pro team's analyst reads it, from the demo alone. One fact list per topic:
 *
 *   trades     every death: was it traded, how fast, and which teammates had the chance (close, could see the killer)
 *   duels      every kill: who peeked and who held, who hit first, range, time to kill, flashed, from behind, opening
 *   control    which side held each area of the map at 20 s and 40 s
 *   rotations  CTs moving from one site to the other: when, why, how long, too late, over-rotated, died on the way
 *   plan       the T side's round type (rush, execute, split, default, eco) and target, the CT setup, the tempo
 *   utility    grenades per side: before the execute, flashes that turned into kills, team flashes
 *   economy    each side's buy, money and loss streak
 *   postPlant  after the plant: who's alive, how spread the Ts are, how many watch the bomb, the retake
 *
 * tools/learn-analyst.ts turns these into level-10 benchmarks; analystReport() compares a match with them.
 */

/** A teammate's chance to trade a death: close enough and able to see the killer in the next 3 s. */
export interface TradeChance {
  mate: string; dist: number; sees: boolean; traded: boolean; diedAfter: boolean;
  /** Where the teammate was when it happened (callout). */
  place?: string;
}
export interface TradeFact {
  t: number; victim: string; killer: string; side: Side; place: string;
  traded: boolean; tradeTime: number | null; tradedBy: string | null;
  /** Teammates who could have traded (within ~20 m, or had sight of the killer). */
  chances: TradeChance[];
  /** Distance to the nearest living teammate when they died (game units). */
  nearestMate: number | null;
  /** Where the killer shot from, and where the teammate who traded stood when they did. */
  killerPlace?: string; traderPlace?: string;
}
export type DuelStyle = 'peeked' | 'held' | 'both moving' | 'both still';
export interface DuelFact {
  t: number; killer: string; victim: string; side: Side;
  /** From the killer's view: they peeked a still enemy, held while the enemy moved in, both moving, both still. */
  style: DuelStyle;
  /** Who did damage first in the fight (last 3 s). */
  firstHit: 'killer' | 'victim' | 'none';
  /** Seconds from the killer's first hit to the kill. */
  ttk: number | null;
  range: number; // metres
  weapon: Weapon | 'other';
  headshot: boolean; flashed: boolean; fromBehind: boolean; opening: boolean; withFlash: boolean;
  place: string; killerPlace: string;
  /** From the 16-a-second fight samples (newer parses): each side's spotting, reaction, crosshair placement, moving shots. */
  detail?: DuelDetail;
}
export interface DuelDetail {
  /** Who had the other in view first (in sight and within ~50° of where they looked). */
  spottedFirst: 'killer' | 'victim' | 'same' | null;
  /** Seconds from having the enemy in view to the first shot (null = shot before seeing them, or never). */
  kReact: number | null; vReact: number | null;
  /** Degrees between where the crosshair was and the enemy's head the moment they came into sight. */
  kAim: number | null; vAim: number | null;
  /** Their first shot was fired while moving faster than a walk (no counter-strafe). */
  kMovingShot: boolean | null; vMovingShot: boolean | null;
}
export interface ControlFact { at: number; ct: string[]; t: string[] }
export interface RotationFact {
  player: string; from: 'A' | 'B'; to: 'A' | 'B'; start: number; arrive: number | null;
  trigger: string | null; late: boolean; diedOnWay: boolean; overRotated: boolean;
}
export type RoundType = 'pistol' | 'eco' | 'rush' | 'execute' | 'split' | 'default' | 'no hit';
export interface PlanFact {
  tType: RoundType; target: 'A' | 'B' | null;
  /** CTs per area at 15 s, e.g. "2A 1M 2B". */
  ctSetup: string;
  firstContact: number | null; plant: number | null;
}
export interface UtilityFact { side: Side; thrown: number; beforeContact: number; execute: number; flashKills: number; flashes: number; teamFlashes: number }
export interface EconomyFact { side: Side; buy: BuyType; avgEquip: number; money: number; lossStreak: number }
export interface PostPlantFact { site: 'A' | 'B' | null; tAlive: number; ctAlive: number; spread: number; watching: number; retakeContact: number | null }
export interface AnalystRound {
  n: number; winner: Side | null;
  trades: TradeFact[]; duels: DuelFact[]; control: ControlFact[]; rotations: RotationFact[];
  plan: PlanFact; utility: UtilityFact[]; economy: EconomyFact[]; postPlant: PostPlantFact | null;
}

const MOVING = 110; // game units a second: faster than this is moving (walking ~130, running ~250)
const M = 0.0254; // metres per game unit

/** The analyst's facts for one round. `prev` = the rounds before it (for loss streaks). */
export function analyzeRound(engine: TacticalEngine, r: DemoRound, prev: DemoRound[] = [], totalRounds = 24): AnalystRound {
  const ids = Object.keys(r.frames.players);
  const side = (id: string): Side | undefined => r.frames.players[id]?.side;
  const ft = r.frames.t;
  const idx = (t: number) => { let k = 0; while (k < ft.length - 1 && ft[k + 1] <= t) k++; return k; };
  const pos = (id: string, t: number): Vec2 => { const f = r.frames.players[id]; const k = idx(t); return { x: f.x[k], y: f.y[k] }; };
  const alive = (id: string, t: number) => { const f = r.frames.players[id]; return !!f && !!f.alive[idx(t)] && !r.kills.some(k => k.victim === id && k.t <= t); };
  const speed = (id: string, t: number) => {
    const f = r.frames.players[id]; const k = idx(t); const j = Math.max(0, k - 2);
    const dt = (ft[k] - ft[j]) || 1;
    return Math.hypot(f.x[k] - f.x[j], f.y[k] - f.y[j]) / dt;
  };
  const radar = (w: Vec2) => worldToRadar(w, engine.map.radar);
  const sees = (a: Vec2, b: Vec2) => engine.grid.lineOfSight(radar(a), radar(b));
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
  const place = (w: Vec2) => placeOf(engine, radar(w));
  const facing = (id: string, t: number) => { const f = r.frames.players[id]; return (f.yaw[idx(t)] * Math.PI) / 180; };
  const sites = Object.entries(engine.map.sites) as ['A' | 'B', { center: Vec2; radius: number }][];
  /** The site a spot belongs to (within ~2 site radii of its centre), else null (mid, spawns, connectors). */
  const siteOf = (w: Vec2, reach = 2): 'A' | 'B' | null => {
    const p = radar(w);
    let best: 'A' | 'B' | null = null, bd = Infinity;
    for (const [k, s] of sites) { const d = Math.hypot(s.center.x - p.x, s.center.y - p.y); if (d < s.radius * reach && d < bd) { bd = d; best = k; } }
    return sites.length > 1 ? best : null;
  };
  /** The site and its approaches (where an attack gathers): ~3.2 site radii. */
  const nearSite = (w: Vec2) => siteOf(w, 3.2);
  const kills = [...r.kills].sort((a, b) => a.t - b.t);
  const enemyKills = kills.filter(k => side(k.attacker) && side(k.victim) && side(k.attacker) !== side(k.victim));

  /** A fight's details from its 16-a-second samples. */
  function duelDetail(f: Fight): DuelDetail {
    const n = f.a.x.length;
    const ok = (tr: FightTrack, i: number) => Number.isFinite(tr.x[i]) && Number.isFinite(tr.yaw[i]);
    const p3 = (tr: FightTrack, i: number) => ({ x: tr.x[i], y: tr.y[i], z: tr.z[i] });
    // smokes that were up at that moment block the view (a player behind a smoke isn't "in view")
    const smokesAt = (t: number): SmokeDisc[] => r.util.filter(u => u.type === 'smoke' && u.t <= t && t <= (u.end ?? u.t + 18))
      .map(u => ({ pos: radar({ x: u.x, y: u.y }), r: SMOKE_RADIUS_UNITS / engine.map.radar.scale }));
    const los = (i: number) => ok(f.a, i) && ok(f.v, i) && engine.grid.lineOfSight(radar(p3(f.a, i)), radar(p3(f.v, i)), smokesAt(f.t0 + i * f.dt));
    /** Angle (degrees) between where `from` aims and the head of `to`, in 3D. */
    const aimErr = (from: FightTrack, to: FightTrack, i: number) => {
      const yaw = (from.yaw[i] * Math.PI) / 180, pitch = (-(from.pitch[i] || 0) * Math.PI) / 180; // CS: negative pitch looks up
      const aim = { x: Math.cos(pitch) * Math.cos(yaw), y: Math.cos(pitch) * Math.sin(yaw), z: Math.sin(pitch) };
      const d = { x: to.x[i] - from.x[i], y: to.y[i] - from.y[i], z: (to.z[i] + 64) - (from.z[i] + 64) };
      const len = Math.hypot(d.x, d.y, d.z) || 1;
      return (Math.acos(Math.max(-1, Math.min(1, (aim.x * d.x + aim.y * d.y + aim.z * d.z) / len))) * 180) / Math.PI;
    };
    const inView = (from: FightTrack, to: FightTrack, i: number) => los(i) && aimErr(from, to, i) <= 50;
    const first = (pred: (i: number) => boolean) => { for (let i = 0; i < n; i++) if (pred(i)) return i; return null; };
    const sa = first(i => inView(f.a, f.v, i)), sv = first(i => inView(f.v, f.a, i)), seen = first(los);
    const tAt = (i: number) => f.t0 + i * f.dt;
    const firstShot = (id: string, from: number) => (r.shots ?? []).filter(x => x.id === id && x.t >= from - 0.01 && x.t <= f.t0 + 3 + 0.05).sort((x, y) => x.t - y.t)[0]?.t ?? null;
    const react = (id: string, spot: number | null) => {
      if (spot === null) return null;
      const shot = firstShot(id, tAt(spot));
      // a shot right as they come into view is a pre-fire, not a reaction
      return shot === null ? null : shot - tAt(spot) < 0.04 ? null : +Math.min(1.5, shot - tAt(spot)).toFixed(3);
    };
    const speedAt = (tr: FightTrack, t: number) => {
      const i = Math.max(1, Math.min(n - 1, Math.round((t - f.t0) / f.dt)));
      return Number.isFinite(tr.x[i]) && Number.isFinite(tr.x[i - 1]) ? Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]) / f.dt : null;
    };
    const moving = (id: string, tr: FightTrack) => {
      const shot = firstShot(id, f.t0);
      const sp = shot === null ? null : speedAt(tr, shot);
      return sp === null ? null : sp > MOVING;
    };
    return {
      spottedFirst: sa === null && sv === null ? null : sv === null || (sa !== null && sa < sv) ? 'killer' : sa === null || sv < sa ? 'victim' : 'same',
      kReact: react(f.attacker, sa), vReact: react(f.victim, sv),
      kAim: seen === null ? null : +aimErr(f.a, f.v, seen).toFixed(1), vAim: seen === null ? null : +aimErr(f.v, f.a, seen).toFixed(1),
      kMovingShot: moving(f.attacker, f.a), vMovingShot: moving(f.victim, f.v),
    };
  }

  // ---- trades -----------------------------------------------------------------------------------
  const trades: TradeFact[] = enemyKills.map(k => {
    const s = side(k.victim)!;
    const killerAt = { x: k.ax || pos(k.attacker, k.t).x, y: k.ay || pos(k.attacker, k.t).y };
    const revenge = enemyKills.find(o => o.victim === k.attacker && o.t > k.t && o.t - k.t <= 5 && side(o.attacker) === s);
    const mates = ids.filter(id => id !== k.victim && side(id) === s && alive(id, k.t - 0.05));
    const chances: TradeChance[] = [];
    let nearest: number | null = null;
    for (const m of mates) {
      const mp = pos(m, k.t);
      const d = dist(mp, { x: k.x, y: k.y });
      nearest = nearest === null ? d : Math.min(nearest, d);
      let saw = false;
      for (let dt = 0; dt <= 3 && !saw; dt += 0.5) if (alive(m, k.t + dt) && alive(k.attacker, k.t + dt) && sees(pos(m, k.t + dt), pos(k.attacker, k.t + dt))) saw = true;
      if (d < 800 || saw)
        chances.push({ mate: m, dist: Math.round(d), sees: saw, traded: revenge?.attacker === m, diedAfter: kills.some(o => o.victim === m && o.t > k.t && o.t - k.t <= 5), place: place(mp) });
    }
    return {
      t: k.t, victim: k.victim, killer: k.attacker, side: s, place: place({ x: k.x, y: k.y }) || place(killerAt),
      traded: !!revenge, tradeTime: revenge ? +(revenge.t - k.t).toFixed(2) : null, tradedBy: revenge?.attacker ?? null,
      chances, nearestMate: nearest === null ? null : Math.round(nearest),
      killerPlace: place(killerAt),
      ...(revenge ? { traderPlace: place({ x: revenge.ax || pos(revenge.attacker, revenge.t).x, y: revenge.ay || pos(revenge.attacker, revenge.t).y }) } : {}),
    };
  });

  // ---- duels ------------------------------------------------------------------------------------
  const duels: DuelFact[] = enemyKills.map((k, i) => {
    const a = k.attacker, v = k.victim;
    const ka = pos(a, k.t - 0.25), kv = pos(v, k.t - 0.25);
    const am = speed(a, k.t - 0.1) > MOVING, vm = speed(v, k.t - 0.1) > MOVING;
    const style: DuelStyle = am && !vm ? 'peeked' : !am && vm ? 'held' : am && vm ? 'both moving' : 'both still';
    const hits = (r.hits ?? []).filter(h => h.t <= k.t && k.t - h.t <= 3 && ((h.attacker === a && h.victim === v) || (h.attacker === v && h.victim === a)));
    const first = hits.sort((x, y) => x.t - y.t)[0];
    const kFirst = hits.find(h => h.attacker === a);
    const toKiller = Math.atan2(ka.y - kv.y, ka.x - kv.x);
    const off = Math.abs(((facing(v, k.t - 0.15) - toKiller + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    const flashed = r.blind.some(b => b.victim === v && b.t <= k.t && b.t + b.dur >= k.t);
    const withFlash = r.blind.some(b => b.victim === v && side(b.attacker) === side(a) && b.t <= k.t && k.t - b.t <= 2.5);
    const gun = gunFromName(k.weapon);
    const fight = (r.fights ?? []).find(f => f.attacker === a && f.victim === v && Math.abs(f.t0 + 3 - k.t) < 0.1);
    const detail = fight ? duelDetail(fight) : undefined;
    return {
      t: k.t, killer: a, victim: v, side: side(a)!, style,
      firstHit: !first ? 'none' : first.attacker === a ? 'killer' : 'victim',
      ttk: kFirst ? +(k.t - kFirst.t).toFixed(2) : null,
      range: Math.round(dist(ka, kv) * M),
      weapon: gun?.cls ?? 'other', headshot: k.headshot, flashed, withFlash,
      fromBehind: off > 2.0, opening: i === 0,
      place: place(kv), killerPlace: place(ka),
      ...(detail ? { detail } : {}),
    };
  });

  // ---- map control: who held each area at 20 s and 40 s ---------------------------------------------
  // only the contested map between spawns and sites (being on a site is the hit itself, not control)
  const control: ControlFact[] = [20, 40].filter(at => at < r.duration).map(at => {
    const last = new Map<string, Side>();
    for (let t = Math.max(0, at - 10); t <= at; t += 1)
      for (const id of ids) if (alive(id, t)) { const p = pos(id, t), pl = place(p); if (pl && !/spawn/i.test(pl) && !siteOf(p)) last.set(pl, side(id)!); }
    return { at, ct: [...last].filter(([, s]) => s === 'CT').map(([p]) => p), t: [...last].filter(([, s]) => s === 'T').map(([p]) => p) };
  });

  // ---- plan: T round type and target, CT setup, tempo ------------------------------------------------------
  const plantEv = (r.bomb ?? []).find(b => b.kind === 'plant');
  const plantSite = plantEv ? siteOf({ x: plantEv.x, y: plantEv.y }) : null;
  const tIds = ids.filter(id => side(id) === 'T'), ctIds = ids.filter(id => side(id) === 'CT');
  const atSite = (s: 'A' | 'B', t: number, who: string[]) => who.filter(id => alive(id, t) && siteOf(pos(id, t)) === s).length;
  const firstContact = enemyKills[0]?.t ?? null;
  const econ = teamEconomy(r, totalRounds);
  let target: 'A' | 'B' | null = plantSite;
  if (!target && sites.length > 1) {
    const end = Math.min(r.duration, 60);
    const a = atSite('A', end, tIds), b = atSite('B', end, tIds);
    target = a === b ? null : a > b ? 'A' : 'B';
  }
  let tType: RoundType = 'default';
  // the hit: the first second 3 Ts (or every T still alive, if fewer) are at the site or its approaches
  const arriveT = (s: 'A' | 'B') => {
    for (let t = 0; t <= r.duration; t += 1) {
      const left = tIds.filter(id => alive(id, t)).length;
      const there = tIds.filter(id => alive(id, t) && nearSite(pos(id, t)) === s).length;
      if (left && there >= Math.min(3, left)) return t;
    }
    return null;
  };
  if (econ.T.buy === 'Pistol round') tType = 'pistol';
  else if (econ.T.known && econ.T.avgEquip < 1200) tType = 'eco';
  else if (target) {
    const arrive = arriveT(target);
    const utilAt = r.util.filter(u => side(u.thrower) === 'T' && nearSite({ x: u.x, y: u.y }) === target);
    // split: just before the hit, Ts come from two directions far apart
    const hitT = arrive ?? plantEv?.t ?? null;
    let split = false;
    if (hitT !== null) {
      const pre = tIds.filter(id => alive(id, hitT - 5)).map(id => pos(id, hitT - 5));
      split = pre.length >= 3 && pre.some(p => pre.filter(q => dist(p, q) > 1400).length >= 2) && pre.filter(p => nearSite(p) !== target).length >= 2;
    }
    if (arrive !== null && arrive <= 30) tType = 'rush';
    else if (split) tType = 'split';
    else if (arrive !== null && utilAt.filter(u => u.t >= arrive - 12 && u.t <= arrive + 2).length >= 3) tType = 'execute';
  }
  const setupAt = Math.min(15, r.duration);
  const ctA = sites.length > 1 ? atSite('A', setupAt, ctIds) : 0, ctB = sites.length > 1 ? atSite('B', setupAt, ctIds) : 0;
  const ctAlive = ctIds.filter(id => alive(id, setupAt)).length;
  // a buy round where the Ts never went onto a site
  if (tType === 'default' && !target) tType = 'no hit';
  const plan: PlanFact = { tType, target, ctSetup: sites.length > 1 ? `${ctA}A ${ctAlive - ctA - ctB}M ${ctB}B` : `${ctAlive}`, firstContact, plant: r.plant };

  // ---- rotations (CTs from one site to the other) ---------------------------------------------------------
  const rotations: RotationFact[] = [];
  if (sites.length > 1)
    for (const id of ctIds) {
      let lastSite: 'A' | 'B' | null = null, leftAt = 0;
      for (let t = 0; t <= r.duration; t += 1) {
        if (!alive(id, t)) {
          if (lastSite && leftAt && t - leftAt <= 25) rotations.push({ player: id, from: lastSite, to: lastSite === 'A' ? 'B' : 'A', start: leftAt, arrive: null, trigger: null, late: false, diedOnWay: true, overRotated: false });
          break;
        }
        const s = siteOf(pos(id, t));
        if (s && lastSite && s !== lastSite) {
          const start = leftAt || t;
          const mateDied = enemyKills.filter(k => side(k.victim) === 'CT' && k.t <= start && start - k.t <= 8).at(-1);
          const seenT = tIds.find(e => alive(e, start) && ctIds.some(c => alive(c, start) && sees(pos(c, start), pos(e, start))));
          const trigger = mateDied ? `teammate died at ${place({ x: mateDied.x, y: mateDied.y }) || 'site'}` : seenT ? `Ts seen at ${place(pos(seenT, start))}` : r.plant !== null && r.plant <= start ? 'bomb planted' : null;
          const hitLater = (site: 'A' | 'B') => plantSite === site || (() => { for (let u = t; u <= Math.min(r.duration, t + 25); u += 1) if (atSite(site, u, tIds) >= 3) return true; return false; })();
          rotations.push({
            player: id, from: lastSite, to: s, start, arrive: t, trigger,
            late: r.plant !== null && plantSite === s && t > r.plant + 3,
            diedOnWay: false,
            overRotated: hitLater(lastSite) && !hitLater(s),
          });
          leftAt = 0;
        }
        if (s) { lastSite = s; leftAt = 0; } else if (lastSite && !leftAt) leftAt = t;
      }
    }
  // a rotation that ended in death on the way is only one if they were heading to the other site
  const rotationsKept = rotations.filter(x => !x.diedOnWay || (() => {
    const k = kills.find(o => o.victim === x.player);
    return !!k && siteOf({ x: k.x, y: k.y }) !== x.from;
  })());

  // ---- utility ----------------------------------------------------------------------------------------------
  const utility: UtilityFact[] = (['CT', 'T'] as const).map(s => {
    const mine = r.util.filter(u => side(u.thrower) === s);
    const flashes = mine.filter(u => u.type === 'flash');
    const flashKills = r.blind.filter(b => side(b.attacker) === s && side(b.victim) && side(b.victim) !== s
      && enemyKills.some(k => k.victim === b.victim && side(k.attacker) === s && k.t >= b.t && k.t - b.t <= 2.5)).length;
    const teamFlashes = r.blind.filter(b => side(b.attacker) === s && side(b.victim) === s && b.victim !== b.attacker && b.dur >= 1).length;
    const hitT = s === 'T' && target ? arriveT(target) ?? plantEv?.t ?? null : null;
    return {
      side: s, thrown: mine.length, flashes: flashes.length, flashKills, teamFlashes,
      beforeContact: firstContact === null ? mine.length : mine.filter(u => u.t <= firstContact).length,
      execute: hitT === null ? 0 : mine.filter(u => u.t >= hitT - 12 && u.t <= hitT + 2 && nearSite({ x: u.x, y: u.y }) === target).length,
    };
  });

  // ---- economy ----------------------------------------------------------------------------------------------
  const streak = (s: Side) => { let n = 0; for (let i = prev.length - 1; i >= 0; i--) { if (prev[i].winner && prev[i].winner !== s) n++; else break; } return n; };
  const economy: EconomyFact[] = (['CT', 'T'] as const).map(s => ({ side: s, buy: econ[s].buy, avgEquip: Math.round(econ[s].avgEquip), money: econ[s].money, lossStreak: streak(s) }));

  // ---- post-plant -------------------------------------------------------------------------------------------
  let postPlant: PostPlantFact | null = null;
  if (plantEv && r.plant !== null) {
    const at = Math.min(r.duration, r.plant + 5);
    const ts = tIds.filter(id => alive(id, at)).map(id => pos(id, at));
    const pairs = ts.flatMap((p, i) => ts.slice(i + 1).map(q => dist(p, q)));
    const bomb = { x: plantEv.x, y: plantEv.y };
    const retake = enemyKills.find(k => k.t > r.plant!);
    postPlant = {
      site: plantSite, tAlive: ts.length, ctAlive: ctIds.filter(id => alive(id, r.plant!)).length,
      spread: pairs.length ? Math.round(pairs.reduce((a, b) => a + b, 0) / pairs.length) : 0,
      watching: ts.filter(p => sees(p, bomb)).length,
      retakeContact: retake ? +(retake.t - r.plant).toFixed(1) : null,
    };
  }

  return { n: r.n, winner: r.winner, trades, duels, control, rotations: rotationsKept, plan, utility, economy, postPlant };
}

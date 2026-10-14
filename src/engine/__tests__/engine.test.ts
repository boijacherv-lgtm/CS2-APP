import { describe, expect, it } from 'vitest';
import { radarToWorld, worldToRadar } from '../coords';
import { getEngine, MAPS, presetsFor } from '../../map/catalog';
import type { BoardState } from '../types';

const board = (mapId: string, preset: string): BoardState => {
  const players = presetsFor(mapId)[preset]();
  return { players, utility: [], context: { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } } };
};
const mid = (c: { portal: [{ x: number; y: number }, { x: number; y: number }] }) =>
  ({ x: (c.portal[0].x + c.portal[1].x) / 2, y: (c.portal[0].y + c.portal[1].y) / 2 });

describe('coords', () => {
  it('round-trips world <-> radar', () => {
    const r = getEngine('de_mirage').map.radar;
    const w = { x: -300, y: -2100 };
    const back = radarToWorld(worldToRadar(w, r), r);
    expect(back.x).toBeCloseTo(w.x); expect(back.y).toBeCloseTo(w.y);
  });
});

describe('every official map', () => {
  for (const m of MAPS) {
    it(`${m.id}: spawns connect to both bombsites`, () => {
      const e = getEngine(m.id, 0);
      const tA = e.grid.at(e.tTime, e.map.sites.A.center), tB = e.grid.at(e.tTime, e.map.sites.B.center);
      const cA = e.grid.at(e.ctTime, e.map.sites.A.center), cB = e.grid.at(e.ctTime, e.map.sites.B.center);
      console.log(`${m.id.padEnd(12)} T→A ${tA.toFixed(1)}s T→B ${tB.toFixed(1)}s | CT→A ${cA.toFixed(1)}s CT→B ${cB.toFixed(1)}s`);
      // Nuke B is on the lower radar, so only check that at least one site is reachable there.
      const reachable = [tA, tB, cA, cB].filter(Number.isFinite).length;
      expect(reachable).toBeGreaterThanOrEqual(m.id === 'de_nuke' ? 2 : 4);
    });
  }
});

describe('mirage tactical layer', () => {
  const e = getEngine('de_mirage');
  it('chokepoints fit real doorways and are reachable', () => {
    for (const c of e.map.chokepoints) {
      const width = Math.hypot(c.portal[1].x - c.portal[0].x, c.portal[1].y - c.portal[0].y);
      const t = e.tArrival(mid(c));
      console.log(`${c.id.padEnd(10)} width ${(width * 5).toFixed(0)}u  T ${t.min.toFixed(1)}-${t.max.toFixed(1)}s  CT ${e.grid.at(e.ctTime, mid(c)).toFixed(1)}s`);
      expect(width, c.id).toBeGreaterThan(8);
      expect(width, c.id).toBeLessThan(140);
      expect(t.min, c.id).toBeLessThan(40);
    }
  });
  it('every preset player stands on walkable floor', () => {
    for (const [name, make] of Object.entries(presetsFor('de_mirage')))
      for (const pl of make()) expect(e.grid.isWalkable(pl.pos), `${name} @ ${pl.pos.x},${pl.pos.y}`).toBe(true);
  });
  it('flags mid when 3A/2B leave it open', () => {
    const a = e.analyze(board('de_mirage', 'Stack A, Mid open'));
    console.log(a.chokes.map(c => `${c.choke.id} ${c.threat.toFixed(2)} [${c.defenders.length}]`).join('  '));
    console.log(a.predictions.slice(0, 4).map(p => `${p.label} ${(p.probability * 100).toFixed(0)}% ev=${p.successRate.toFixed(2)}`).join('\n'));
    const worst = [...a.chokes].sort((x, y) => y.threat - x.threat)[0];
    expect(worst.choke.area).toBe('Mid');
  });
  it('stack B pushes predictions toward A', () => {
    const a = e.analyze(board('de_mirage', 'Stack B'));
    console.log(a.predictions.slice(0, 3).map(p => `${p.label} ${(p.probability * 100).toFixed(0)}%`).join('\n'));
    expect(a.predictions[0].target).toBe('A');
  });
});

describe('map control', () => {
  const e = getEngine('de_mirage');
  it('mid open → Ts own Top Mid by 15s; aggro mid → CTs hold more ground', async () => {
    const { computeControl, Ctl, CTL_LABEL } = await import('../control');
    const t0 = performance.now();
    const open = computeControl(e, board('de_mirage', 'Stack A, Mid open'), 15);
    console.log('control ms', (performance.now() - t0).toFixed(0));
    const aggro = computeControl(e, board('de_mirage', 'Aggro Mid'), 15);
    const fmt = (c: typeof open) => c.callouts.map(x => `${x.name}:${CTL_LABEL[x.cls]}`).join(', ');
    console.log('open :', JSON.stringify(open.share), '\n ', fmt(open));
    console.log('aggro:', JSON.stringify(aggro.share), '\n ', fmt(aggro));
    expect(open.callouts.find(c => c.name === 'Top Mid')!.cls).toBe(Ctl.TZone);
    expect(aggro.share.ct).toBeGreaterThan(open.share.ct);
  });
});

describe('routes & timeline', () => {
  const e = getEngine('de_mirage');
  it('every scripted T play reaches all its waypoints', async () => {
    const { tPlaysFor } = await import('../../map/catalog');
    const { bakeRoute } = await import('../timeline');
    for (const [name, make] of Object.entries(tPlaysFor('de_mirage'))) {
      const t0 = performance.now();
      const ends = make().map(p => {
        expect(e.grid.isWalkable(p.pos), `${name} start ${p.pos.x},${p.pos.y}`).toBe(true);
        const r = bakeRoute(e, p)!;
        expect(r.unreachable, `${name} ${JSON.stringify(p.route)}`).toBe(false);
        return r.end.toFixed(1);
      });
      console.log(`${name.padEnd(14)} arrivals ${ends.join(' / ')}s  (${(performance.now() - t0).toFixed(0)} ms)`);
    }
  });
  it('T players add vision and a front line to map control', async () => {
    const { tPlaysFor } = await import('../../map/catalog');
    const { computeControl, Ctl } = await import('../control');
    const b = board('de_mirage', 'Default 2-1-2');
    b.players = [...b.players, ...tPlaysFor('de_mirage')['A execute']()];
    for (const t of [0, 8, 14]) {
      const c = computeControl(e, b, t);
      const n = (k: number) => c.cls.reduce((s, v) => s + (v === k ? 1 : 0), 0);
      console.log(`t=${t}s share ${JSON.stringify(Object.fromEntries(Object.entries(c.share).map(([k, v]) => [k, +v.toFixed(2)])))} tVision=${n(Ctl.TSeen)} trail=${n(Ctl.TZone)} fights=${n(Ctl.Contested)}`);
      if (t === 14) { expect(n(Ctl.TSeen)).toBeGreaterThan(0); expect(n(Ctl.TZone)).toBeGreaterThan(0); }
    }
    // players actually move
    const at0 = computeControl(e, b, 0).live.find(p => p.side === 'T')!;
    const at14 = computeControl(e, b, 14).live.find(p => p.id === at0.id)!;
    expect(Math.hypot(at14.pos.x - at0.pos.x, at14.pos.y - at0.pos.y)).toBeGreaterThan(50);
  });
});

describe('combat simulation', () => {
  const e = getEngine('de_mirage');
  it('players fight and die; outcomes vary by seed but are reproducible', async () => {
    const { tPlaysFor } = await import('../../map/catalog');
    const { simulate } = await import('../combat');
    const b = board('de_mirage', 'Default 2-1-2');
    b.players = [...b.players, ...tPlaysFor('de_mirage')['A execute']()];
    const label = (id: string) => { const p = b.players.find(q => q.id === id)!; return `${p.side}${b.players.filter(q => q.side === p.side).indexOf(p) + 1}`; };
    const t0 = performance.now();
    const sim = simulate(e, b, 40, 1);
    console.log(`sim ${(performance.now() - t0).toFixed(0)} ms; kills:`, sim.kills.map(k => `${k.t.toFixed(1)}s ${label(k.killer)}>${label(k.victim)}`).join(', '));
    expect(sim.kills.length).toBeGreaterThan(0);
    expect(simulate(e, b, 40, 1).kills.map(k => k.victim)).toEqual(sim.kills.map(k => k.victim));
    let tWins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = simulate(e, b, 40, seed);
      const alive = (side: string) => b.players.filter((p, i) => p.side === side && !Number.isFinite(s.deathT[i])).length;
      if (alive('T') > alive('CT')) tWins++;
    }
    console.log(`A execute vs 2-1-2: Ts end with more players in ${tWins}/40 sims`);
  });
});

describe('kill map', () => {
  const e = getEngine('de_mirage');
  it('scores CT positions against T movement; fast enough to recompute', async () => {
    const { computeKillMap, duelWin } = await import('../killmap');
    const { tPlaysFor } = await import('../../map/catalog');
    console.log('duel: unaware T 1000u', duelWin(false, 1000, 'rifle', 'rifle').toFixed(2), '| aware T 1000u', duelWin(true, 1000, 'rifle', 'rifle').toFixed(2),
      '| aware T 3000u awp vs rifle', duelWin(true, 3000, 'awp', 'rifle').toFixed(2));
    const b = board('de_mirage', 'Default 2-1-2');
    let t0 = performance.now();
    const flow = computeKillMap(e, b, null);
    console.log(`default paths: ${flow.tracks} tracks in ${(performance.now() - t0).toFixed(0)} ms`);
    b.players = [...b.players, ...tPlaysFor('de_mirage')['A execute']()];
    t0 = performance.now();
    const km = computeKillMap(e, b, null);
    console.log(`T players: ${km.tracks} tracks in ${(performance.now() - t0).toFixed(0)} ms`);
    const at = (m: typeof km, x: number, y: number) => { const i = e.grid.snap({ x, y }); return `${Math.round(m.pKill[i] * 100)}% kill · ${m.expKills[i].toFixed(2)} exp · ${Math.round(m.survive[i] * 100)}% live`; };
    for (const [name, x, y] of [['A stairs', 690, 650], ['Jungle', 455, 625], ['Window', 405, 470], ['B site', 250, 290], ['A site', 600, 790]] as const)
      console.log(`  ${name.padEnd(9)} vs A exec: ${at(km, x, y)} | vs default paths: ${at(flow, x, y)}`);
    expect(Number.isFinite(km.pKill[e.grid.snap({ x: 690, y: 650 })])).toBe(true);
  });
});

describe('generated layers on every other map', () => {
  for (const m of MAPS.filter(x => x.id !== 'de_mirage')) {
    it(`${m.id}: chokes, strategies, T plays and CT setups`, async () => {
      const { getAutoLayer, tPlaysFor } = await import('../../map/catalog');
      const { bakeRoute } = await import('../timeline');
      const e = getEngine(m.id);
      const layer = getAutoLayer(m.id) ?? { chokepoints: e.map.chokepoints }; // Nuke is hand-made
      expect(layer.chokepoints.length).toBeGreaterThan(0);
      expect(e.strats.length).toBeGreaterThan(1);
      for (const [name, make] of Object.entries(presetsFor(m.id)))
        for (const p of make()) expect(e.grid.isWalkable(p.pos), `${m.id} ${name}`).toBe(true);
      for (const [name, make] of Object.entries(tPlaysFor(m.id)))
        for (const p of make()) expect(bakeRoute(e, p)?.unreachable, `${m.id} ${name}`).toBe(false);
      const b: BoardState = { players: presetsFor(m.id)[Object.keys(presetsFor(m.id))[0]](), utility: [], context: { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } } };
      const a = e.analyze(b, 300);
      const sum = a.predictions.reduce((x, p) => x + p.probability, 0);
      expect(sum).toBeCloseTo(1, 5);
      console.log(`${m.id.padEnd(12)} ${layer.chokepoints.map(c => c.name).join(', ')} → top: ${a.predictions[0].label} ${(a.predictions[0].probability * 100).toFixed(0)}%`);
    });
  }
});

describe('grenades in combat', () => {
  it('flashes blind, HEs damage, impact is measured', async () => {
    const { simulate } = await import('../combat');
    const { tPlaysFor } = await import('../../map/catalog');
    const e = getEngine('de_mirage');
    const b = board('de_mirage', 'Default 2-1-2');
    b.players = [...b.players, ...tPlaysFor('de_mirage')['A execute']()];
    // T-side flash over A ramp right as the Ts swing, HE on the stairs CT
    b.utility = [
      { id: 'f1', type: 'flash', pos: { x: 700, y: 640 }, throwAt: 12 },
      { id: 'h1', type: 'he', pos: { x: 690, y: 655 }, throwAt: 11 },
    ];
    const sim = simulate(e, b, 40, 1);
    const blinds = sim.utilEvents.filter(x => x.kind === 'blind');
    const hes = sim.utilEvents.filter(x => x.kind === 'he');
    console.log('blinded:', blinds.map(x => `${x.id.slice(0, 3)} ${x.amount}s`).join(', '), '| HE:', hes.map(x => `-${x.amount}`).join(', '));
    expect(blinds.length + hes.length).toBeGreaterThan(0);
  });
});

describe('nuke hand-made layer', () => {
  it('A upstairs and B downstairs: chokes fit doors, entries timed, plays reachable', async () => {
    const { tPlaysFor } = await import('../../map/catalog');
    const { bakeRoute } = await import('../timeline');
    for (const level of [0, 1]) {
      const e = getEngine('de_nuke', level);
      for (const c of e.map.chokepoints) {
        const w = Math.hypot(c.portal[1].x - c.portal[0].x, c.portal[1].y - c.portal[0].y) * e.map.radar.scale;
        const t = e.tArrival(mid(c));
        console.log(`L${level} ${c.name.padEnd(8)} width ${w.toFixed(0)}u  T ${t.min.toFixed(1)}s  CT ${e.grid.at(e.ctTime, mid(c)).toFixed(1)}s`);
        expect(w, c.name).toBeGreaterThan(40);
        expect(w, c.name).toBeLessThan(450);
        expect(t.min, c.name).toBeLessThan(40);
      }
      if (level === 1) console.log('entries T', e.map.spawnDelay?.T?.map(d => d.toFixed(1)), 'CT', e.map.spawnDelay?.CT?.map(d => d.toFixed(1)));
      for (const [name, make] of Object.entries(presetsFor('de_nuke', level)))
        for (const p of make()) expect(e.grid.isWalkable(p.pos), `L${level} ${name} ${p.pos.x},${p.pos.y}`).toBe(true);
      for (const [name, make] of Object.entries(tPlaysFor('de_nuke', level)))
        for (const p of make()) {
          expect(e.grid.isWalkable(p.pos), `L${level} ${name} start`).toBe(true);
          expect(bakeRoute(e, p)?.unreachable, `L${level} ${name} ${JSON.stringify(p.route?.pts)}`).toBe(false);
        }
      const b: BoardState = { players: presetsFor('de_nuke', level)[Object.keys(presetsFor('de_nuke', level))[0]](), utility: [], context: { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } } };
      const a = e.analyze(b, 300);
      console.log(`L${level} predictions:`, a.predictions.map(p => `${p.label} ${(p.probability * 100).toFixed(0)}%`).join(' | '));
      expect(a.predictions.length).toBeGreaterThan(1);
    }
  });
});

describe('round review (chess-style grading)', () => {
  it('grades kills, deaths and flashes from a demo-shaped round', async () => {
    const { simulate, SIM_DT } = await import('../combat');
    const { buildReplay, reviewRound, GRADE_INFO } = await import('../recap');
    const { tPlaysFor } = await import('../../map/catalog');
    const e = getEngine('de_mirage');
    const b = board('de_mirage', 'Default 2-1-2');
    b.players = [...b.players, ...tPlaysFor('de_mirage')['A execute']()];
    b.utility = [{ id: 'f1', type: 'flash', pos: { x: 700, y: 640 }, throwAt: 12 }];
    const sim = simulate(e, b, 40, 3);
    // turn the simulated round into what tools/demo.mjs would produce
    const step = Math.round(0.25 / SIM_DT);
    const t: number[] = [];
    for (let s = 0; s < sim.steps; s += step) t.push(s * SIM_DT);
    const players: any = {};
    b.players.forEach((p, i) => {
      const f = { side: p.side, x: [] as number[], y: [] as number[], z: [] as number[], yaw: [] as number[], hp: [] as number[], alive: [] as number[] };
      for (let s = 0; s < sim.steps; s += step) {
        const w = radarToWorld({ x: sim.x[i][s], y: sim.y[i][s] }, e.map.radar);
        f.x.push(w.x); f.y.push(w.y); f.z.push(0); f.yaw.push((-sim.facing[i][s] * 180) / Math.PI);
        f.hp.push(s * SIM_DT < sim.deathT[i] ? 100 : 0); f.alive.push(s * SIM_DT < sim.deathT[i] ? 1 : 0);
      }
      players[p.id] = f;
    });
    const kills = sim.kills.map(k => { const w = radarToWorld(k.at, e.map.radar); return { t: k.t, attacker: k.killer, victim: k.victim, weapon: 'ak47', headshot: false, x: w.x, y: w.y, ax: 0, ay: 0 }; });
    const thrower = b.players.find(p => p.side === 'T')!.id;
    const demo = {
      map: 'de_mirage', tickrate: 64, names: Object.fromEntries(b.players.map(p => [p.id, `${p.side}${p.label || b.players.indexOf(p)}`])),
      rounds: [{
        n: 1, winner: null, reason: '', duration: 40, plant: null, frames: { t, players }, kills,
        util: [{ t: 13.2, type: 'flash' as const, thrower, ...radarToWorld({ x: 700, y: 640 }, e.map.radar) }],
        blind: sim.utilEvents.filter(u => u.kind === 'blind').map(u => ({ t: u.t, victim: u.id, attacker: thrower, dur: u.amount })),
      }],
    };
    const t0 = performance.now();
    const rep = buildReplay(e, demo, 0, b.context);
    const rev = reviewRound(e, rep);
    console.log(`review in ${(performance.now() - t0).toFixed(0)} ms; eval start ${(rev.curve[0].ct * 100).toFixed(0)}% → end ${(rev.curve.at(-1)!.ct * 100).toFixed(0)}%`);
    for (const m of rev.moves) console.log(`  ${m.t.toFixed(1).padStart(5)}s ${GRADE_INFO[m.grade].mark.padEnd(2)} ${GRADE_INFO[m.grade].label.padEnd(10)} ${(m.gain >= 0 ? '+' : '') + (m.gain * 100).toFixed(0)}%  ${m.title} — ${m.why.slice(1).join(' ')}`);
    expect(rev.moves.filter(m => m.kind === 'kill').length).toBe(sim.kills.filter(k => k.killer).length);
    expect(rev.curve.every(c => c.ct >= 0 && c.ct <= 1)).toBe(true);
  });
});

describe('line-ups', () => {
  it('built-in line-ups stand and land on walkable floor', async () => {
    const { BUILTIN_LINEUPS, flightTime } = await import('../../map/lineups');
    for (const l of BUILTIN_LINEUPS) {
      const e = getEngine(l.map, l.level);
      const near = (p: { x: number; y: number }) => [0, 6, -6].some(dx => [0, 6, -6].some(dy => e.grid.isWalkable({ x: p.x + dx, y: p.y + dy })));
      if (!near(l.from) || !near(l.to)) console.log('off floor:', l.id, near(l.from) ? '' : 'from', near(l.to) ? '' : 'to');
      expect(near(l.from), `${l.id} from`).toBe(true);
      expect(near(l.to), `${l.id} to`).toBe(true);
      const f = flightTime(l, e.map.radar.scale);
      expect(f).toBeGreaterThan(0.5);
      expect(f).toBeLessThan(5.1);
    }
  });
});

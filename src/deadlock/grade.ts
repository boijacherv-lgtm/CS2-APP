/**
 * A player's report card for one match: kills (how much each one was worth), map activity (camps, the urn, crates and
 * statues, bosses, objectives), abilities (the ultimate used, landed, damage by ability), rotations (ganks in other
 * lanes during laning) and survival (deaths, and chances to save a teammate). Each part is a score against players of
 * the same hero in the same position (bench.ts) or, where nothing is learned yet, against the other players in the
 * match. 50 is average; 100 is 2.5 spreads above.
 *
 * Also the Match recap's other parts: the turning points (where the souls lead swung), the economy against the
 * benchmarks, and each ability's use.
 */
import { MAP_UNITS, heroOf, objectiveSpot, type DlTeam } from './data';
import { playerAt, statAt, type DlMatch, type DlStat } from './match';
import { benchAt, BENCH_MARKS, matchPosition } from './bench';
import type { Pos } from './positions';
import type { DlDemo } from './demo';
import { statsAt, ultAt } from './demo';
import type { DlMove } from './coach';
import type { Annotation } from '../engine/recap';

export type GradeKey = 'kills' | 'map' | 'abilities' | 'rotations' | 'survival';
export interface GradeLine { text: string; t?: number; tone?: 'up' | 'down' | 'flat' }
export interface Grade { key: GradeKey; label: string; score: number | null; z: number | null; note: Annotation; summary: string; lines: GradeLine[] }
export interface ReportCard { slot: number; pos: Pos | null; overall: number | null; note: Annotation; parts: Grade[] }

const near = (u: number) => u / MAP_UNITS;
const HELP = 2500, FIGHT = 2200;
const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
/** A z-score as 0–100 (50 average, ±2.5 spreads at the ends). */
export const scoreOf = (z: number) => Math.round(clamp(50 + 20 * z, 0, 100));
export const noteOf = (z: number): Annotation => (z >= 1.4 ? '!!' : z >= 0.6 ? '!' : z > -0.6 ? 'book' : z > -1.2 ? '?!' : z > -1.8 ? '?' : '??');
const zOf = (v: number, m: number, s: number) => clamp((v - m) / Math.max(s, Math.abs(m) * 0.1, 1e-6), -3, 3);
/** How much a victim's death matters by their farm position: the carry most. */
const POS_WEIGHT: Record<number, number> = { 1: 1.5, 2: 1.3, 3: 1.1, 4: 0.95, 5: 0.85, 6: 0.75 };

/** The last benchmark minute the match reached (and the snapshot read at it, as the benchmarks were learned). */
function markOf(m: DlMatch) { const mk = [...BENCH_MARKS].reverse().find(x => x * 60 <= m.duration) ?? null; return mk; }
const statAtMark = (m: DlMatch, slot: number, mark: number) => statAt(m, slot, mark * 60 + 5);

/** Each kill's worth: the victim's position and wealth, and what the kill opened up (an objective, the mid boss). */
export function killValue(m: DlMatch, d: DlMatch['deaths'][number]) {
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  const victim = m.players.find(p => p.slot === d.slot)!, killerTeam = (1 - victim.team) as DlTeam;
  const pos = matchPosition(m, d.slot) ?? 4;
  const theirs = m.players.filter(p => p.team === victim.team).map(p => statAt(m, p.slot, d.t)?.netWorth ?? 0);
  const rich = clamp((statAt(m, d.slot, d.t)?.netWorth ?? 0) / Math.max(1, mean(theirs)), 0.5, 2);
  const obj = m.objectives.find(o => o.team === victim.team && o.destroyed !== null && o.destroyed > d.t && o.destroyed - d.t <= 40);
  const boss = m.midBoss.find(b => b.team === killerTeam && b.t > d.t && b.t - d.t <= 60);
  // first blood of a fight: none of the killer's team died in the 10 s before
  const opener = !m.deaths.some(o => teamOf.get(o.slot) === killerTeam && o.t <= d.t && d.t - o.t <= 10);
  const value = POS_WEIGHT[pos] * (0.6 + 0.4 * rich) + (obj ? 0.6 : 0) + (boss ? 0.8 : 0) + (opener ? 0.2 : 0);
  const why = [`their Pos ${pos}`, rich >= 1.25 ? 'richer than their team' : rich <= 0.8 ? 'poorer than their team' : null,
    obj ? `opened the ${obj.name} (${Math.round(obj.destroyed! - d.t)} s later)` : null, boss ? 'led to the Mid Boss' : null, opener ? 'opened the fight' : null].filter(Boolean) as string[];
  return { value: +value.toFixed(2), why, lost: obj?.name ?? null, lostIn: obj ? Math.round(obj.destroyed! - d.t) : 0, boss: !!boss };
}

/** Each player's lane during laning: the middle of where they stood from 2 to 9 minutes (x across the map). */
function laneX(m: DlMatch, slot: number) {
  const xs: number[] = [];
  for (let t = 120; t <= 540; t += 5) { const a = playerAt(m, slot, t); if (a) xs.push(a.x); }
  xs.sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
}

/** Ganks during laning (1:30–12:00): stretches of 8 s or more in another lane, and what came of each. */
export function rotations(m: DlMatch, slot: number) {
  const me = m.players.find(p => p.slot === slot)!;
  const own = laneX(m, slot);
  const lanes = [...new Set(m.players.map(p => laneX(m, p.slot)).filter((x): x is number => x !== null).map(x => Math.round(x * 20) / 20))];
  // the three lane columns: group the players' lanes (left, middle, right)
  const cols = [0.2, 0.5, 0.8].map(c => { const g = lanes.filter(x => Math.abs(x - c) < 0.15); return g.length ? mean(g) : c; });
  const colOf = (x: number) => cols.reduce((b, c, i) => (Math.abs(x - c) < Math.abs(x - cols[b]) ? i : b), 0);
  if (own === null) return [];
  const home = colOf(own);
  const out: { from: number; to: number; lane: number; kill: boolean; objective: string | null; enemiesDied: number; moved: boolean }[] = [];
  let start: number | null = null, lane = -1;
  const close = (end: number) => {
    if (start !== null && end - start >= 8) {
      const died = m.deaths.filter(d => m.players.find(p => p.slot === d.slot)?.team !== me.team && d.t >= start! && d.t <= end + 10
        && (() => { const a = playerAt(m, slot, Math.min(d.t, end)); return !!a && Math.hypot(a.x - d.at.x, a.y - d.at.y) <= near(FIGHT * 1.3); })());
      const obj = m.objectives.find(o => o.team !== me.team && o.destroyed !== null && o.destroyed >= start! && o.destroyed <= end + 15);
      out.push({ from: start, to: end, lane, kill: died.length > 0, objective: obj?.name ?? null, enemiesDied: died.length, moved: end - start > 90 });
    }
    start = null;
  };
  for (let t = 90; t <= Math.min(720, m.duration); t += 2) {
    const a = playerAt(m, slot, t);
    // in another lane: closer to its column, and out on the map (not at a base)
    const away = !!a && a.y > 0.12 && a.y < 0.88 && colOf(a.x) !== home && Math.abs(a.x - cols[colOf(a.x)]) < 0.09;
    if (away && start === null) { start = t; lane = colOf(a!.x); } else if (!away && start !== null) close(t);
  }
  close(Math.min(720, m.duration));
  return out;
}

/** A player's report card. `moves` are the coach's graded moves (for the deaths' marks). */
export function reportCard(m: DlMatch, slot: number, demo: DlDemo | null, moves: DlMove[]): ReportCard {
  const me = m.players.find(p => p.slot === slot)!, hero = heroOf(me.hero), team = me.team, enemy = (1 - team) as DlTeam;
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  const pos = matchPosition(m, slot), mark = markOf(m);
  const at = mark !== null ? statAtMark(m, slot, mark) : null;
  const bench = (metric: Parameters<typeof benchAt>[3]) => (mark !== null ? benchAt(me.hero, pos, mark, metric) : null);
  const who = (b: { of: string } | null) => (b?.of === 'hero+pos' ? `Pos ${pos} ${hero.name}` : b?.of === 'hero' ? hero.name : `Pos ${pos}`);
  const parts: Grade[] = [];
  const part = (key: GradeKey, label: string, z: number | null, summary: string, lines: GradeLine[]) =>
    parts.push({ key, label, z: z === null ? null : +z.toFixed(2), score: z === null ? null : scoreOf(z), note: z === null ? 'book' : noteOf(z), summary, lines });

  // ---- kills: how many, and what they were worth --------------------------------------------------------------------
  {
    const kills = m.deaths.filter(d => d.killer === slot && teamOf.get(d.slot) === enemy).map(d => ({ d, ...killValue(m, d) }));
    const deaths = m.deaths.filter(d => d.slot === slot).map(d => ({ d, ...killValue(m, d) }));
    const bk = bench('k'), bd = bench('d');
    const k = at?.kills ?? me.kills, dd = at?.deaths ?? me.deaths;
    const avgVal = kills.length ? mean(kills.map(x => x.value)) : 1;
    const z = bk && bd ? (zOf(k, bk.mean, bk.sd) - zOf(dd, bd.mean, bd.sd)) / 2 + clamp(avgVal - 1.1, -0.5, 0.5) : null;
    const best = [...kills].sort((a, b) => b.value - a.value).slice(0, 3), worst = [...deaths].sort((a, b) => b.value - a.value).slice(0, 2);
    part('kills', 'Kills', z, `${me.kills} ${me.kills === 1 ? 'kill' : 'kills'} · ${me.deaths} ${me.deaths === 1 ? 'death' : 'deaths'} · ${me.assists} ${me.assists === 1 ? 'assist' : 'assists'}${bk && mark ? ` (avg ${bk.mean.toFixed(1)} · ${bd!.mean.toFixed(1)} by ${mark} min)` : ''}`, [
      ...best.map(x => ({ t: x.d.t, tone: 'up' as const, text: `${mins(x.d.t)} killed ${heroOf(m.players.find(p => p.slot === x.d.slot)!.hero).name}: worth ${x.value.toFixed(1)} (${x.why.join(', ')})` })),
      ...worst.map(x => ({ t: x.d.t, tone: 'down' as const, text: `${mins(x.d.t)} your death cost ${x.value.toFixed(1)}${x.lost ? ` (your ${x.lost} fell ${x.lostIn} s later)` : x.boss ? ' (they took the Mid Boss after)' : ''}` })),
      ...(kills.length ? [{ text: `Average kill worth ${avgVal.toFixed(2)} (1.0 is a typical kill on a mid-farm hero; carries and kills that open objectives count more).` }] : []),
    ]);
  }

  // ---- map activity: camps, the urn, bosses (souls by source), crates and statues, objectives you were at ------------
  {
    const zs: number[] = [], lines: GradeLine[] = [];
    const src = at?.souls;
    const SRC: [keyof NonNullable<DlStat['souls']>, 'camps' | 'urn' | 'boss', string][] = [['camps', 'camps', 'Camps'], ['urn', 'urn', 'Urn'], ['boss', 'boss', 'Bosses']];
    if (src && mark !== null) for (const [k, metric, label] of SRC) {
      const b = bench(metric);
      if (!b) continue;
      const z = zOf(src[k], b.mean, b.sd);
      // the urn is rare: only count it when it went well (one urn more than average is a lot) or there's a real gap
      zs.push(metric === 'urn' ? clamp(z, -0.8, 2) : z);
      lines.push({ tone: z >= 0.5 ? 'up' : z <= -0.5 ? 'down' : 'flat', text: `${label}: ${Math.round(src[k]).toLocaleString()} souls by ${mark} min (average ${who(b)}: ${Math.round(b.mean).toLocaleString()})` });
    }
    // crates and statues: against everyone in this match, per 10 minutes
    const per10 = (s: number) => ((m.pickups?.[s] ?? []).filter(p => p.permanent).length / Math.max(1, m.duration)) * 600;
    if (m.pickups) {
      const all = m.players.map(p => per10(p.slot)), mine = per10(slot);
      const z = zOf(mine, mean(all), sd(all));
      zs.push(z);
      const buffs = (m.pickups[slot] ?? []).filter(p => !p.permanent).length;
      lines.push({ tone: z >= 0.5 ? 'up' : z <= -0.5 ? 'down' : 'flat', text: `Crates and statues: ${(m.pickups[slot] ?? []).filter(p => p.permanent).length} broken (${mine.toFixed(1)} per 10 min; match average ${mean(all).toFixed(1)}) · ${buffs} powerups taken` });
    }
    // their objectives that fell with you there (within a twelfth of the map)
    const fell = m.objectives.filter(o => o.team === enemy && o.destroyed !== null);
    const there = (s: number) => fell.filter(o => { const sp = objectiveSpot(enemy, o.id), a = playerAt(m, s, o.destroyed! - 1); return !!sp && !!a && Math.hypot(a.x - sp.x, a.y - sp.y) < 0.085; });
    if (fell.length) {
      const mates = m.players.filter(p => p.team === team).map(p => there(p.slot).length), mine = there(slot);
      const z = zOf(mine.length, mean(mates), sd(mates));
      zs.push(z);
      lines.push({ tone: z >= 0.5 ? 'up' : z <= -0.5 ? 'down' : 'flat', text: `Objectives: at ${mine.length} of the ${fell.length} that fell (your team's average ${mean(mates).toFixed(1)})${mine.length ? `: ${mine.slice(0, 4).map(o => `${o.name} ${mins(o.destroyed!)}`).join(', ')}` : ''}` });
    }
    if (demo) {
      const carried = demo.urn.filter(u => u.slot === slot), mineTeam = demo.urn.filter(u => u.slot !== null && teamOf.get(u.slot) === team).length;
      lines.push({ text: `Urn: picked up ${carried.length} of the ${demo.urn.filter(u => u.taken !== null).length} taken (${mineTeam} by your team)`, ...(carried[0] ? { t: carried[0].taken! } : {}) });
    }
    part('map', 'Map activity', zs.length ? mean(zs) : null, `${pos ? `Pos ${pos}` : ''} · camps, the urn, crates and statues, bosses and objectives`, lines);
  }

  // ---- abilities: damage by ability (match data); the ultimate used, how often, and what it led to (demo) -------------
  {
    const by = m.damageBy?.[slot] ?? {}, lines: GradeLine[] = [], zs: number[] = [];
    const kit = hero.abilities ?? [];
    const total = statAt(m, slot, m.duration)?.playerDamage ?? me.netWorth * 0;
    const abil = kit.map(a => ({ a, dmg: by[a.cls] ?? 0 }));
    const abilTotal = abil.reduce((s, x) => s + x.dmg, 0);
    if (total > 0) lines.push({ text: `Damage to heroes: ${Math.round(total).toLocaleString()}, ${Math.round((abilTotal / total) * 100)}% from abilities (${abil.filter(x => x.dmg > 0).sort((a, b) => b.dmg - a.dmg).map(x => `${x.a.name} ${Math.round(x.dmg).toLocaleString()}`).join(', ') || 'none counted'})` });
    const bDmg = bench('dmg');
    if (bDmg && at) { const z = zOf(at.playerDamage, bDmg.mean, bDmg.sd); zs.push(z); lines.push({ tone: z >= 0.5 ? 'up' : z <= -0.5 ? 'down' : 'flat', text: `Hero damage by ${mark} min: ${Math.round(at.playerDamage).toLocaleString()} (average ${who(bDmg)}: ${Math.round(bDmg.mean).toLocaleString()})` }); }
    const ult = kit.find(a => a.ult), u = demo?.ults?.[slot];
    if (ult && u && u.from !== null) {
      const uses = u.cds.map(c => c[0]);
      // chances: the time it was unlocked over its cooldown plus a little time to find a fight
      const chances = Math.max(1, (m.duration - u.from) / (ult.cd + 25));
      const rate = uses.length / chances;
      const landed = uses.filter(t => m.deaths.some(d => teamOf.get(d.slot) === enemy && d.t >= t && d.t - t <= 8
        && (() => { const a = playerAt(m, slot, t), b = d.at; return !!a && Math.hypot(a.x - b.x, a.y - b.y) <= near(FIGHT * 1.5); })()));
      zs.push(clamp((rate - 0.55) / 0.2, -2, 2), clamp((landed.length / Math.max(1, uses.length) - 0.35) / 0.2, -2, 2));
      lines.push({ tone: rate >= 0.6 ? 'up' : rate < 0.4 ? 'down' : 'flat', text: `${ult.name}: used ${uses.length}× out of about ${Math.round(chances)} chances (unlocked ${mins(u.from)}, ${ult.cd} s cooldown)` });
      lines.push({ tone: landed.length / Math.max(1, uses.length) >= 0.5 ? 'up' : 'flat', text: `${landed.length} of ${uses.length} ultimates were followed by an enemy death within 8 s${by[ult.cls] ? `; ${Math.round(by[ult.cls]).toLocaleString()} damage from it` : ''}`, ...(landed[0] !== undefined ? { t: landed[0] } : {}) });
      const casts = demo!.casts.filter(c => c.slot === slot && !c.ult);
      if (casts.length) {
        const all = m.players.map(p => demo!.casts.filter(c => c.slot === p.slot && !c.ult).length);
        lines.push({ text: `${casts.length} other ability casts (${(casts.length / (m.duration / 60)).toFixed(1)} a minute; match average ${(mean(all) / (m.duration / 60)).toFixed(1)})` });
      }
    } else if (ult) lines.push({ text: `How the ultimate was used needs the match's demo (not available for this match).` });
    part('abilities', 'Abilities', zs.length ? mean(zs) : null, demo ? 'Damage, the ultimate and casts' : 'Damage by ability (the ultimate\'s use needs the demo)', lines);
  }

  // ---- rotations: ganks during laning -------------------------------------------------------------------------------
  {
    // ganks: trips of up to 90 s (a longer stay is a lane change, shown but not scored)
    const all0 = rotations(m, slot), rs = all0.filter(r => !r.moved), good = rs.filter(r => r.kill || r.objective);
    const LANE = ['left', 'middle', 'right'];
    const worth = (x: ReturnType<typeof rotations>) => { const g = x.filter(r => !r.moved), ok = g.filter(r => r.kill || r.objective).length; return ok - 0.3 * (g.length - ok); };
    const all = m.players.map(p => worth(rotations(m, p.slot)));
    const mine = worth(all0);
    const z = rs.length || mean(all) > 0 ? zOf(mine, mean(all), sd(all)) : null;
    part('rotations', 'Rotations', z, rs.length ? `${rs.length} gank${rs.length > 1 ? 's' : ''} in another lane during laning, ${good.length} paid off` : 'No ganks in another lane during laning', all0.slice(0, 6).map(r => ({
      t: r.from, tone: r.moved ? 'flat' as const : r.kill || r.objective ? 'up' as const : 'down' as const,
      text: `${mins(r.from)}–${mins(r.to)} ${r.moved ? 'moved to' : 'in'} the ${LANE[r.lane]} lane: ${r.kill ? `${r.enemiesDied} enemy death${r.enemiesDied > 1 ? 's' : ''}` : 'no kill'}${r.objective ? `, their ${r.objective} fell` : ''}`,
    })));
  }

  // ---- survival: deaths against the benchmark, avoidable ones (the coach's marks), chances to save a teammate --------
  {
    const bd = bench('d'), dd = at?.deaths ?? me.deaths;
    const bad = moves.filter(x => x.kind === 'death' && x.slot === slot && (x.note === '?' || x.note === '??'));
    const lines: GradeLine[] = bad.slice(0, 4).map(x => ({ t: x.t, tone: 'down' as const, text: `${mins(x.t)} ${x.tags.join(', ').toLowerCase() || 'avoidable death'}` }));
    // a teammate died near you while you lived, and your ultimate was ready (demo: exact)
    const saves = m.deaths.filter(d => teamOf.get(d.slot) === team && d.slot !== slot).filter(d => {
      const a = playerAt(m, slot, d.t - 1);
      if (!a || Math.hypot(a.x - d.at.x, a.y - d.at.y) > near(HELP)) return false;
      if (m.deaths.some(x => x.slot === slot && Math.abs(x.t - d.t) <= 3)) return false;
      return demo ? ultAt(demo, slot, d.t - 1)?.state === 'ready' : false;
    });
    for (const d of saves.slice(0, 4)) lines.push({ t: d.t, tone: 'down', text: `${mins(d.t)} ${heroOf(m.players.find(p => p.slot === d.slot)!.hero).name} died next to you with your ultimate ready` });
    const z = bd ? -zOf(dd, bd.mean, bd.sd) - 0.15 * bad.length - 0.15 * saves.length + 0.25 : null;
    part('survival', 'Survival', z === null ? null : clamp(z, -3, 3), `${me.deaths} deaths${bd && mark ? ` (by ${mark} min ${dd}; average ${who(bd)} ${bd.mean.toFixed(1)})` : ''} · ${bad.length} avoidable${demo ? ` · ${saves.length} teammate${saves.length === 1 ? '' : 's'} died near you with your ultimate ready` : ''}`, lines);
  }

  const scored = parts.filter(p => p.z !== null);
  const W: Record<GradeKey, number> = { kills: 1.2, map: 1, abilities: 1, rotations: 0.6, survival: 1.2 };
  const oz = scored.length ? scored.reduce((a, p) => a + p.z! * W[p.key], 0) / scored.reduce((a, p) => a + W[p.key], 0) : null;
  return { slot, pos, overall: oz === null ? null : scoreOf(oz), note: oz === null ? 'book' : noteOf(oz), parts };
}

// ---- Match recap: turning points, economy, abilities ------------------------------------------------------------------

/** The souls lead (team's minus theirs) at each snapshot, and the biggest swings with what happened in each. */
export function turningPoints(m: DlMatch, team: DlTeam) {
  const times = [...new Set(Object.values(m.stats).flatMap(ss => ss.map(s => s.t)))].sort((a, b) => a - b);
  const sum = (tm: DlTeam, t: number) => m.players.filter(p => p.team === tm).reduce((a, p) => a + (statAt(m, p.slot, t)?.netWorth ?? 0), 0);
  const lead = times.map(t => ({ t, v: sum(team, t) - sum((1 - team) as DlTeam, t) }));
  const teamOf = new Map(m.players.map(p => [p.slot, p.team]));
  const swings = lead.slice(1).map((p, i) => {
    const a = lead[i].t, b = p.t;
    const ours = m.deaths.filter(d => d.t > a && d.t <= b && teamOf.get(d.slot) !== team).length, theirs = m.deaths.filter(d => d.t > a && d.t <= b && teamOf.get(d.slot) === team).length;
    const took = m.objectives.filter(o => o.destroyed !== null && o.destroyed > a && o.destroyed <= b && o.team !== team).map(o => o.name);
    const lost = m.objectives.filter(o => o.destroyed !== null && o.destroyed > a && o.destroyed <= b && o.team === team).map(o => o.name);
    const boss = m.midBoss.filter(x => x.t > a && x.t <= b).map(x => x.team);
    return { from: a, to: b, delta: p.v - lead[i].v, lead: p.v, kills: ours, deaths: theirs, took, lost, boss };
  });
  const top = [...swings].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 4).sort((x, y) => x.from - y.from);
  return { lead, swings, top };
}

/** Net worth and souls by source against the benchmarks at each minute mark. */
export function economy(m: DlMatch, slot: number) {
  const me = m.players.find(p => p.slot === slot)!, pos = matchPosition(m, slot);
  return BENCH_MARKS.filter(mk => mk * 60 <= m.duration).map(mk => {
    const s = statAtMark(m, slot, mk), b = benchAt(me.hero, pos, mk, 'nw');
    const src = (['lane', 'camps', 'kills', 'urn', 'boss'] as const).map(k => ({ k, you: s?.souls?.[k] ?? 0, avg: benchAt(me.hero, pos, mk, k)?.mean ?? null }));
    return { minute: mk, nw: s?.netWorth ?? 0, avg: b?.mean ?? null, sd: b?.sd ?? null, of: b?.of ?? null, lh: s?.lastHits ?? 0, lhAvg: benchAt(me.hero, pos, mk, 'lh')?.mean ?? null, src };
  });
}

/** Each ability of the hero: when it was unlocked and upgraded (match data), damage to heroes, and casts (demo). */
export function abilityUse(m: DlMatch, slot: number, demo: DlDemo | null) {
  const me = m.players.find(p => p.slot === slot)!, kit = heroOf(me.hero).abilities ?? [];
  const items = m.items[slot] ?? [];
  return kit.map(a => {
    const ups = a.id ? items.filter(i => i.id === a.id).map(i => i.t) : [];
    return { a, unlocked: ups[0] ?? null, upgrades: ups.slice(1), damage: m.damageBy?.[slot]?.[a.cls] ?? 0,
      casts: demo ? demo.casts.filter(c => c.slot === slot && (a.ult ? c.ult : c.name === a.name)).length : null };
  });
}

/** A player's net worth at time t: from the demo (every 2 s) when there is one, else between the match's snapshots. */
export function worthAt(m: DlMatch, demo: DlDemo | null, slot: number, t: number) {
  const d = statsAt(demo, slot, t);
  if (d && d.nw > 0) return d.nw;
  const ss = m.stats[slot] ?? [];
  const j = ss.findIndex(s => s.t >= t);
  if (j <= 0) return j === 0 ? ss[0].netWorth * Math.min(1, t / Math.max(1, ss[0].t)) : ss.at(-1)?.netWorth ?? 0;
  const a = ss[j - 1], b = ss[j];
  return a.netWorth + ((b.netWorth - a.netWorth) * (t - a.t)) / Math.max(1, b.t - a.t);
}

/** Each team's souls every `step` seconds (Amber Hand, Sapphire Flame). */
export function teamSouls(m: DlMatch, demo: DlDemo | null, step = 30) {
  const out: { t: number; v: [number, number] }[] = [];
  for (let t = 0; t <= m.duration; t += step) {
    const v: [number, number] = [0, 0];
    for (const p of m.players) v[p.team] += worthAt(m, demo, p.slot, t);
    out.push({ t, v });
  }
  if (out.at(-1)!.t < m.duration) { const v: [number, number] = [0, 0]; for (const p of m.players) v[p.team] += worthAt(m, demo, p.slot, m.duration); out.push({ t: m.duration, v }); }
  return out;
}

/** The enemy you're measured against: the one in the same position (by farm), else the one in your lane. */
export function laneOpponent(m: DlMatch, slot: number) {
  const me = m.players.find(p => p.slot === slot)!, pos = matchPosition(m, slot);
  const foes = m.players.filter(p => p.team !== me.team);
  return foes.find(p => matchPosition(m, p.slot) === pos) ?? foes.find(p => p.lane === me.lane) ?? null;
}

/** Souls carried and not spent when each death came (net worth minus what the items held then cost). */
export function unspentAtDeaths(m: DlMatch, slot: number, demo: DlDemo | null, cost: (item: number) => number | null) {
  return m.deaths.filter(d => d.slot === slot).map(d => {
    const owned = (m.items[slot] ?? []).filter(i => i.t <= d.t && (i.sold === null || i.sold > d.t)).reduce((a, i) => a + (cost(i.id) ?? 0), 0);
    return { t: d.t, unspent: Math.max(0, Math.round(worthAt(m, demo, slot, d.t - 1) - owned)) };
  });
}

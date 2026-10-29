/**
 * When things happen in a Deadlock match: the game's rules as the Deadlock Wiki has them (deadlock.wiki: Map, Soul
 * Urn, Midboss, Haunt, Sinner's Sacrifice, Powerup, Unstable Rift, Crate, Trooper pages), read 2026-10-29 for the
 * patch after October 13, 2026. Checked against 37 of Benaiah's normal matches where the match data records it
 * (permanent buff tiers at 10:00 / 30:00, the mid boss's respawns, breakables from 3:00). When a patch changes a
 * timing, this is the one place to change it.
 */
import type { DlTeam } from './data';

export const TIMINGS_SOURCE = { url: 'https://deadlock.wiki/Map', read: '2026-10-29' };

export const RULES = {
  /** Neutral camps: first spawn, and respawn once the whole camp is cleared (s). */
  camps: { small: { spawn: 120, respawn: 85 }, medium: { spawn: 300, respawn: 290 }, strong: { spawn: 480, respawn: 335 } },
  /** Sinner's Sacrifice (the "vault" camps): first spawn, respawn 5 min after the camp is cleared. */
  sinners: { spawn: 480, respawn: 300 },
  healingSnacks: { spawn: 150, respawn: 180 },
  /** Crates and golden statues: most from 3:00 (3 min respawn); mid boxes above the mid boss from 10:00; tunnels from 5:00 (5 min). */
  breakables: { spawn: 180, respawn: 180, mid: 600, tunnels: 300 },
  /** Bridge buffs (powerups): both bridges at 5:00 and on every 5-minute mark after; each lasts 160 s. */
  bridgeBuffs: { spawn: 300, every: 300, lasts: 160 },
  /** Soul Urn: lands 12.5 s after 10:00 and every 5-minute mark (Yellow first, then alternating); a carried urn
   * holds the next one back until it's delivered or expires. */
  urn: { spawn: 600, every: 300, descent: 12.5 },
  /** Unstable Rift: shows on a side-lane bridge at 11:00 ± 1 min, contest opens 60 s later; again every 7 ± 1 min. */
  rift: { spawn: 660, every: 420, jitter: 60, opensAfter: 60 },
  /** Mid boss: there from the start; back 7, 6, then 5 min after each kill. */
  midBoss: { respawn: [420, 360, 300] },
  /** Permanent buffs get stronger at 10:00 (level 2) and 30:00 (level 3). */
  buffTiers: [0, 600, 1800],
  /** Guardians lose their damage resistance at 12:00, walkers at 18:00. */
  guardiansOpen: 720, walkersOpen: 1080,
  /** Trooper waves every 30 s, every 25 s from 20:00, every 20 s from 35:00 (+50% health). */
  waves: [{ from: 0, every: 30 }, { from: 1200, every: 25 }, { from: 2100, every: 20 }],
};

export type Lane = 'Yellow' | 'Green';
/** Which lane's bridge an urn spawned at time t lands at (Yellow first). */
export const urnLane = (t: number): Lane => (Math.round((t - RULES.urn.spawn) / RULES.urn.every) % 2 === 0 ? 'Yellow' : 'Green');

export interface TimelineEvent { t: number; kind: 'camps' | 'sinners' | 'snacks' | 'breakables' | 'buffs' | 'urn' | 'rift' | 'tier' | 'objectives' | 'waves'; label: string }
/** Everything scheduled up to `until` (s), in order. The rift's time is its middle estimate (± 1 min). */
export function timeline(until = 2400): TimelineEvent[] {
  const R = RULES, ev: TimelineEvent[] = [
    { t: R.camps.small.spawn, kind: 'camps', label: 'Small camps' },
    { t: R.healingSnacks.spawn, kind: 'snacks', label: 'Healing snacks' },
    { t: R.breakables.spawn, kind: 'breakables', label: 'Crates and statues' },
    { t: R.camps.medium.spawn, kind: 'camps', label: 'Medium camps' },
    { t: R.camps.strong.spawn, kind: 'camps', label: 'Large camps' },
    { t: R.sinners.spawn, kind: 'sinners', label: "Sinner's Sacrifice" },
    { t: R.buffTiers[1], kind: 'tier', label: 'Level 2 buffs' },
    { t: R.guardiansOpen, kind: 'objectives', label: 'Guardians lose resistance' },
    { t: R.walkersOpen, kind: 'objectives', label: 'Walkers lose resistance' },
    { t: R.waves[1].from, kind: 'waves', label: 'Waves every 25 s' },
    { t: R.buffTiers[2], kind: 'tier', label: 'Level 3 buffs' },
    { t: R.waves[2].from, kind: 'waves', label: 'Waves every 20 s, troopers +50% HP' },
  ];
  for (let t = R.bridgeBuffs.spawn; t <= until; t += R.bridgeBuffs.every) ev.push({ t, kind: 'buffs', label: 'Bridge buffs' });
  for (let t = R.urn.spawn; t <= until; t += R.urn.every) ev.push({ t, kind: 'urn', label: `Urn (${urnLane(t)})` });
  for (let t = R.rift.spawn; t <= until; t += R.rift.every) ev.push({ t, kind: 'rift', label: 'Unstable Rift (±1 min)' });
  return ev.filter(e => e.t <= until).sort((a, b) => a.t - b.t);
}

export interface TimerRow { what: string; now: string; next: number | null; note?: string }
/**
 * What's up at time t and what's next: the urn, bridge buffs, the rift, the mid boss (from the match's kills when
 * known), camps, buff level and waves. `midBossKills`: when it died in this match (Review), else it's planned as up.
 */
export function timersAt(t: number, midBossKills: { t: number; team: DlTeam }[] | null = null): TimerRow[] {
  const R = RULES, nextOn = (first: number, every: number) => (t < first ? first : first + Math.ceil((t - first) / every + 1e-9) * every);
  const rows: TimerRow[] = [];
  // the urn: the last one that came down, and the next mark
  const urnNext = nextOn(R.urn.spawn, R.urn.every);
  const urnLast = t >= R.urn.spawn ? urnNext - R.urn.every : null;
  rows.push({ what: 'Soul Urn', now: urnLast === null ? 'not yet' : t < urnLast + R.urn.descent ? `landing (${urnLane(urnLast)})` : `out since ${clock(urnLast)} (${urnLane(urnLast)})`, next: urnNext,
    note: `next at ${urnLane(urnNext)}; a carried urn holds it back` });
  const buffNext = nextOn(R.bridgeBuffs.spawn, R.bridgeBuffs.every);
  rows.push({ what: 'Bridge buffs', now: t < R.bridgeBuffs.spawn ? 'not yet' : 'up on both bridges unless taken', next: buffNext, note: `last ${R.bridgeBuffs.lasts} s` });
  const riftNext = nextOn(R.rift.spawn, R.rift.every);
  rows.push({ what: 'Unstable Rift', now: t < R.rift.spawn - R.rift.jitter ? 'not yet' : 'a side-lane bridge', next: riftNext, note: '± 1 min, contest 60 s after it shows' });
  // the mid boss: up from the start; after the n-th kill, back 7 / 6 / 5 min later
  if (midBossKills) {
    const dead = midBossKills.filter(k => k.t <= t);
    const last = dead[dead.length - 1];
    const back = last ? last.t + R.midBoss.respawn[Math.min(dead.length - 1, R.midBoss.respawn.length - 1)] : null;
    rows.push({ what: 'Mid boss', now: !last || (back !== null && t >= back) ? 'up' : `down (taken ${clock(last.t)})`, next: back !== null && t < back ? back : null, note: '7 / 6 / 5 min after each kill' });
  } else rows.push({ what: 'Mid boss', now: 'up from the start', next: null, note: 'back 7 / 6 / 5 min after each kill' });
  const camps = ([['small', 'Small'], ['medium', 'Medium'], ['strong', 'Large']] as const).filter(([k]) => t >= R.camps[k].spawn).map(([, n]) => n);
  const campNext = ([R.camps.small.spawn, R.camps.medium.spawn, R.camps.strong.spawn, R.sinners.spawn] as number[]).find(x => x > t) ?? null;
  rows.push({ what: 'Camps', now: camps.length ? `${camps.join(', ')}${t >= R.sinners.spawn ? ", Sinner's" : ''}` : 'none yet', next: campNext,
    note: `respawn ${clock(R.camps.small.respawn)} / ${clock(R.camps.medium.respawn)} / ${clock(R.camps.strong.respawn)}, Sinner's 5:00 after cleared` });
  const tier = R.buffTiers.filter(x => t >= x).length;
  rows.push({ what: 'Buff level', now: `level ${tier}`, next: R.buffTiers.find(x => x > t) ?? null });
  const wave = [...R.waves].reverse().find(w => t >= w.from)!;
  rows.push({ what: 'Trooper waves', now: `every ${wave.every} s`, next: R.waves.find(w => w.from > t)?.from ?? null });
  return rows;
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

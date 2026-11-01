/**
 * Supports don't show in kills and damage, so they're graded on their own job: vision, and helping the team. Each number
 * is placed among what pro supports do (tools/dota-support.ts), so a typical pro support comes out a B, as a typical
 * level-10 player does in CS2. OpenDota doesn't say who an item was used on: item "help" is only that it was used.
 */
import type { Letter } from '../engine/recap';
import type { D2Team } from './data';
import NORMS from './generated/supportNorms.json';
import type { D2Match } from './match';
import { onProSpot } from './wardSpots';

/** How long an Observer stands if left alone (s). */
const OBSERVER_LIFE = 360;

export interface SupportNumbers {
  /** Vision. Observers: how long they stood (0–1 of their full life), and the share on spots pros use. */
  wardLife: number; onSpot: number; wardsPerMin: number; dewardsPerMin: number;
  /** Team play. Share of the team's kills they were in; stuns (s), skills on allies and helping items, stacks, per minute. */
  killShare: number; stunsPerMin: number; helpPerMin: number; stacksPerMin: number;
}
export type SupportKey = keyof SupportNumbers;
const VISION: SupportKey[] = ['wardLife', 'onSpot', 'wardsPerMin', 'dewardsPerMin'];
const TEAM_PLAY: SupportKey[] = ['killShare', 'stunsPerMin', 'helpPerMin', 'stacksPerMin'];

/** A team's supports: its two poorest heroes, which is how Dota's positions 4 and 5 show in a match. */
export function supportsOf(m: D2Match, team: D2Team): number[] {
  return m.players.filter(p => p.team === team).sort((a, b) => a.netWorth - b.netWorth).slice(0, 2).map(p => p.slot);
}

export function supportNumbers(m: D2Match, slot: number): SupportNumbers {
  const p = m.players[slot], minutes = Math.max(1, m.duration / 60);
  const observers = m.wards.filter(w => w.slot === slot && w.kind === 'obs');
  const teamKills = m.players.filter(o => o.team === p.team).reduce((a, o) => a + o.kills, 0);
  return {
    wardLife: observers.length ? observers.reduce((a, w) => a + Math.min(1, (w.until - w.t) / OBSERVER_LIFE), 0) / observers.length : 0,
    onSpot: observers.length ? observers.filter(w => onProSpot(p.team, w.t, 'obs', w.at)).length / observers.length : 0,
    wardsPerMin: (p.obs + p.sen) / minutes, dewardsPerMin: p.dewards / minutes,
    killShare: teamKills ? (p.kills + p.assists) / teamKills : 0,
    stunsPerMin: p.stuns / minutes, helpPerMin: (p.allyCasts + p.helpItems) / minutes, stacksPerMin: p.stacks / minutes,
  };
}

const QUANTILES = (NORMS as unknown as { norms: Partial<Record<SupportKey, number[]>> }).norms;
export const NORM_SAMPLE = { matches: NORMS.matches, supports: NORMS.supports };
/** How much of the pro supports this number beats, 0–1 (a half without norms to go on). Norms are 21 steps, 0% to 100%. */
export function standing(key: SupportKey, value: number): number {
  const q = QUANTILES[key];
  if (!q?.length) return 0.5;
  // ties count half, so a metric most pros are at zero on doesn't flatter anyone for being at zero too
  const below = q.filter(x => x < value).length, same = q.filter(x => x === value).length;
  return (below + same / 2) / q.length;
}
/** A letter from a standing among pros: the middle of them is a B. */
export function letterOfStanding(v: number): Letter {
  return v >= 0.9 ? 'S+' : v >= 0.78 ? 'S' : v >= 0.62 ? 'A' : v >= 0.38 ? 'B' : v >= 0.24 ? 'C' : v >= 0.1 ? 'D' : 'F';
}
const standingOf = (n: SupportNumbers, keys: SupportKey[]) => keys.reduce((a, k) => a + standing(k, n[k]), 0) / keys.length;
export const visionLetter = (n: SupportNumbers) => letterOfStanding(standingOf(n, VISION));
export const teamPlayLetter = (n: SupportNumbers) => letterOfStanding(standingOf(n, TEAM_PLAY));

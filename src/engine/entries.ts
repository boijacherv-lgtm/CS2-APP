import { gunOf } from './guns';
import type { Analysis, TacticalEngine } from './predict';
import type { BoardState, SiteId, Vec2 } from './types';

/**
 * Entry points (chokepoints) explained in game terms: when Ts get there, who is actually holding
 * it and with what, whether that hold is set in time, how much of the expected T pressure comes
 * through it, and how fast help arrives if it falls.
 */

export type EntryLevel = 'open' | 'weak' | 'held' | 'strong';

export interface EntryReport {
  id: string;
  name: string;
  feeds: SiteId[];
  center: Vec2;
  portal: [Vec2, Vec2];
  tFirst: number; // fastest T arrival (s)
  holders: { id: string; label: string; gun: string; readyAt: number; inTime: boolean; awp: boolean }[];
  crossfire: boolean;
  /** Expected share of the T team coming through here, from the predicted plays (0..1). */
  pressure: number;
  reinforce: number; // s for a second CT to reach the site behind it
  level: EntryLevel;
  threat: number;
  /** One line for the map. */
  headline: string;
  /** Sentences for the panel. */
  details: string[];
}

export function entryReports(engine: TacticalEngine, analysis: Analysis, board: BoardState): EntryReport[] {
  const byId = new Map(board.players.map(p => [p.id, p]));
  const strat = new Map(engine.strats.map(s => [s.id, s]));
  return analysis.chokes.map(c => {
    const center = { x: (c.choke.portal[0].x + c.choke.portal[1].x) / 2, y: (c.choke.portal[0].y + c.choke.portal[1].y) / 2 };
    const tFirst = c.tArrival.min;
    const holders = c.defenders.map(d => {
      const p = byId.get(d.playerId);
      const gun = p ? gunOf(p) : undefined;
      return {
        id: d.playerId, label: p ? `${p.side} ${p.label}` : '?', gun: gun?.short ?? '', awp: gun?.cls === 'awp',
        readyAt: d.readyAt, inTime: d.readyAt <= tFirst - 0.5,
      };
    });
    const crossfire = holders.length >= 2 && c.crossfire >= 0.5;
    let pressure = 0;
    for (const p of analysis.predictions) {
      const s = strat.get(p.id);
      if (!s) continue;
      for (const g of s.groups) if (g.route.includes(c.choke.id)) pressure += p.probability * (g.size / 5);
    }
    const set = holders.filter(h => h.inTime);
    const level: EntryLevel = !holders.length ? 'open' : !set.length ? 'weak' : crossfire && set.length >= 2 ? 'strong' : c.threat > 0.55 ? 'weak' : 'held';

    const names = (hs: typeof holders) => hs.map(h => `${h.label}${h.gun ? ` (${h.gun})` : ''}`).join(' + ');
    const headline =
      level === 'open' ? 'OPEN: nobody is watching it'
      : !set.length ? `${names(holders)} not set in time`
      : crossfire ? `Crossfire: ${names(set)}`
      : `${names(set)} alone, no crossfire`;

    const details: string[] = [];
    details.push(`Ts can be here from ${clock(tFirst)} (fastest spawn).`);
    if (!holders.length) details.push('No CT has a sightline on it, so Ts walk through for free.');
    for (const h of holders)
      details.push(h.inTime
        ? `${h.label}${h.gun ? ` with the ${h.gun}` : ''} is set by ${clock(h.readyAt)}${h.awp ? ': an AWP here punishes a dry peek' : ''}.`
        : `${h.label} only gets there at ${clock(h.readyAt)}: ${(h.readyAt - tFirst).toFixed(1)}s after the first T could.`);
    if (holders.length >= 2 && !crossfire) details.push('The holders look at it from the same direction: one flash or one jiggle clears both.');
    if (pressure >= 0.05) details.push(`About ${Math.round(pressure * 5 * 10) / 10} of the 5 Ts are expected to come this way (${pct(pressure)} of T pressure).`);
    else details.push('The predicted T plays rarely use it.');
    if (Number.isFinite(c.reinforceTime)) details.push(`If it falls, a second CT reaches ${c.choke.feeds.join('/')} in about ${Math.round(c.reinforceTime)}s.`);
    return { id: c.choke.id, name: c.choke.name, feeds: c.choke.feeds, center, portal: c.choke.portal, tFirst, holders, crossfire, pressure, reinforce: c.reinforceTime, level, threat: c.threat, headline, details };
  });
}

/** Live status of an entry at round time t. */
export function entryClock(e: EntryReport, t: number): string {
  if (t >= e.tFirst + 6) return 'Ts through';
  if (t >= e.tFirst) return 'Ts here';
  if (e.tFirst - t <= 5) return `Ts in ${Math.ceil(e.tFirst - t)}s`;
  return `Ts ${clock(e.tFirst)}`;
}

export const ENTRY_COLOR: Record<EntryLevel, string> = { open: '#ff4d4d', weak: '#ffb020', held: '#7fbf4d', strong: '#3ddc84' };

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * A Deadlock match from deadlock-api.com's match metadata, in the shape the board and the coach use: who played,
 * where everyone was every second, deaths, objectives, items and stats over time.
 */
import { objectiveOf, toMap, type DlTeam, type ObjectiveKind } from './data';

export interface DlPlayer {
  slot: number; account: number; team: DlTeam; hero: number;
  /** Assigned lane in the match data (1 / 4 / 6: see laneOfAssigned). */
  lane: number;
  kills: number; deaths: number; assists: number; netWorth: number; level: number; lastHits: number; denies: number;
}
/** Every second of a player: where (on the minimap, 0–1) and health (0–100; 0 = dead). */
export interface DlTrack { x: Float32Array; y: Float32Array; hp: Uint8Array }
export interface DlDeath { t: number; slot: number; killer: number | null; at: { x: number; y: number }; from: { x: number; y: number } | null; respawn: number;
  /** How long the fight that killed them took (s), when the match data has it. */
  ttk?: number }
export interface DlObjective { team: DlTeam; id: number; kind: ObjectiveKind; lane: 1 | 3 | 4 | null; name: string; firstDamage: number | null; destroyed: number | null }
/** A player's numbers at a moment (every few minutes and at the end). */
export interface DlStat { t: number; netWorth: number; kills: number; deaths: number; assists: number; level: number; lastHits: number; possibleCreeps: number; denies: number; playerDamage: number }
export interface DlItem { t: number; id: number; sold: number | null }

export interface DlMatch {
  id: number; start: number; duration: number; winner: DlTeam;
  players: DlPlayer[];
  tracks: Record<number, DlTrack>;
  deaths: DlDeath[];
  objectives: DlObjective[];
  midBoss: { t: number; team: DlTeam }[];
  stats: Record<number, DlStat[]>;
  items: Record<number, DlItem[]>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The match from `/v1/matches/{id}/metadata` (its `match_info`). */
export function matchFromMetadata(meta: any): DlMatch {
  const m = meta.match_info ?? meta;
  const paths = m.match_paths;
  const res = paths?.x_resolution || 16383, yres = paths?.y_resolution || 16383;
  const tracks: DlMatch['tracks'] = {};
  for (const p of paths?.paths ?? []) {
    const n = p.x_pos.length;
    const x = new Float32Array(n), y = new Float32Array(n), hp = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const at = toMap(p.x_min + (p.x_pos[i] / res) * (p.x_max - p.x_min), p.y_min + (p.y_pos[i] / yres) * (p.y_max - p.y_min));
      x[i] = at.x; y[i] = at.y; hp[i] = Math.max(0, Math.min(100, p.health?.[i] ?? 100));
    }
    tracks[p.player_slot] = { x, y, hp };
  }
  const players: DlPlayer[] = (m.players ?? []).map((p: any) => ({
    slot: p.player_slot, account: p.account_id, team: p.team as DlTeam, hero: p.hero_id, lane: p.assigned_lane ?? 0,
    kills: p.kills ?? 0, deaths: p.deaths ?? 0, assists: p.assists ?? 0, netWorth: p.net_worth ?? 0, level: p.level ?? 0,
    lastHits: p.last_hits ?? 0, denies: p.denies ?? 0,
  })).sort((a: DlPlayer, b: DlPlayer) => a.team - b.team || a.slot - b.slot);
  const deaths: DlDeath[] = (m.players ?? []).flatMap((p: any) => (p.death_details ?? []).map((d: any) => ({
    t: d.game_time_s, slot: p.player_slot, killer: d.killer_player_slot ?? null,
    at: toMap(d.death_pos.x, d.death_pos.y), from: d.killer_pos ? toMap(d.killer_pos.x, d.killer_pos.y) : null, respawn: d.death_duration_s ?? 0,
    ...(typeof d.time_to_kill_s === 'number' ? { ttk: +d.time_to_kill_s.toFixed(1) } : {}),
  }))).sort((a: DlDeath, b: DlDeath) => a.t - b.t);
  const objectives: DlObjective[] = (m.objectives ?? []).map((o: any) => ({
    team: o.team as DlTeam, id: o.team_objective_id, ...objectiveOf(o.team_objective_id),
    firstDamage: o.first_damage_time_s || null, destroyed: o.destroyed_time_s || null,
  }));
  const stats: DlMatch['stats'] = {}, items: DlMatch['items'] = {};
  for (const p of m.players ?? []) {
    stats[p.player_slot] = (p.stats ?? []).map((s: any) => ({
      t: s.time_stamp_s, netWorth: s.net_worth, kills: s.kills, deaths: s.deaths, assists: s.assists, level: s.level,
      lastHits: s.creep_kills, possibleCreeps: s.possible_creeps, denies: s.denies, playerDamage: s.player_damage,
    }));
    items[p.player_slot] = (p.items ?? []).map((i: any) => ({ t: i.game_time_s, id: i.item_id, sold: i.sold_time_s || null }));
  }
  return {
    id: m.match_id, start: m.start_time, duration: m.duration_s, winner: m.winning_team as DlTeam,
    players, tracks, deaths, objectives,
    midBoss: (m.mid_boss ?? []).map((b: any) => ({ t: b.destroyed_time_s, team: b.team_claimed as DlTeam })),
    stats, items,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Where a player is at time t (between the 1 s samples), and their health; null while dead. */
export function playerAt(match: DlMatch, slot: number, t: number): { x: number; y: number; hp: number } | null {
  const tr = match.tracks[slot];
  if (!tr) return null;
  if (match.deaths.some(d => d.slot === slot && t >= d.t && t < d.t + d.respawn)) return null;
  const n = tr.x.length, i = Math.max(0, Math.min(n - 1, Math.floor(t))), j = Math.min(n - 1, i + 1), f = Math.max(0, Math.min(1, t - i));
  // a jump (a teleport, a respawn) isn't drawn as a slide across the map; a zipline or a dash is (up to 12% of the map
  // in a second: below that it's movement)
  const jump = Math.hypot(tr.x[j] - tr.x[i], tr.y[j] - tr.y[i]) > 0.12;
  return { x: jump ? tr.x[i] : tr.x[i] + (tr.x[j] - tr.x[i]) * f, y: jump ? tr.y[i] : tr.y[i] + (tr.y[j] - tr.y[i]) * f, hp: tr.hp[i] };
}

/** A player's numbers at time t: the last snapshot before it (kills / deaths counted from the death list). */
export function statAt(match: DlMatch, slot: number, t: number): DlStat | null {
  const ss = match.stats[slot] ?? [];
  let s: DlStat | null = null;
  for (const x of ss) if (x.t <= t) s = x;
  return s;
}

/** Kills, deaths and assists so far (the deaths list is exact; assists only come with the snapshots). */
export function kdaAt(match: DlMatch, slot: number, t: number) {
  const k = match.deaths.filter(d => d.killer === slot && d.t <= t && d.slot !== slot).length;
  const d = match.deaths.filter(x => x.slot === slot && x.t <= t).length;
  return { k, d, a: statAt(match, slot, t)?.assists ?? 0 };
}

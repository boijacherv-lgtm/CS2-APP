/**
 * A Dota 2 match as OpenDota gives it, read into what Review needs. A parsed match has per-minute stats, every death,
 * ward, building and teamfight; it has no hero positions over time (those come from the replay: tracks.ts), so here a
 * hero's place is only known where the logs say (a ward, a death in a teamfight, the laning heatmap).
 */
import { BUILDINGS, cellToMap, heroByKey, heroOf, type D2Team, type Pt } from './data';

interface RawLog { time: number; key?: string; x?: number; y?: number; time_dead?: number; gold_lost?: number; gold_fed?: number }
interface RawFightPlayer { deaths_pos?: Record<string, Record<string, number>>; ability_uses?: Record<string, number>; damage?: number; gold_delta?: number }
interface RawPlayer {
  account_id?: number | null; personaname?: string | null; name?: string | null; hero_id: number; isRadiant?: boolean; player_slot: number;
  lane?: number | null; kills: number; deaths: number; assists: number; last_hits: number; denies: number; level: number; net_worth?: number;
  gold_per_min: number; xp_per_min: number; hero_damage?: number; tower_damage?: number; hero_healing?: number;
  item_0?: number; item_1?: number; item_2?: number; item_3?: number; item_4?: number; item_5?: number;
  obs_placed?: number; sen_placed?: number; camps_stacked?: number; buyback_count?: number;
  benchmarks?: Record<string, { pct?: number }>; gold_t?: number[]; networth_t?: number[]; lh_t?: number[]; dn_t?: number[]; xp_t?: number[];
  deaths_log?: RawLog[]; kills_log?: RawLog[]; obs_log?: RawLog[]; sen_log?: RawLog[]; obs_left_log?: RawLog[]; sen_left_log?: RawLog[];
  purchase_log?: RawLog[]; runes_log?: RawLog[]; lane_pos?: Record<string, Record<string, number>>;
}
export interface RawMatch {
  match_id: number; duration: number; radiant_win: boolean; start_time: number; version?: number | null; replay_url?: string | null;
  od_data?: { has_parsed?: boolean }; radiant_name?: string; dire_name?: string; radiant_team?: { name?: string }; dire_team?: { name?: string };
  players: RawPlayer[]; radiant_gold_adv?: number[] | null; radiant_xp_adv?: number[] | null;
  objectives?: { time: number; type: string; key?: string; team?: number; slot?: number }[] | null;
  teamfights?: { start: number; end: number; deaths?: number; players: RawFightPlayer[] }[] | null;
}

export interface D2Player {
  slot: number; team: D2Team; hero: number; account: number | null; name: string | null;
  /** OpenDota's lane: 1 bottom, 2 mid, 3 top, 4 jungle (null: not known). */
  lane: number | null;
  kills: number; deaths: number; assists: number; lastHits: number; denies: number; level: number; netWorth: number; gpm: number; xpm: number;
  heroDamage: number; towerDamage: number; healing: number; items: number[]; obs: number; sen: number; stacks: number; buybacks: number;
  /** Share of players on this hero this player beat (0–1), per stat. */
  bench: Record<string, number>;
}
export interface D2Death { t: number; slot: number; killer: number | null; respawn: number; goldLost: number; goldFed: number; fight: number | null; at: Pt | null }
export interface D2Ward { kind: 'obs' | 'sen'; slot: number; team: D2Team; t: number; until: number; at: Pt }
export interface D2Down { uid: string; t: number }
export interface D2Fight { start: number; end: number; deaths: number; at: Pt | null; present: Record<D2Team, number[]>; gold: Record<D2Team, number> }
export interface D2Buy { t: number; slot: number; item: string }
/** Something the whole map hears about, for the feed on the board. */
export type D2Event = { t: number } & ({ kind: 'rune'; slot: number; rune: number } | { kind: 'roshan' | 'tormentor' | 'aegis'; team: D2Team } | { kind: 'building'; uid: string });
export interface D2Minute { gold: number[]; lh: number[]; dn: number[]; xp: number[] }
export interface D2Match {
  id: number; parsed: boolean; start: number; duration: number; winner: D2Team; startTime: number; names: Record<D2Team, string>;
  /** Where Valve keeps the replay (about two weeks), when OpenDota knows. */
  replayUrl: string | null;
  players: D2Player[]; minutes: D2Minute[]; deaths: D2Death[]; wards: D2Ward[]; downs: D2Down[];
  roshan: { t: number; team: D2Team }[]; fights: D2Fight[]; buys: D2Buy[]; goldAdv: number[]; xpAdv: number[]; events: D2Event[];
  /** Where each hero spent the laning phase (the first 10 minutes), for the map. */
  laneHeat: { x: number; y: number; w: number }[][];
}

/** How long a ward lasts when the log has no end for it. */
const WARD_LIFE = { obs: 360, sen: 420 };

const cells = (o: Record<string, Record<string, number>> | undefined) =>
  Object.entries(o ?? {}).flatMap(([x, ys]) => Object.entries(ys).map(([y, w]) => ({ ...cellToMap(Number(x), Number(y)), w })));

/** A player's name; one with no letter or digit in it ("/") says nothing, so the hero's name stands in for it. */
const nickOf = (p: RawPlayer) => {
  const nick = (p.name ?? p.personaname ?? '').trim();
  return /[\p{L}\p{N}]/u.test(nick) ? nick : null;
};

export function matchFromOpenDota(raw: RawMatch): D2Match {
  const parsed = !!(raw.od_data?.has_parsed ?? raw.version);
  const teamOf = (p: RawPlayer): D2Team => ((p.isRadiant ?? p.player_slot < 128) ? 0 : 1);
  const slotOfKey = new Map<string, number>();
  raw.players.forEach((p, slot) => slotOfKey.set(heroOf(p.hero_id).key, slot));
  const slotOf = (key: string | undefined) => { const h = heroByKey(key); return h ? slotOfKey.get(h.key) ?? null : null; };

  const fights: D2Fight[] = (raw.teamfights ?? []).map(f => {
    const at = f.players.flatMap(p => cells(p.deaths_pos));
    const present: Record<D2Team, number[]> = { 0: [], 1: [] }, gold: Record<D2Team, number> = { 0: 0, 1: 0 };
    f.players.forEach((p, slot) => {
      const rp = raw.players[slot];
      if (!rp) return;
      const team = teamOf(rp);
      gold[team] += p.gold_delta ?? 0;
      if ((p.damage ?? 0) > 0 || Object.keys(p.ability_uses ?? {}).length || cells(p.deaths_pos).length) present[team].push(slot);
    });
    return { start: f.start, end: f.end, deaths: f.deaths ?? at.length, present, gold,
      at: at.length ? { x: at.reduce((a, q) => a + q.x, 0) / at.length, y: at.reduce((a, q) => a + q.y, 0) / at.length } : null };
  });

  // every death, with where it was when a teamfight logged it
  const deaths: D2Death[] = raw.players.flatMap((p, slot) => {
    const spots = (raw.teamfights ?? []).map(f => cells(f.players[slot]?.deaths_pos));
    return (p.deaths_log ?? []).map(l => {
      const fight = fights.findIndex(f => l.time >= f.start - 2 && l.time <= f.end + 2);
      const at = fight >= 0 ? spots[fight].shift() ?? null : null;
      return { t: l.time, slot, killer: slotOf(l.key), respawn: l.time_dead ?? 0, goldLost: l.gold_lost ?? 0, goldFed: l.gold_fed ?? 0, fight: fight >= 0 ? fight : null, at: at && { x: at.x, y: at.y } };
    });
  }).sort((a, b) => a.t - b.t);

  const wards: D2Ward[] = raw.players.flatMap((p, slot) => (['obs', 'sen'] as const).flatMap(kind => {
    const left = [...((kind === 'obs' ? p.obs_left_log : p.sen_left_log) ?? [])];
    return ((kind === 'obs' ? p.obs_log : p.sen_log) ?? []).filter(l => l.x !== undefined && l.y !== undefined).map(l => {
      const i = left.findIndex(o => o.key === l.key && o.time >= l.time);
      const until = i >= 0 ? left.splice(i, 1)[0].time : l.time + WARD_LIFE[kind];
      return { kind, slot, team: teamOf(p), t: l.time, until, at: cellToMap(l.x!, l.y!) };
    });
  }));

  const objectives = raw.objectives ?? [];
  // the log names both tier-4 towers the same: the first fall takes the first one
  const fallen = new Set<string>();
  const downs: D2Down[] = [];
  for (const o of objectives) {
    if (o.type !== 'building_kill') continue;
    const b = BUILDINGS.find(x => x.key === o.key && !fallen.has(x.uid));
    if (b) { fallen.add(b.uid); downs.push({ uid: b.uid, t: o.time }); }
  }
  const winner: D2Team = raw.radiant_win ? 0 : 1;
  const fort = BUILDINGS.find(b => b.kind === 'fort' && b.team !== winner)!;
  if (parsed && !fallen.has(fort.uid)) downs.push({ uid: fort.uid, t: raw.duration });

  const events = [...deaths.map(d => d.t), ...wards.map(w => w.t), ...raw.players.flatMap(p => (p.purchase_log ?? []).map(l => l.time))];
  const teamOfObjective = (o: { team?: number; slot?: number }): D2Team => (o.team === 2 ? 0 : o.team === 3 ? 1 : teamOf(raw.players[o.slot ?? 0]));
  const happenings: D2Event[] = [
    ...downs.map((d): D2Event => ({ t: d.t, kind: 'building', uid: d.uid })),
    ...objectives.flatMap((o): D2Event[] => {
      const kind = o.type === 'CHAT_MESSAGE_ROSHAN_KILL' ? 'roshan' : o.type === 'CHAT_MESSAGE_MINIBOSS_KILL' ? 'tormentor' : o.type === 'CHAT_MESSAGE_AEGIS' ? 'aegis' : null;
      return kind ? [{ t: o.time, kind, team: teamOfObjective(o) }] : [];
    }),
    ...raw.players.flatMap((p, slot) => (p.runes_log ?? []).map((l): D2Event => ({ t: l.time, kind: 'rune', slot, rune: Number(l.key) }))),
  ].sort((a, b) => a.t - b.t);
  return {
    events: happenings,
    id: raw.match_id, parsed, duration: raw.duration, winner, startTime: raw.start_time, replayUrl: raw.replay_url ?? null,
    start: Math.min(0, ...events.filter(t => t > -180)),
    names: { 0: raw.radiant_team?.name ?? raw.radiant_name ?? 'Radiant', 1: raw.dire_team?.name ?? raw.dire_name ?? 'Dire' },
    players: raw.players.map((p, slot): D2Player => ({
      slot, team: teamOf(p), hero: p.hero_id, account: p.account_id ?? null, name: nickOf(p), lane: p.lane ?? null,
      kills: p.kills, deaths: p.deaths, assists: p.assists, lastHits: p.last_hits, denies: p.denies, level: p.level,
      netWorth: p.net_worth ?? 0, gpm: p.gold_per_min, xpm: p.xp_per_min, heroDamage: p.hero_damage ?? 0, towerDamage: p.tower_damage ?? 0, healing: p.hero_healing ?? 0,
      items: [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5].filter((i): i is number => !!i),
      obs: p.obs_placed ?? 0, sen: p.sen_placed ?? 0, stacks: p.camps_stacked ?? 0, buybacks: p.buyback_count ?? 0,
      bench: Object.fromEntries(Object.entries(p.benchmarks ?? {}).filter(([, v]) => typeof v.pct === 'number').map(([k, v]) => [k, v.pct!])),
    })),
    minutes: raw.players.map(p => ({ gold: p.networth_t ?? p.gold_t ?? [], lh: p.lh_t ?? [], dn: p.dn_t ?? [], xp: p.xp_t ?? [] })),
    deaths, wards, downs: downs.sort((a, b) => a.t - b.t), fights,
    roshan: objectives.filter(o => o.type === 'CHAT_MESSAGE_ROSHAN_KILL').map(o => ({ t: o.time, team: (o.team === 2 ? 0 : 1) as D2Team })),
    buys: raw.players.flatMap((p, slot) => (p.purchase_log ?? []).map(l => ({ t: l.time, slot, item: l.key ?? '' }))).sort((a, b) => a.t - b.t),
    goldAdv: raw.radiant_gold_adv ?? [], xpAdv: raw.radiant_xp_adv ?? [],
    laneHeat: raw.players.map(p => cells(p.lane_pos)),
  };
}

/** A per-minute series at any moment, straight between the minutes. */
export function seriesAt(s: number[], t: number): number {
  if (!s.length) return 0;
  const m = Math.max(0, t) / 60, i = Math.floor(m);
  if (i >= s.length - 1) return s[s.length - 1];
  return s[i] + (s[i + 1] - s[i]) * (m - i);
}
export const netWorthAt = (m: D2Match, slot: number, t: number) => seriesAt(m.minutes[slot]?.gold ?? [], t);
export const kdAt = (m: D2Match, slot: number, t: number) => ({
  k: m.deaths.filter(d => d.t <= t && d.killer === slot && d.slot !== slot).length,
  d: m.deaths.filter(d => d.t <= t && d.slot === slot).length,
});
/** The team's kills by this moment (their heroes killing the other side's). */
export const teamKillsAt = (m: D2Match, team: D2Team, t: number) =>
  m.deaths.filter(d => d.t <= t && m.players[d.slot].team !== team && d.killer !== null && m.players[d.killer].team === team).length;
/** The death a hero is still waiting out at this moment. */
export const deadAt = (m: D2Match, slot: number, t: number) => m.deaths.find(d => d.slot === slot && t >= d.t && t < d.t + d.respawn) ?? null;
export const buildingUp = (m: D2Match, uid: string, t: number) => !m.downs.some(d => d.uid === uid && d.t <= t);

/** Where a hero spent most of the laning phase: the busiest spot of their heatmap (not the fountain they start from). */
export function laneSpot(cells: { x: number; y: number; w: number }[]): Pt | null {
  let best: Pt | null = null, most = 0;
  for (const c of cells) {
    const around = cells.reduce((a, o) => a + (Math.hypot(o.x - c.x, o.y - c.y) <= 0.06 ? o.w : 0), 0);
    if (around > most) { most = around; best = { x: c.x, y: c.y }; }
  }
  return best;
}

/** Where a team's heroes come back to life. */
const FOUNTAIN: Record<D2Team, Pt> = { 0: cellToMap(70, 72), 1: cellToMap(186, 182) };
/** When laning starts: from here until something newer is logged, a hero is taken to be in their lane. */
const LANE_FROM = 30;

/**
 * The last place the logs put a hero by this moment, and how long ago: the fountain, their lane, a ward they placed, a
 * logged death. This is not where they are now: OpenDota doesn't log that.
 */
export function lastKnown(m: D2Match, slot: number, t: number): { at: Pt; age: number; dead: boolean } {
  const team = m.players[slot].team;
  let at = FOUNTAIN[team], when = m.start;
  const seen = (s: number, p: Pt | null) => { if (p && s <= t && s >= when) { at = p; when = s; } };
  seen(LANE_FROM, laneSpot(m.laneHeat[slot] ?? []));
  for (const w of m.wards) if (w.slot === slot) seen(w.t, w.at);
  for (const d of m.deaths) {
    if (d.slot !== slot) continue;
    seen(d.t, d.at);
    seen(d.t + d.respawn, FOUNTAIN[team]);
  }
  return { at, age: t - when, dead: !!deadAt(m, slot, t) };
}

/** A run of deaths close together: heroes lost on each side, and the gold it handed over. */
export interface D2Clash { start: number; end: number; lost: Record<D2Team, number>; gold: Record<D2Team, number> }
/** Deaths this far apart (s) belong to the same clash. */
const CLASH_GAP = 18;
/** Every clash of three deaths or more, read from the deaths themselves (OpenDota's teamfight log misses many). */
export function clashes(m: D2Match): D2Clash[] {
  const runs: D2Death[][] = [];
  for (const d of m.deaths) {
    const last = runs[runs.length - 1];
    if (last && d.t - last[last.length - 1].t <= CLASH_GAP) last.push(d); else runs.push([d]);
  }
  return runs.filter(r => r.length >= 3).map(r => {
    const lost: Record<D2Team, number> = { 0: 0, 1: 0 }, gold: Record<D2Team, number> = { 0: 0, 1: 0 };
    for (const d of r) {
      const team = m.players[d.slot].team;
      lost[team]++;
      gold[team] -= d.goldLost;
      gold[(1 - team) as D2Team] += d.goldFed;
    }
    return { start: r[0].t, end: r[r.length - 1].t, lost, gold };
  });
}

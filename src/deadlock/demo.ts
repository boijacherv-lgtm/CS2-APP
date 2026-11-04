/**
 * The match's demo, read by deadlock-api on its own servers (its Demo Query: SQL over the demo's entity and event
 * tables, ~20–60 s a match, results zstd-compressed NDJSON): what the match data doesn't have. Camps and Sinner's
 * Sacrifice up and down to the second, the urn on the ground and who carried it, the bridge buffs, every ability
 * cast (ultimates marked), kills with what did them, the mid boss's spawns, the Rejuvenator claims and who picked up
 * whose soul bag.
 *
 * A demo tick is 1/64 s of match time (checked against the kills in the match data, ±1 s). Positions are the
 * Source 2 cell + offset: world = (cell − 64) × 512 + vec. Kept in this browser once read, like the match.
 */
import { decompress } from 'fzstd';
import { delItem, getItem, gunzipJson, gzipJson, setItem } from '../ui/localStore';
import { useDl } from './store';
import { DL_MAP, heroOf, toMap } from './data';
import { playerAt, type DlMatch } from './match';
import { localReplay } from './localReplays';

const API = 'https://api.deadlock-api.com';
const TICKS = 64;
/** Bump when what's read or how it's put together changes: demos read before are read again. */
const DEMO_V = 4;

export interface DlDemo {
  v: number;
  /** Times are on the match clock (pauses taken out, the ultimate's cooldowns moved off the server clock). */
  clock?: 2;
  /** Each camp of the map (DL_MAP.camps, same order) and when it was up: [from, to] in match seconds. */
  camps: [number, number][][];
  /** Each urn: where it lay and from when (it lands 12.5 s after spawning), until someone picked it up (or the next
   * one came), then who carried it and until when (delivered, dropped or expired: at most 90 s). */
  urn: { from: number; landed: number; x: number; y: number; fromLeft: boolean; taken: number | null; slot: number | null; until: number | null }[];
  /** The two bridge buffs (DL_MAP.bridgeBuffs order) and when one lay there to take. */
  buffs: [number, number][][];
  /** Every ability cast: when, who (player slot), which (the hero's ability name), and whether it's their ultimate. */
  casts: { t: number; slot: number; name: string; ult: boolean }[];
  /** Hero kills: who died, who killed them (null: not a hero), with what (ability id). */
  kills: { t: number; victim: number; killer: number | null; ability: number | null }[];
  midBossSpawns: number[];
  /** Rejuvenator crystals claimed, by whom. */
  rejuv: { t: number; slot: number | null }[];
  /** Every hero 4 times a second (smooth movement, fast heroes too): map x / y, and height in game units (below 0:
   * in the tunnels or the mid boss pit); NaN while dead. Sample i is at time i × TRACK_DT. */
  tracks: Record<number, { x: number[]; y: number[]; z: number[] }>;
  /** Each player every 2 s (sample i at i × STAT_DT): net worth, last hits, denies, level. */
  stats: Record<number, { nw: number[]; lh: number[]; dn: number[]; lvl: number[] }>;
  /** Each player's ultimate: when they first could use it, and every cooldown (from, to). */
  ults: Record<number, { from: number | null; cds: [number, number][] }>;
  /** Lane creeps every 2 s (key: sample index): groups as flat [team, x, y, how many, …]. */
  creeps: Record<number, number[]>;
  /** Each lane creep (trooper) one by one, a spot a second from t0 (flat x, y, …); null when the demo couldn't be
   * read for them (demos kept before they were read). */
  troopers?: DlTrooper[] | null;
  /** Lane creeps dying: when, whose, where. */
  creepDeaths: { t: number; team: 0 | 1; x: number; y: number }[];
  /** Each Unstable Rift: when it showed on its bridge and where, when the point opened, the capture (each team's
   * progress and players on the point, by second), and who took it and when (null: not taken before the end). */
  rifts: { from: number; x: number; y: number; opens: number; taken: number | null; team: 0 | 1 | null; progress: { t: number; p: [number, number]; n: [number, number] }[] }[];
  /** Soul bags (a killed hero's unsecured souls) picked up: when, by whom, whose, how many souls. Undefined: kept
   * before bags were read; empty also when the demo is from before the game had them. */
  bags?: DlBag[];
}
export interface DlBag { t: number; slot: number; victim: number | null; souls: number }
/** A lane creep's life: its team, when it's first seen, and where it is each second from then (flat x, y, …). */
export interface DlTrooper { team: 0 | 1; t0: number; xy: number[] }
/** Seconds between two stats / creep samples. */
export const STAT_DT = 2;
/** Seconds between two hero samples. */
export const TRACK_DT = 0.25;
/** Below this height a hero is underground (the tunnels, the mid boss pit): the streets are mostly 100–500. */
export const UNDERGROUND_Z = 0;

// ---- the queries (table names are matched case-insensitively, column names must be quoted) ----------------------
const LIFE = (table: string) => `SELECT tick, entity_index AS e, delta_type AS d, ls, cx, cy, vx, vy FROM (
  SELECT tick, entity_index, delta_type, "m_lifeState" AS ls, lag("m_lifeState") OVER (PARTITION BY entity_index ORDER BY tick) AS prev,
    "CBodyComponent__m_cellX" AS cx, "CBodyComponent__m_cellY" AS cy, "CBodyComponent__m_vecX" AS vx, "CBodyComponent__m_vecY" AS vy FROM ${table}
) WHERE delta_type <> 'update' OR ls <> prev ORDER BY tick`;
const POS = `"CBodyComponent__m_cellX" AS cx, "CBodyComponent__m_cellY" AS cy, "CBodyComponent__m_vecX" AS vx, "CBodyComponent__m_vecY" AS vy`;
const NUL = (t: string) => `CAST(NULL AS ${t})`;
const QUERIES = {
  players: `SELECT entity_index, last_value("m_unLobbyPlayerSlot" ORDER BY tick) AS slot, last_value("m_hHeroPawn" ORDER BY tick) AS pawn,
    last_value("m_PlayerDataGlobal__m_nHeroID" ORDER BY tick) AS hero, last_value("m_iTeamNum" ORDER BY tick) AS team FROM CCitadelPlayerController GROUP BY entity_index`,
  stats: `SELECT tick / ${TICKS * STAT_DT} AS b, last_value("m_unLobbyPlayerSlot" ORDER BY tick) AS slot, last_value("m_PlayerDataGlobal__m_iGoldNetWorth" ORDER BY tick) AS nw,
    last_value("m_PlayerDataGlobal__m_iLastHits" ORDER BY tick) AS lh, last_value("m_PlayerDataGlobal__m_iDenies" ORDER BY tick) AS dn, last_value("m_PlayerDataGlobal__m_iLevel" ORDER BY tick) AS lvl,
    last_value("m_PlayerDataGlobal__m_bUltimateTrained" ORDER BY tick) AS ut, last_value("m_PlayerDataGlobal__m_flUltimateCooldownStart" ORDER BY tick) AS us,
    last_value("m_PlayerDataGlobal__m_flUltimateCooldownEnd" ORDER BY tick) AS ue FROM CCitadelPlayerController GROUP BY tick / ${TICKS * STAT_DT}, entity_index ORDER BY b`,
  // lane creeps alive, grouped by team and map cell (512 units) every 2 s, and each one's death
  creeps: `SELECT tick / ${TICKS * STAT_DT} AS b, "m_iTeamNum" AS team, "CBodyComponent__m_cellX" AS cx, "CBodyComponent__m_cellY" AS cy, avg("CBodyComponent__m_vecX") AS vx,
    avg("CBodyComponent__m_vecY") AS vy, count(DISTINCT entity_index) AS n FROM CNPC_Trooper WHERE "m_lifeState" = 0 GROUP BY 1, 2, 3, 4 ORDER BY b`,
  troopers: `SELECT tick / ${TICKS} AS s, entity_index AS e, last_value("m_iTeamNum" ORDER BY tick) AS team, last_value("CBodyComponent__m_cellX" ORDER BY tick) AS cx,
    last_value("CBodyComponent__m_cellY" ORDER BY tick) AS cy, last_value("CBodyComponent__m_vecX" ORDER BY tick) AS vx, last_value("CBodyComponent__m_vecY" ORDER BY tick) AS vy,
    last_value("m_lifeState" ORDER BY tick) AS ls FROM CNPC_Trooper GROUP BY tick / ${TICKS}, entity_index ORDER BY e, s`,
  creepDeaths: `SELECT tick, team, cx, cy, vx, vy FROM (SELECT tick, "m_iTeamNum" AS team, "m_lifeState" AS ls, lag("m_lifeState") OVER (PARTITION BY entity_index ORDER BY tick) AS prev,
    ${POS} FROM CNPC_Trooper) WHERE ls <> 0 AND prev = 0 ORDER BY tick`,
  // the Unstable Rift: its spawner while it can be captured (then the cash-in), and each team's capture
  rift: `SELECT tick, entity_index AS e, delta_type AS d, 'open' AS k, ${POS} FROM CCitadelItemKothSpawner WHERE delta_type <> 'update'
    UNION ALL SELECT tick, entity_index, delta_type, 'cash', ${POS} FROM CCitadel_KothCashIn WHERE delta_type <> 'update' ORDER BY tick`,
  koth: `SELECT tick / ${TICKS} AS s, last_value("m_pGameRules__m_vecTeamKothStates__m_flCaptureProgressFrac" ORDER BY tick) AS p,
    last_value("m_pGameRules__m_vecTeamKothStates__m_nCapturerCount" ORDER BY tick) AS n, last_value("m_pGameRules__m_nKothScoringTeam" ORDER BY tick) AS team
    FROM CCitadelGameRulesProxy GROUP BY tick / ${TICKS} ORDER BY s`,
  events: `SELECT tick, 'kill' AS k, CAST(entindex_victim AS BIGINT) AS a, CAST(entindex_attacker AS BIGINT) AS b, CAST(killer_ability_id AS BIGINT) AS c, ${NUL('VARCHAR')} AS s FROM HeroKilledEvent
    UNION ALL SELECT tick, 'cast', CAST(caster AS BIGINT), CAST(player AS BIGINT), ${NUL('BIGINT')}, ability_name FROM ImportantAbilityUsedEvent
    UNION ALL SELECT tick, 'midboss', ${NUL('BIGINT')}, ${NUL('BIGINT')}, ${NUL('BIGINT')}, ${NUL('VARCHAR')} FROM MidBossSpawnedEvent
    UNION ALL SELECT tick, 'rejuv', CAST(player_pawn AS BIGINT), CAST(killing_team AS BIGINT), CAST(event_type AS BIGINT), ${NUL('VARCHAR')} FROM RejuvStatusEvent
    ORDER BY tick`,
  camps: LIFE('CNPC_TrooperNeutral'),
  sinners: LIFE('CNPC_Neutral_SinnersSacrifice'),
  urn: `SELECT tick / ${TICKS} AS s, last_value("CBodyComponent__m_cellX" ORDER BY tick) AS cx, last_value("CBodyComponent__m_cellY" ORDER BY tick) AS cy,
    last_value("CBodyComponent__m_vecX" ORDER BY tick) AS vx, last_value("CBodyComponent__m_vecY" ORDER BY tick) AS vy FROM CCitadelItemPickupIdol GROUP BY tick / ${TICKS} ORDER BY s`,
  // the bridge buff stays all match; it can be taken while "active"
  heroes: `SELECT tick / ${TICKS * TRACK_DT} AS b, entity_index AS e, last_value("CBodyComponent__m_cellX" ORDER BY tick) AS cx, last_value("CBodyComponent__m_cellY" ORDER BY tick) AS cy,
    last_value("CBodyComponent__m_cellZ" ORDER BY tick) AS cz, last_value("CBodyComponent__m_vecX" ORDER BY tick) AS vx, last_value("CBodyComponent__m_vecY" ORDER BY tick) AS vy,
    last_value("CBodyComponent__m_vecZ" ORDER BY tick) AS vz, last_value("m_lifeState" ORDER BY tick) AS ls FROM CCitadelPlayerPawn GROUP BY tick / ${TICKS * TRACK_DT}, entity_index ORDER BY b`,
  // soul bags: older demos don't have this table (see OPTIONAL)
  bags: `SELECT tick, CAST(pickup_player AS BIGINT) AS a, CAST(victim_player AS BIGINT) AS b, CAST(killfeed_gold AS BIGINT) AS g FROM SoulBagPickupEvent ORDER BY tick`,
  buffs: `SELECT tick, e, d, act, cx, cy, vx, vy FROM (SELECT tick, entity_index AS e, delta_type AS d, "m_bActive" AS act,
    lag("m_bActive") OVER (PARTITION BY entity_index ORDER BY tick) AS prev, ${POS} FROM CCitadel_Pickup_Modifier) WHERE d <> 'update' OR act <> prev ORDER BY tick`,
};
export type Q = keyof typeof QUERIES;
export type Row = Record<string, number | string | boolean | null>;
/** Queries a demo may not be able to answer (a table from a newer patch): their failure reads as nothing found. */
const OPTIONAL = new Set<Q>(['bags']);

/** Runs every query for a match on deadlock-api, together; `onWait` gets the longest estimated wait (s). */
async function runAll(matchId: number, onWait: (s: number | null) => void, which: Q[] = Object.keys(QUERIES) as Q[]): Promise<Record<Q, Row[]>> {
  const jobs = {} as Record<Q, string>;
  const done = {} as Record<Q, Row[]>;
  const submit = async (q: Q) => {
    try { await submitOne(q); } catch (e) { if (!OPTIONAL.has(q) || e instanceof NoDemo) throw e; done[q] = []; }
  };
  const submitOne = async (q: Q) => {
    const res = await fetch(`${API}/v1/matches/demo/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: matchId, query: QUERIES[q], format: 'ndjson' }) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error('deadlock-api is busy reading demos: try again in a few minutes.');
    if (res.status === 404 || /No demo available|Failed to download demo/i.test(String(out.error ?? ''))) throw new NoDemo(matchId);
    if (!res.ok || !out.job_id) throw new Error(out.error ? `The demo couldn't be read: ${String(out.error).slice(0, 160)}` : `deadlock-api answered ${res.status}.`);
    jobs[q] = out.job_id;
  };
  // one first: when the demo is gone, that's one request, not one per query
  const [first, ...rest] = which;
  await submit(first);
  await Promise.all(rest.map(submit));
  for (let round = 0; Object.keys(done).length < which.length; round++) {
    if (round > 90) throw new Error('Reading the demo is taking too long: try again later.');
    await new Promise(r => setTimeout(r, round === 0 ? 8000 : 4000));
    let wait: number | null = null;
    for (const q of Object.keys(jobs) as Q[]) {
      if (done[q]) continue;
      const st = await (await fetch(`${API}/v1/matches/demo/query/${jobs[q]}`)).json();
      if (st.status === 'failed' && OPTIONAL.has(q)) { done[q] = []; continue; }
      if (st.status === 'failed') throw new Error(`The demo couldn't be read: ${String(st.error ?? 'unknown error').slice(0, 160)}`);
      if (st.status === 'done' && st.result_url) {
        const raw = new Uint8Array(await (await fetch(st.result_url)).arrayBuffer());
        const text = raw.length ? new TextDecoder().decode(decompress(raw)) : '';
        done[q] = text.split('\n').filter(Boolean).map(l => JSON.parse(l) as Row);
      } else if (st.estimated_wait_seconds != null) wait = Math.max(wait ?? 0, st.estimated_wait_seconds);
    }
    onWait(wait);
  }
  return done;
}

const world = (r: Row) => ({ x: (Number(r.cx) - 64) * 512 + Number(r.vx), y: (Number(r.cy) - 64) * 512 + Number(r.vy) });
const spot = (r: Row) => { const w = world(r); return toMap(w.x, w.y); };
const nearest = (p: { x: number; y: number }, list: { x: number; y: number }[], within: number) => {
  let best = -1, bd = within;
  list.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
  return best;
};
/** Overlapping (or nearly touching) [from, to] intervals as one. */
function merge(xs: [number, number][], gap = 3): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...xs].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
/**
 * Each entity's lives: [from, to] in ticks. The demo sends every entity again as a "create" once a minute (a full
 * snapshot), so a create only starts a life when the entity wasn't alive; it ends when the entity dies (life state
 * other than 0) or leaves.
 */
function lives(rows: Row[], end: number): { at: Row; from: number; to: number }[] {
  const open = new Map<number, { at: Row; from: number }>(), out: { at: Row; from: number; to: number }[] = [];
  const close = (e: number, tick: number) => { const o = open.get(e); if (o) { out.push({ ...o, to: tick }); open.delete(e); } };
  for (const r of rows) {
    const e = Number(r.e), tick = Number(r.tick);
    // (an "act" column: alive while it's active, for things that stay but can be taken)
    if (r.d === 'leave' || r.d === 'delete' || (r.ls != null && Number(r.ls) !== 0) || r.act === false) close(e, tick);
    else if (!open.has(e)) open.set(e, { at: r, from: tick });
  }
  for (const e of open.keys()) close(e, end);
  return out;
}

/** Puts the query results together for a match. */
export function buildDemo(m: DlMatch, q: Record<Q, Row[]>): DlDemo {
  // everything here is on the demo's tick clock (toMatchClock moves it to the match clock at the end); the match
  // data is on the match clock, so it's read at clk.g(t), and the demo runs longer by the pauses
  const clk = matchClock(m), dur = clk.tau(m.duration);
  const end = dur * TICKS;
  // which hero entity is which player
  const slotOfPawn = new Map<number, number>();
  for (const r of q.players) {
    const slot = parseInt(String(r.slot ?? '').slice(0, 2), 16), pawn = Number(r.pawn) & 0x3fff;
    if (Number.isFinite(slot) && pawn && pawn !== 0x3fff && m.players.some(p => p.slot === slot)) slotOfPawn.set(pawn, slot);
  }
  // the demo's team numbers (2, 3) as the match's teams, from where its players are
  const teamOfNum = new Map<number, 0 | 1>();
  for (const r of q.players) {
    const slot = parseInt(String(r.slot ?? '').slice(0, 2), 16), p = m.players.find(x => x.slot === slot);
    if (p && r.team != null) teamOfNum.set(Number(r.team), p.team as 0 | 1);
  }
  const slotOf = (handleOrIndex: Row[string]) => (handleOrIndex == null ? null : slotOfPawn.get(Number(handleOrIndex) & 0x3fff) ?? null);
  const sec = (tick: Row[string]) => Number(tick) / TICKS;

  // camps and Sinner's Sacrifice: each creature's life, on the camp it stands at
  const campLives: [number, number][][] = DL_MAP.camps.map(() => []);
  for (const [rows, onlyVaults] of [[q.camps, false], [q.sinners, true]] as const) {
    const spots = DL_MAP.camps.map(c => (onlyVaults && c.kind !== 'vault' ? { x: 9, y: 9 } : c));
    for (const l of lives(rows, end)) {
      const i = nearest(spot(l.at), spots, 0.04);
      if (i >= 0) campLives[i].push([sec(l.from), sec(l.to)]);
    }
  }
  // the urn: the demo sends its spot while it moves (coming down at its bridge) and clears it when someone picks it
  // up; a new spot after a gap is the next urn
  const urn: DlDemo['urn'] = [];
  for (const r of q.urn) {
    const t = Number(r.s), cur = urn[urn.length - 1];
    if (r.cx == null) { if (cur && cur.taken === null) cur.taken = t; continue; }
    const p = spot(r);
    if (!cur || cur.taken !== null || Math.hypot(p.x - cur.x, p.y - cur.y) > 0.05) urn.push({ from: t, landed: t + 12.5, ...p, fromLeft: p.x < 0.5, taken: null, slot: null, until: null });
    else { cur.x = p.x; cur.y = p.y; }
  }
  // every hero 4 times a second: each hero entity's last spot in each quarter second, carried on while nothing changed
  // (NaN while dead). An entity is matched to the player it moves exactly like in the match data (a hero can change
  // entity during a match, so the players' list alone isn't enough)
  const n = Math.ceil(dur / TRACK_DT) + 1;
  const byEntity = new Map<number, Row[]>();
  for (const r of q.heroes) { const e = Number(r.e); byEntity.set(e, [...(byEntity.get(e) ?? []), r]); }
  const tracks: DlDemo['tracks'] = {};
  for (const p of m.players) tracks[p.slot] = { x: new Array(n).fill(NaN), y: new Array(n).fill(NaN), z: new Array(n).fill(NaN) };
  for (const [e, rs] of byEntity) {
    const tr = { x: new Array(n).fill(NaN), y: new Array(n).fill(NaN), z: new Array(n).fill(NaN) };
    let cur: { x: number; y: number; z: number; dead: boolean } | null = null, k = 0;
    for (let b = 0; b < n; b++) {
      for (; k < rs.length && Number(rs[k].b) <= b; k++) {
        const r = rs[k];
        if (r.cx == null) continue;
        const w = world(r), p = toMap(w.x, w.y);
        cur = { x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: Math.round((Number(r.cz) - 64) * 512 + Number(r.vz)), dead: r.ls != null && Number(r.ls) !== 0 };
      }
      if (cur && !cur.dead) { tr.x[b] = cur.x; tr.y[b] = cur.y; tr.z[b] = cur.z; }
    }
    // the player it follows: the demo's own player list when it names one, else the smallest typical gap to a
    // player's 1-a-second track
    let best: number | null = slotOfPawn.get(e) ?? null, bestGap = 0.02;
    if (best === null) {
      for (const p of m.players) {
        const gaps: number[] = [];
        for (let b = 0; b < n; b += 40) { if (Number.isNaN(tr.x[b])) continue; const a = playerAt(m, p.slot, clk.g(b * TRACK_DT)); if (a) gaps.push(Math.hypot(a.x - tr.x[b], a.y - tr.y[b])); }
        if (gaps.length < 5) continue;
        gaps.sort((x, y) => x - y);
        if (gaps[gaps.length >> 1] < bestGap) { bestGap = gaps[gaps.length >> 1]; best = p.slot; }
      }
    }
    if (best === null) continue;
    const into = tracks[best];
    for (let b = 0; b < n; b++) {
      if (Number.isNaN(tr.x[b]) || !Number.isNaN(into.x[b])) continue;
      // a sample far from where the match data has them isn't the hero you see (Mina's bats leave the hero entity
      // behind): left out, so the board falls back on the match data there
      const a = playerAt(m, best, clk.g(b * TRACK_DT));
      if (a && Math.hypot(a.x - tr.x[b], a.y - tr.y[b]) > 0.06) continue;
      into.x[b] = tr.x[b]; into.y[b] = tr.y[b]; into.z[b] = tr.z[b];
    }
    void e;
  }
  const heroAtTrack = (slot: number, t: number) => (tracks[slot] ? heroAt({ tracks } as DlDemo, slot, t) : null);
  urn.forEach((u, i) => {
    if (u.taken === null) return;
    // carried by the hero nearest it when it went; until the next one comes, or it's run out (45 s + 45 s decay)
    // (after 3 min unclaimed it walks toward its drop-off, so it can be a little way from where it was last seen)
    let bd = u.taken - u.from > 180 ? 0.08 : 0.04;
    for (const p of m.players) { const a = playerAt(m, p.slot, clk.g(u.taken)); const d = a ? Math.hypot(a.x - u.x, a.y - u.y) : 9; if (d < bd) { bd = d; u.slot = p.slot; } }
    u.until = Math.min(urn[i + 1]?.from ?? dur, u.taken + 90, dur);
    // it ends when the carrier reaches the drop-off on the other side (delivered) or dies (dropped)
    const drop = DL_MAP.urnPads.find(p => (p.x < 0.5) !== u.fromLeft);
    if (u.slot !== null) for (let t = u.taken; t < u.until; t += TRACK_DT) {
      const a = heroAtTrack(u.slot, t) ?? playerAt(m, u.slot, clk.g(t));
      if (!a) { u.until = t; break; } // died
      if (drop && Math.hypot(a.x - drop.x, a.y - drop.y) < 0.03) { u.until = t; break; }
    }
  });
  // the bridge buffs: a buff lying on either bridge
  const buffs: [number, number][][] = DL_MAP.bridgeBuffs.map(() => []);
  for (const l of lives(q.buffs, end)) {
    const i = nearest(spot(l.at), DL_MAP.bridgeBuffs, 0.02);
    if (i >= 0) buffs[i].push([sec(l.from), sec(l.to)]);
  }
  // casts, kills, the mid boss and the Rejuvenator
  const ultOf = new Map<number, Set<string>>(), nameOf = new Map<string, string>();
  for (const p of m.players) for (const a of heroOf(p.hero).abilities ?? []) { nameOf.set(a.cls, a.name); if (a.ult) ultOf.set(p.slot, new Set([...(ultOf.get(p.slot) ?? []), a.cls])); }
  const casts: DlDemo['casts'] = [], kills: DlDemo['kills'] = [], midBossSpawns: number[] = [], rejuv: DlDemo['rejuv'] = [];
  for (const r of q.events) {
    const t = sec(r.tick);
    if (r.k === 'cast') {
      const slot = slotOf(r.a), cls = String(r.s ?? '');
      if (slot !== null && nameOf.has(cls)) casts.push({ t, slot, name: nameOf.get(cls)!, ult: !!ultOf.get(slot)?.has(cls) });
    } else if (r.k === 'kill') {
      const victim = slotOf(r.a);
      if (victim !== null) kills.push({ t, victim, killer: slotOf(r.b), ability: r.c == null ? null : Number(r.c) });
    } else if (r.k === 'midboss') midBossSpawns.push(t);
    else if (r.k === 'rejuv') rejuv.push({ t, slot: slotOf(r.a) });
  }
  const bags = bagsFrom(q.bags ?? [], slotOf);
  // each player every 2 s, and their ultimate (unlocked when, every cooldown)
  const ns = Math.ceil(dur / STAT_DT) + 1;
  const stats: DlDemo['stats'] = {}, ults: DlDemo['ults'] = {};
  for (const p of m.players) { stats[p.slot] = { nw: new Array(ns).fill(0), lh: new Array(ns).fill(0), dn: new Array(ns).fill(0), lvl: new Array(ns).fill(0) }; ults[p.slot] = { from: null, cds: [] }; }
  for (const r of q.stats) {
    const slot = parseInt(String(r.slot ?? '').slice(0, 2), 16), b = Number(r.b), st = stats[slot];
    if (!st || b >= ns) continue;
    st.nw[b] = Number(r.nw) || 0; st.lh[b] = Number(r.lh) || 0; st.dn[b] = Number(r.dn) || 0; st.lvl[b] = Number(r.lvl) || 0;
    const u = ults[slot];
    if (r.ut === true && u.from === null) u.from = b * STAT_DT;
    const us = Number(r.us), ue = Number(r.ue);
    if (us > 0 && ue > us && !u.cds.some(([a]) => Math.abs(a - us) < 0.5)) u.cds.push([+us.toFixed(1), +ue.toFixed(1)]);
  }
  // carry each number on through samples the demo didn't send (nothing changed)
  for (const st of Object.values(stats)) for (const k of ['nw', 'lh', 'dn', 'lvl'] as const) for (let b = 1; b < ns; b++) if (!st[k][b]) st[k][b] = st[k][b - 1];
  const troopers = troopersFrom(q.troopers ?? [], n => teamOfNum.get(n));
  // lane creeps: each group's spot (the cell plus their average offset), team as the match's
  const creeps: DlDemo['creeps'] = {};
  for (const r of q.creeps) {
    const team = teamOfNum.get(Number(r.team));
    if (team === undefined) continue;
    const p = spot(r), b = Number(r.b);
    (creeps[b] ??= []).push(team, +p.x.toFixed(4), +p.y.toFixed(4), Number(r.n));
  }
  const creepDeaths: DlDemo['creepDeaths'] = [];
  for (const r of q.creepDeaths) { const team = teamOfNum.get(Number(r.team)); if (team !== undefined && r.cx != null) creepDeaths.push({ t: +sec(r.tick).toFixed(2), team, ...spot(r) }); }
  // the rift: it shows on its bridge (the spawner), the point opens when the spawner goes (the cash-in appears), and
  // it's taken when the cash-in goes, by the team the game says scored
  const rifts: DlDemo['rifts'] = [];
  const cashes = lives(q.rift.filter(r => r.k === 'cash'), end);
  const nums = [...teamOfNum.entries()].sort((a, b) => a[0] - b[0]);
  for (const l of lives(q.rift.filter(r => r.k === 'open'), end)) {
    const from = sec(l.from), opens = sec(l.to), p = spot(l.at);
    const cash = cashes.find(c => Math.abs(sec(c.from) - opens) < 3);
    const shut = cash && cash.to < end ? sec(cash.to) : null;
    const scorer = shut === null ? undefined : q.koth.filter(r => Number(r.s) >= shut - 2 && Number(r.s) <= shut + 30).map(r => Number(r.team)).find(x => x >= 2);
    const progress = q.koth.filter(r => Number(r.s) >= opens && Number(r.s) <= (shut ?? dur)).map(r => {
      const pr = (r.p as unknown as number[] | null) ?? [], nn = (r.n as unknown as number[] | null) ?? [];
      // the game lists the teams in number order (2, 3): put them in the match's order
      const pp: [number, number] = [0, 0], cc: [number, number] = [0, 0];
      nums.forEach(([, team], i) => { pp[team] = +(pr[i] ?? 0).toFixed(3); cc[team] = Number(nn[i] ?? 0); });
      return { t: Number(r.s), p: pp, n: cc };
    });
    rifts.push({ from, ...p, opens, taken: scorer !== undefined ? shut : null, team: scorer !== undefined ? teamOfNum.get(scorer) ?? null : null, progress });
  }
  return toMatchClock({ v: DEMO_V, camps: campLives.map(xs => merge(xs)), urn, buffs: buffs.map(xs => merge(xs)), casts, kills, midBossSpawns, rejuv, tracks, stats, ults, creeps, troopers, creepDeaths, rifts, bags }, m);
}

/**
 * Each lane creep's lives from its per-second rows (tick clock): alive rows in a row (8 s at most between them; a
 * creep that stands still sends nothing, so it's held where it was), ended by its death; an entity number is used
 * again by later creeps. The once-a-minute snapshots of unused entities are dropped (lives under 3 s).
 */
export function troopersFrom(rows: Row[], teamOf: (num: number) => 0 | 1 | undefined): DlTrooper[] {
  const byE = new Map<number, Row[]>();
  for (const r of rows) { const e = Number(r.e); let xs = byE.get(e); if (!xs) byE.set(e, (xs = [])); xs.push(r); }
  const out: DlTrooper[] = [];
  for (const rs of byE.values()) {
    rs.sort((a, b) => Number(a.s) - Number(b.s));
    let cur: (DlTrooper & { last: number }) | null = null;
    const close = () => { if (cur && cur.xy.length >= 6) out.push({ team: cur.team, t0: cur.t0, xy: cur.xy }); cur = null; };
    for (const r of rs) {
      const s = Number(r.s), team = teamOf(Number(r.team));
      if (Number(r.ls) !== 0 || r.cx == null || team === undefined) { close(); continue; }
      if (cur && (s - cur.last > 8 || team !== cur.team)) close();
      const p = spot(r);
      if (!cur) cur = { team, t0: s, xy: [], last: s - 1 };
      const c: DlTrooper & { last: number } = cur;
      const lx = c.xy[c.xy.length - 2], ly = c.xy[c.xy.length - 1];
      for (; c.last < s - 1; c.last++) c.xy.push(lx, ly);
      c.xy.push(+p.x.toFixed(4), +p.y.toFixed(4)); c.last = s;
    }
    close();
  }
  return out.sort((a, b) => a.t0 - b.t0);
}
/** Lane creeps from tick time to match time: through a pause they stand, so those seconds are left out. */
function troopersOnClock(ts: DlTrooper[], m: DlMatch): DlTrooper[] {
  const { pauses, g, tau } = matchClock(m);
  if (!pauses.length) return ts;
  return ts.map(tr => {
    const n = tr.xy.length / 2, a = Math.ceil(g(tr.t0)), z = Math.floor(g(tr.t0 + n - 1)), xy: number[] = [];
    for (let j = a; j <= z; j++) { const i = Math.max(0, Math.min(n - 1, Math.round(tau(j) - tr.t0))); xy.push(tr.xy[i * 2], tr.xy[i * 2 + 1]); }
    return { team: tr.team, t0: a, xy };
  }).filter(tr => tr.xy.length >= 4);
}
/** Lane creeps at time t, each one where it is between its seconds; flat [team, x, y, 1, …] like creepsAt. */
export function troopersAt(demo: DlDemo | null, t: number): number[] | null {
  const ts = demo?.troopers;
  if (!ts) return null;
  const out: number[] = [];
  for (const tr of ts) {
    if (tr.t0 > t) break;
    const n = tr.xy.length / 2, u = t - tr.t0;
    if (u > n - 1) continue;
    const i = Math.floor(u), f = u - i, j = Math.min(n - 1, i + 1);
    out.push(tr.team, tr.xy[i * 2] + (tr.xy[j * 2] - tr.xy[i * 2]) * f, tr.xy[i * 2 + 1] + (tr.xy[j * 2 + 1] - tr.xy[i * 2 + 1]) * f, 1);
  }
  return out;
}

/**
 * Puts a demo on the match clock. A demo's ticks keep counting through pauses while the match clock (the match data,
 * the coach) stops, so after a pause everything read by tick runs ahead by the pause; those times are moved back.
 * The ultimate's cooldowns are on the server clock, which stops with the match but started earlier: they're moved by
 * how far they sit from the ultimate casts.
 */
/** The demo's tick clock (keeps counting through pauses) against the match clock: g(tick time) → match time, tau back. */
export function matchClock(m: DlMatch) {
  const pauses = m.pauses ?? [];
  let before = 0;
  const spans = pauses.map(p => { const at = p.t + before; before += p.dur; return { at, dur: p.dur }; });
  return {
    pauses,
    g: (tau: number) => +(tau - spans.reduce((a, s) => a + Math.max(0, Math.min(s.dur, tau - s.at)), 0)).toFixed(2),
    tau: (t: number) => t + pauses.filter(p => p.t < t).reduce((a, p) => a + p.dur, 0),
  };
}

export function toMatchClock(d: DlDemo, m: DlMatch): DlDemo {
  if (d.clock === 2 || !m.pauses) return d;
  const { pauses, g, tau } = matchClock(m);
  const gn = (x: number | null) => (x === null ? null : g(x));
  const resample = <T,>(xs: T[], dt: number) => xs.map((_, i) => xs[Math.min(xs.length - 1, Math.round(tau(i * dt) / dt))]);
  const out: DlDemo = {
    ...d, clock: 2,
    camps: d.camps.map(xs => xs.map(([a, b]) => [g(a), g(b)] as [number, number])),
    buffs: d.buffs.map(xs => xs.map(([a, b]) => [g(a), g(b)] as [number, number])),
    urn: d.urn.map(u => ({ ...u, from: g(u.from), landed: g(u.landed), taken: gn(u.taken), until: gn(u.until) })),
    casts: d.casts.map(c => ({ ...c, t: g(c.t) })), kills: d.kills.map(k => ({ ...k, t: g(k.t) })),
    midBossSpawns: d.midBossSpawns.map(g), rejuv: d.rejuv.map(r => ({ ...r, t: g(r.t) })), bags: d.bags?.map(b => ({ ...b, t: g(b.t) })),
    creepDeaths: d.creepDeaths.map(c => ({ ...c, t: g(c.t) })),
    troopers: d.troopers ? troopersOnClock(d.troopers, m) : d.troopers,
    rifts: d.rifts.map(r => ({ ...r, from: g(r.from), opens: g(r.opens), taken: gn(r.taken), progress: r.progress.map(p => ({ ...p, t: g(p.t) })) })),
    tracks: pauses.length ? Object.fromEntries(Object.entries(d.tracks).map(([k, tr]) => [k, { x: resample(tr.x, TRACK_DT), y: resample(tr.y, TRACK_DT), z: resample(tr.z, TRACK_DT) }])) : d.tracks,
    stats: pauses.length ? Object.fromEntries(Object.entries(d.stats).map(([k, st]) => [k, { nw: resample(st.nw, STAT_DT), lh: resample(st.lh, STAT_DT), dn: resample(st.dn, STAT_DT), lvl: resample(st.lvl, STAT_DT) }])) : d.stats,
    creeps: pauses.length ? Object.fromEntries(Object.keys(d.creeps).map(Number).map(b => [Math.round(g(b * STAT_DT) / STAT_DT), d.creeps[b]])) : d.creeps,
  };
  // the ultimate: unlocked at a sample (tick time); cooldowns on the server clock, offset found from the casts
  const diffs: number[] = [];
  for (const c of out.casts) if (c.ult) {
    const next = (d.ults[c.slot]?.cds ?? []).map(([a]) => a - c.t).filter(x => x >= -5 && x <= 150);
    if (next.length) diffs.push(Math.min(...next));
  }
  diffs.sort((a, b) => a - b);
  const off = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
  out.ults = Object.fromEntries(Object.entries(d.ults).map(([k, u]) => {
    // one cast can show as a few cooldowns a moment apart (cooldown items changing it): keep the first
    const cds: [number, number][] = [];
    for (const [a, b] of [...u.cds].sort((x, y) => x[0] - y[0])) {
      const c: [number, number] = [+(a - off).toFixed(1), +(b - off).toFixed(1)];
      if (!cds.length || c[0] - cds[cds.length - 1][0] > 15) cds.push(c);
    }
    return [k, { from: u.from === null ? null : g(u.from), cds }];
  }));
  return out;
}

/** A match without a demo: deadlock-api never had its replay, or Valve has deleted it (replays are kept a while). */
export class NoDemo extends Error {
  constructor(id: number) {
    super('No demo for this match: deadlock-api doesn\'t have its replay, or Valve no longer keeps it (replays are kept for a while after a match). '
      + 'The replay below uses the match data: heroes once a second, kills, items, objectives, and the timings on their schedule.');
    markMissing(id);
  }
}
const MISSING = 'stratboard.dldemo.missing';
const missing = (): number[] => { try { return JSON.parse(localStorage.getItem(MISSING) ?? '[]'); } catch { return []; } };
function markMissing(id: number) { try { localStorage.setItem(MISSING, JSON.stringify([...new Set([id, ...missing()])].slice(0, 500))); } catch { /* private mode */ } }
function unmarkMissing(id: number) { try { localStorage.setItem(MISSING, JSON.stringify(missing().filter(x => x !== id))); } catch { /* private mode */ } }

const KEY = (id: number) => `dldemo${DEMO_V}:${id}`;
/**
 * Whether a match has a demo to read: 'read' (kept in this browser), 'listed' (deadlock-api has its replay link;
 * it can still turn out deleted), or 'none'. For the match list.
 */
export async function demoState(id: number): Promise<'read' | 'listed' | 'none'> {
  if (await getItem<Blob>(KEY(id))) return 'read';
  if (missing().includes(id)) return 'none';
  try {
    const r = await (await fetch(`${API}/v1/matches/${id}/salts?disable_steam=true`)).json();
    return r?.replay_salt ? 'listed' : 'none';
  } catch { return 'none'; }
}
/**
 * The match's demo: from this browser when read before; else from its replay file on this PC when one was found
 * (localReplays.ts: read here in seconds), else read by deadlock-api (about a minute); then kept. `onLocal` gets how far
 * into the file it is (0–1).
 */
export async function loadDemo(m: DlMatch, onWait: (s: number | null) => void = () => {}, onLocal: (p: number) => void = () => {}): Promise<DlDemo> {
  const saved = await getItem<Blob>(KEY(m.id));
  if (saved) {
    try {
      const d = await gunzipJson<DlDemo>(saved);
      // kept before the match-clock fix: fix it here (the replay may be gone from Valve, so it can't be read again)
      if (d.v === DEMO_V && d.clock === undefined) { const f = toMatchClock(d, m); if (f.clock) void setItem(KEY(m.id), await gzipJson(f)); return f; }
      if (d.v === DEMO_V && d.clock === 2) {
        if (d.troopers === undefined) void addTroopers(m, d);
        else if (d.bags === undefined) void addBags(m, d);
        return d;
      }
    } catch { /* read it again */ }
  }
  const file = localReplay(m.id);
  if (file) {
    try {
      const { readReplay } = await import('./localDemo');
      // the replay file has no soul bags (the reader can't see them yet): deadlock-api adds them when it has the demo
      const d: DlDemo = { ...buildDemo(m, await readReplay(file, onLocal)), bags: undefined };
      void setItem(KEY(m.id), await gzipJson(d));
      void addBags(m, d);
      return d;
    } catch { /* a replay the reader doesn't understand (a newer game build): deadlock-api's copy instead */ }
  }
  if ((await demoState(m.id)) === 'none') throw new NoDemo(m.id);
  const d = buildDemo(m, await runAll(m.id, onWait));
  void setItem(KEY(m.id), await gzipJson(d));
  return d;
}

/** Whether `t` falls in one of the intervals. */
export const upAt = (xs: [number, number][], t: number) => xs.some(([a, b]) => t >= a && t < b);

/** A hero's spot at time t from the demo (between the quarter-second samples; a jump of more than 4% of the map in a
 * quarter second is a teleport, not drawn as a slide); null while dead or not in the demo. */
export function heroAt(demo: DlDemo, slot: number, t: number): { x: number; y: number; z: number } | null {
  const tr = demo.tracks?.[slot];
  if (!tr) return null;
  const f = t / TRACK_DT, i = Math.floor(f), j = i + 1, w = f - i;
  const ok = (k: number) => k >= 0 && k < tr.x.length && !Number.isNaN(tr.x[k]);
  if (!ok(i)) return ok(j) && w > 0.5 ? { x: tr.x[j], y: tr.y[j], z: tr.z[j] } : null;
  if (!ok(j) || Math.hypot(tr.x[j] - tr.x[i], tr.y[j] - tr.y[i]) > 0.04) return { x: tr.x[i], y: tr.y[i], z: tr.z[i] };
  return { x: tr.x[i] + (tr.x[j] - tr.x[i]) * w, y: tr.y[i] + (tr.y[j] - tr.y[i]) * w, z: tr.z[i] + (tr.z[j] - tr.z[i]) * w };
}

/** A player's numbers at time t from the demo (null without one). */
export function statsAt(demo: DlDemo | null, slot: number, t: number) {
  const st = demo?.stats?.[slot];
  if (!st) return null;
  const b = Math.max(0, Math.min(st.nw.length - 1, Math.floor(t / STAT_DT)));
  return { nw: st.nw[b], lh: st.lh[b], dn: st.dn[b], lvl: st.lvl[b] };
}
/**
 * Lane creeps at time t, gliding between the 2-second samples: each group (one map cell's worth, averaged over its
 * sample) is matched to the nearest group of its team in the next sample and drawn between the two; a group with no
 * match (it died, or split or merged across cells) shows until halfway, a new one from halfway. Flat [team, x, y, n, …].
 */
export function creepsAt(demo: DlDemo | null, t: number): number[] | null {
  const c = demo?.creeps;
  if (!c) return null;
  // a sample averages its 2 s, so it stands for the middle of them
  const u = (t - STAT_DT / 2) / STAT_DT, b = Math.floor(u), f = u - b;
  const A = c[b], B = c[b + 1];
  if (!A || !B) return (f < 0.5 ? A ?? B : B ?? A) ?? null;
  const na = A.length / 4, nb = B.length / 4;
  // pairs of the same team close enough to be the same creeps 2 s on (they walk about 3% of the map in 2 s)
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    if (A[i * 4] !== B[j * 4]) continue;
    const d = Math.hypot(A[i * 4 + 1] - B[j * 4 + 1], A[i * 4 + 2] - B[j * 4 + 2]);
    if (d < 0.045) pairs.push([d, i, j]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const ua = new Set<number>(), ub = new Set<number>(), out: number[] = [];
  for (const [, i, j] of pairs) {
    if (ua.has(i) || ub.has(j)) continue;
    ua.add(i); ub.add(j);
    out.push(A[i * 4], A[i * 4 + 1] + (B[j * 4 + 1] - A[i * 4 + 1]) * f, A[i * 4 + 2] + (B[j * 4 + 2] - A[i * 4 + 2]) * f, f < 0.5 ? A[i * 4 + 3] : B[j * 4 + 3]);
  }
  if (f < 0.5) { for (let i = 0; i < na; i++) if (!ua.has(i)) out.push(...A.slice(i * 4, i * 4 + 4)); }
  else for (let j = 0; j < nb; j++) if (!ub.has(j)) out.push(...B.slice(j * 4, j * 4 + 4));
  return out;
}

/** A player's ultimate at time t: not unlocked yet, cooling down (seconds left), or ready; null without a demo. */
export function ultAt(demo: DlDemo | null, slot: number, t: number): { state: 'locked' } | { state: 'cooldown'; left: number; of: number } | { state: 'ready' } | null {
  const u = demo?.ults?.[slot];
  if (!u) return null;
  if (u.from === null || t < u.from) return { state: 'locked' };
  const cd = u.cds.find(([a, b]) => t >= a && t < b);
  return cd ? { state: 'cooldown', left: cd[1] - t, of: cd[1] - cd[0] } : { state: 'ready' };
}

/** The rift at time t: showing (not open yet), being contested (each team's progress, players on the point), or just
 * taken (for 10 s after); null when there's none. */
export function riftAt(demo: DlDemo | null, t: number) {
  const r = demo?.rifts?.find(x => t >= x.from && t < (x.taken ?? Infinity) + 10);
  if (!r) return null;
  if (t < r.opens) return { ...r, phase: 'showing' as const, p: [0, 0] as [number, number], n: [0, 0] as [number, number] };
  if (r.taken !== null && t >= r.taken) return { ...r, phase: 'taken' as const, p: [0, 0] as [number, number], n: [0, 0] as [number, number] };
  const now = [...r.progress].reverse().find(s => s.t <= t);
  return { ...r, phase: 'contest' as const, p: now?.p ?? [0, 0], n: now?.n ?? [0, 0] };
}

/**
 * Reads the open match's demo into Review (status by the clock). `again`: forget the copy kept in this browser (and
 * that it had no demo) and read it afresh from deadlock-api: to retry, or to pick up a newer way of reading it.
 */
export async function readDemo(m: DlMatch, again = false) {
  const mine = () => useDl.getState().match?.id === m.id;
  if (again) { await delItem(KEY(m.id)); unmarkMissing(m.id); }
  useDl.setState({ demoStatus: { state: 'reading' }, ...(again ? { demo: null } : {}) });
  try {
    const demo = await loadDemo(m, wait => { if (mine()) useDl.setState({ demoStatus: { state: 'reading', wait } }); },
      local => { if (mine()) useDl.setState({ demoStatus: { state: 'reading', local } }); });
    if (mine()) useDl.setState({ demo, demoStatus: { state: 'done' } });
  } catch (e) {
    if (mine()) useDl.setState({ demoStatus: { state: 'failed', error: e instanceof Error ? e.message : String(e) } });
  }
}

/**
 * A demo kept before lane creeps were read one by one: reads just them (in the background) and keeps them with it.
 * When the replay is gone from Valve by now, it's marked so it isn't tried again; the creeps stay in groups.
 */
async function addTroopers(m: DlMatch, d: DlDemo) {
  let troopers: DlTrooper[] | null = null;
  try {
    const q = await runAll(m.id, () => {}, ['troopers']);
    const { g } = matchClock(m);
    // the demo's team numbers, as the match's teams: by which team's creep groups they walk with
    const votes = new Map<string, number>();
    for (const r of q.troopers.slice(0, 4000)) {
      if (Number(r.ls) !== 0 || r.cx == null) continue;
      const groups = d.creeps[Math.floor(g(Number(r.s)) / STAT_DT)], p = spot(r);
      if (!groups) continue;
      for (let i = 0; i < groups.length; i += 4) if (Math.hypot(groups[i + 1] - p.x, groups[i + 2] - p.y) < 0.02) { const k = `${r.team}:${groups[i]}`; votes.set(k, (votes.get(k) ?? 0) + 1); }
    }
    const teamOf = (num: number) => { const a = votes.get(`${num}:0`) ?? 0, b = votes.get(`${num}:1`) ?? 0; return a + b < 5 ? undefined : a > b ? 0 as const : 1 as const; };
    troopers = troopersOnClock(troopersFrom(q.troopers, teamOf), m);
  } catch (e) {
    if (!(e instanceof NoDemo)) return; // busy or failed: try again next time
  }
  const f: DlDemo = { ...d, troopers };
  void setItem(KEY(m.id), await gzipJson(f));
  if (useDl.getState().match?.id === m.id && useDl.getState().demo === d) useDl.setState({ demo: f });
}

/** Soul bag pickups from their rows (players are pawn handles); on the demo's tick clock. */
function bagsFrom(rows: Row[], slotOf: (h: Row[string]) => number | null): DlBag[] {
  const out: DlBag[] = [];
  for (const r of rows) {
    const slot = slotOf(r.a);
    if (slot !== null) out.push({ t: Number(r.tick) / TICKS, slot, victim: slotOf(r.b), souls: Number(r.g) || 0 });
  }
  return out;
}

/** A demo kept before soul bags were read: reads just them (and who's who) in the background, and keeps them. */
async function addBags(m: DlMatch, d: DlDemo) {
  let bags: DlBag[] = [];
  try {
    const q = await runAll(m.id, () => {}, ['players', 'bags']);
    const slotOfPawn = new Map<number, number>();
    for (const r of q.players) {
      const slot = parseInt(String(r.slot ?? '').slice(0, 2), 16), pawn = Number(r.pawn) & 0x3fff;
      if (Number.isFinite(slot) && pawn && pawn !== 0x3fff) slotOfPawn.set(pawn, slot);
    }
    const { g } = matchClock(m);
    bags = bagsFrom(q.bags, h => (h == null ? null : slotOfPawn.get(Number(h) & 0x3fff) ?? null)).map(b => ({ ...b, t: g(b.t) }));
  } catch (e) {
    if (!(e instanceof NoDemo)) return; // busy or failed: try again next time
  }
  const f: DlDemo = { ...d, bags };
  void setItem(KEY(m.id), await gzipJson(f));
  if (useDl.getState().match?.id === m.id && useDl.getState().demo === d) useDl.setState({ demo: f });
}

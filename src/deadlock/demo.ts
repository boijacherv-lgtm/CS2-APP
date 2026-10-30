/**
 * The match's demo, read by deadlock-api on its own servers (its Demo Query: SQL over the demo's entity and event
 * tables, ~20–60 s a match, results zstd-compressed NDJSON): what the match data doesn't have. Camps and Sinner's
 * Sacrifice up and down to the second, the urn on the ground and who carried it, the bridge buffs, every ability
 * cast (ultimates marked), kills with what did them, the mid boss's spawns and the Rejuvenator claims.
 *
 * A demo tick is 1/64 s of match time (checked against the kills in the match data, ±1 s). Positions are the
 * Source 2 cell + offset: world = (cell − 64) × 512 + vec. Kept in this browser once read, like the match.
 */
import { decompress } from 'fzstd';
import { getItem, gunzipJson, gzipJson, setItem } from '../ui/localStore';
import { DL_MAP, heroOf, toMap } from './data';
import { playerAt, type DlMatch } from './match';

const API = 'https://api.deadlock-api.com';
const TICKS = 64;
/** Bump when what's read or how it's put together changes: demos read before are read again. */
const DEMO_V = 2;

export interface DlDemo {
  v: number;
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
}

// ---- the queries (table names are matched case-insensitively, column names must be quoted) ----------------------
const LIFE = (table: string) => `SELECT tick, entity_index AS e, delta_type AS d, ls, cx, cy, vx, vy FROM (
  SELECT tick, entity_index, delta_type, "m_lifeState" AS ls, lag("m_lifeState") OVER (PARTITION BY entity_index ORDER BY tick) AS prev,
    "CBodyComponent__m_cellX" AS cx, "CBodyComponent__m_cellY" AS cy, "CBodyComponent__m_vecX" AS vx, "CBodyComponent__m_vecY" AS vy FROM ${table}
) WHERE delta_type <> 'update' OR ls <> prev ORDER BY tick`;
const POS = `"CBodyComponent__m_cellX" AS cx, "CBodyComponent__m_cellY" AS cy, "CBodyComponent__m_vecX" AS vx, "CBodyComponent__m_vecY" AS vy`;
const NUL = (t: string) => `CAST(NULL AS ${t})`;
const QUERIES = {
  players: `SELECT entity_index, last_value("m_unLobbyPlayerSlot" ORDER BY tick) AS slot, last_value("m_hHeroPawn" ORDER BY tick) AS pawn,
    last_value("m_PlayerDataGlobal__m_nHeroID" ORDER BY tick) AS hero FROM CCitadelPlayerController GROUP BY entity_index`,
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
  buffs: `SELECT tick, e, d, act, cx, cy, vx, vy FROM (SELECT tick, entity_index AS e, delta_type AS d, "m_bActive" AS act,
    lag("m_bActive") OVER (PARTITION BY entity_index ORDER BY tick) AS prev, ${POS} FROM CCitadel_Pickup_Modifier) WHERE d <> 'update' OR act <> prev ORDER BY tick`,
};
type Q = keyof typeof QUERIES;
type Row = Record<string, number | string | boolean | null>;

/** Runs every query for a match on deadlock-api, together; `onWait` gets the longest estimated wait (s). */
async function runAll(matchId: number, onWait: (s: number | null) => void): Promise<Record<Q, Row[]>> {
  const jobs = {} as Record<Q, string>;
  await Promise.all((Object.keys(QUERIES) as Q[]).map(async q => {
    const res = await fetch(`${API}/v1/matches/demo/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: matchId, query: QUERIES[q], format: 'ndjson' }) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error('deadlock-api is busy reading demos: try again in a few minutes.');
    if (!res.ok || !out.job_id) throw new Error(out.error ? `The demo couldn't be read: ${String(out.error).slice(0, 160)}` : `deadlock-api answered ${res.status}.`);
    jobs[q] = out.job_id;
  }));
  const done = {} as Record<Q, Row[]>;
  for (let round = 0; Object.keys(done).length < Object.keys(jobs).length; round++) {
    if (round > 90) throw new Error('Reading the demo is taking too long: try again later.');
    await new Promise(r => setTimeout(r, round === 0 ? 8000 : 4000));
    let wait: number | null = null;
    for (const q of Object.keys(jobs) as Q[]) {
      if (done[q]) continue;
      const st = await (await fetch(`${API}/v1/matches/demo/query/${jobs[q]}`)).json();
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
  const end = m.duration * TICKS;
  // which hero entity is which player
  const slotOfPawn = new Map<number, number>();
  for (const r of q.players) {
    const slot = parseInt(String(r.slot ?? '').slice(0, 2), 16), pawn = Number(r.pawn) & 0x3fff;
    if (Number.isFinite(slot) && pawn && pawn !== 0x3fff && m.players.some(p => p.slot === slot)) slotOfPawn.set(pawn, slot);
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
  urn.forEach((u, i) => {
    if (u.taken === null) return;
    // carried by the hero nearest it when it went; until the next one comes, or it's run out (45 s + 45 s decay)
    // (after 3 min unclaimed it walks toward its drop-off, so it can be a little way from where it was last seen)
    let bd = u.taken - u.from > 180 ? 0.08 : 0.04;
    for (const p of m.players) { const a = playerAt(m, p.slot, u.taken); const d = a ? Math.hypot(a.x - u.x, a.y - u.y) : 9; if (d < bd) { bd = d; u.slot = p.slot; } }
    u.until = Math.min(urn[i + 1]?.from ?? m.duration, u.taken + 90, m.duration);
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
  return { v: DEMO_V, camps: campLives.map(xs => merge(xs)), urn, buffs: buffs.map(xs => merge(xs)), casts, kills, midBossSpawns, rejuv };
}

const KEY = (id: number) => `dldemo${DEMO_V}:${id}`;
/** The match's demo: from this browser when read before, else read by deadlock-api (about a minute), then kept. */
export async function loadDemo(m: DlMatch, onWait: (s: number | null) => void = () => {}): Promise<DlDemo> {
  const saved = await getItem<Blob>(KEY(m.id));
  if (saved) { try { const d = await gunzipJson<DlDemo>(saved); if (d.v === DEMO_V) return d; } catch { /* read it again */ } }
  const d = buildDemo(m, await runAll(m.id, onWait));
  void setItem(KEY(m.id), await gzipJson(d));
  return d;
}

/** Whether `t` falls in one of the intervals. */
export const upAt = (xs: [number, number][], t: number) => xs.some(([a, b]) => t >= a && t < b);

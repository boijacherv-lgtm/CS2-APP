/**
 * A Deadlock replay (.dem) read here, in the browser, with deadem: for a match deadlock-api has no demo for, from the
 * file on your PC. It gives the same rows deadlock-api's Demo Query does (demo.ts's QUERIES, one list per query), so
 * buildDemo puts both together the same way. The demo's ticks are the same either way (checked on kills, to the tick).
 *
 * Rows that SQL groups by time (a hero every quarter second, a player every 2 s…) are the state just before the first
 * packet of the next span: the last value in the span. Rows SQL keeps on a change (a camp's creature dying) are taken
 * as the change comes. Soul bags aren't in deadem's messages yet: none here.
 */
import { InterceptorStage, Logger, MessagePacketType, Parser, ParserConfiguration, type Demo, type DemoPacket, type Entity, type EntityMutationEvent, type MessagePacket } from 'deadem';
import { STAT_DT, TRACK_DT, type Q, type Row } from './demo';

const TICKS = 64;
const CLASSES = {
  ctrl: 'CCitadelPlayerController', pawn: 'CCitadelPlayerPawn', rules: 'CCitadelGameRulesProxy', trooper: 'CNPC_Trooper',
  camp: 'CNPC_TrooperNeutral', sinners: 'CNPC_Neutral_SinnersSacrifice', riftOpen: 'CCitadelItemKothSpawner', riftCash: 'CCitadel_KothCashIn',
  urn: 'CCitadelItemPickupIdol', buff: 'CCitadel_Pickup_Modifier',
};
const f = (e: Entity, name: string) => e.getField(name) as number | boolean | string | undefined;
const pos = (e: Entity) => ({ cx: f(e, 'CBodyComponent.m_cellX') ?? null, cy: f(e, 'CBodyComponent.m_cellY') ?? null, vx: f(e, 'CBodyComponent.m_vecX') ?? null, vy: f(e, 'CBodyComponent.m_vecY') ?? null }) as Row;
const NO_POS: Row = { cx: null, cy: null, vx: null, vy: null };
const num = (v: unknown) => (v == null ? null : Number(v));
/** The player slot as deadlock-api writes it: the byte in hex, then padding. */
const slotHex = (v: unknown) => `${Number(v).toString(16).padStart(2, '0')}00000000000000`;

/** Reads a replay into deadlock-api's rows. `onProgress` gets how far in (0–1) by bytes read. */
export async function readReplay(file: Blob, onProgress: (p: number) => void = () => {}): Promise<Record<Q, Row[]>> {
  const q = { players: [], stats: [], creeps: [], troopers: [], creepDeaths: [], rift: [], koth: [], events: [], camps: [], sinners: [], urn: [], heroes: [], bags: [], buffs: [] } as Record<Q, Row[]>;
  const parser = new Parser(new ParserConfiguration({ entityClasses: Object.values(CLASSES) }), Logger.NOOP);
  const demo = (): Demo => parser.getDemo();
  const all = (cls: string) => demo().getEntitiesByClassName(cls);

  // ---- sampled: the state as each span ends -------------------------------------------------------------------
  let quarter = -1, second = -1, two = -1;
  const players = new Map<number, Row>();
  parser.registerPreInterceptor(InterceptorStage.DEMO_PACKET, ((dp: DemoPacket) => {
    const b4 = Math.floor(dp.tick / (TICKS * TRACK_DT)), s = Math.floor(dp.tick / TICKS), b2 = Math.floor(dp.tick / (TICKS * STAT_DT));
    if (b4 > quarter && quarter >= 0) for (const e of all(CLASSES.pawn)) {
      q.heroes.push({ b: quarter, e: e.index, ...pos(e), cz: num(f(e, 'CBodyComponent.m_cellZ')), vz: num(f(e, 'CBodyComponent.m_vecZ')), ls: num(f(e, 'm_lifeState')) });
    }
    if (s > second && second >= 0) {
      for (const e of all(CLASSES.trooper)) q.troopers.push({ s: second, e: e.index, team: num(f(e, 'm_iTeamNum')), ...pos(e), ls: num(f(e, 'm_lifeState')) });
      for (const e of all(CLASSES.rules)) {
        const k = (i: number, x: string) => Number(f(e, `m_pGameRules.m_vecTeamKothStates.000${i}.${x}`) ?? 0);
        q.koth.push({ s: second, p: [k(0, 'm_flCaptureProgressFrac'), k(1, 'm_flCaptureProgressFrac')] as never, n: [k(0, 'm_nCapturerCount'), k(1, 'm_nCapturerCount')] as never, team: num(f(e, 'm_pGameRules.m_nKothScoringTeam')) });
      }
    }
    if (b2 > two && two >= 0) {
      for (const e of all(CLASSES.ctrl)) {
        const slot = f(e, 'm_unLobbyPlayerSlot');
        if (slot == null) continue;
        players.set(e.index, { entity_index: e.index, slot: slotHex(slot), pawn: num(f(e, 'm_hHeroPawn')), hero: num(f(e, 'm_nHeroID')), team: num(f(e, 'm_iTeamNum')) });
        q.stats.push({
          b: two, slot: slotHex(slot), nw: num(f(e, 'm_iGoldNetWorth')), lh: num(f(e, 'm_iLastHits')), dn: num(f(e, 'm_iDenies')), lvl: num(f(e, 'm_iLevel')),
          ut: f(e, 'm_bUltimateTrained') === true, us: num(f(e, 'm_flUltimateCooldownStart')), ue: num(f(e, 'm_flUltimateCooldownEnd')),
        });
      }
      // lane creeps in groups: by team and map cell, their offsets averaged
      const groups = new Map<string, { team: number; cx: number; cy: number; vx: number; vy: number; n: number }>();
      for (const e of all(CLASSES.trooper)) {
        if (Number(f(e, 'm_lifeState')) !== 0) continue;
        const p = pos(e), team = Number(f(e, 'm_iTeamNum'));
        if (p.cx == null) continue;
        const key = `${team}:${p.cx}:${p.cy}`, g = groups.get(key) ?? { team, cx: Number(p.cx), cy: Number(p.cy), vx: 0, vy: 0, n: 0 };
        g.vx += Number(p.vx); g.vy += Number(p.vy); g.n++;
        groups.set(key, g);
      }
      for (const g of groups.values()) q.creeps.push({ b: two, team: g.team, cx: g.cx, cy: g.cy, vx: g.vx / g.n, vy: g.vy / g.n, n: g.n });
    }
    quarter = b4; second = s; two = b2;
  }) as never);

  // ---- on a change: lives, the rift, the buffs, creep deaths, the urn ------------------------------------------
  const prev = new Map<string, unknown>();
  const urnBySecond = new Map<number, Row>();
  const LIFE: Record<string, Row[]> = { [CLASSES.camp]: q.camps, [CLASSES.sinners]: q.sinners };
  parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET, ((dp: DemoPacket, _mp: MessagePacket, events: EntityMutationEvent[]) => {
    for (const ev of events) {
      const e = ev.entity, cls = e.class.name, op = ev.operation.code, tick = dp.tick;
      const d = op === 'CREATE' ? 'create' : op === 'UPDATE' ? 'update' : 'leave';
      const key = `${e.index}`;
      if (LIFE[cls]) {
        const ls = d === 'leave' ? null : num(f(e, 'm_lifeState'));
        if (d !== 'update' || ls !== prev.get(key)) LIFE[cls].push({ tick, e: e.index, d, ls, ...(d === 'leave' ? NO_POS : pos(e)) });
        prev.set(key, ls);
      } else if (cls === CLASSES.trooper) {
        if (d === 'leave') { prev.delete(key); continue; }
        const ls = num(f(e, 'm_lifeState')), was = prev.get(key);
        if (ls !== 0 && was === 0) q.creepDeaths.push({ tick, team: num(f(e, 'm_iTeamNum')), ...pos(e) });
        prev.set(key, ls);
      } else if (cls === CLASSES.riftOpen || cls === CLASSES.riftCash) {
        if (d !== 'update') q.rift.push({ tick, e: e.index, d, k: cls === CLASSES.riftOpen ? 'open' : 'cash', ...(d === 'leave' ? NO_POS : pos(e)) });
      } else if (cls === CLASSES.buff) {
        const act = d === 'leave' ? null : f(e, 'm_bActive') === true;
        if (d !== 'update' || act !== prev.get(key)) q.buffs.push({ tick, e: e.index, d, act, ...(d === 'leave' ? NO_POS : pos(e)) });
        prev.set(key, act);
      } else if (cls === CLASSES.urn) {
        urnBySecond.set(Math.floor(tick / TICKS), d === 'leave' ? NO_POS : pos(e));
      }
    }
  }) as never);

  // ---- events: kills, ability casts, the mid boss, the Rejuvenator -------------------------------------------
  const T = MessagePacketType;
  parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, ((dp: DemoPacket, mp: MessagePacket) => {
    const x = mp.data, tick = dp.tick;
    if (mp.type === T.CITADEL_USER_MESSAGE_HERO_KILLED) q.events.push({ tick, k: 'kill', a: num(x.entindexVictim), b: num(x.entindexAttacker), c: num(x.killerAbilityId), s: null });
    else if (mp.type === T.CITADEL_USER_MESSAGE_IMPORTANT_ABILITY_USED) q.events.push({ tick, k: 'cast', a: num(x.caster), b: num(x.player), c: null, s: String(x.abilityName ?? '') });
    else if (mp.type === T.CITADEL_USER_MESSAGE_MID_BOSS_SPAWNED) q.events.push({ tick, k: 'midboss', a: null, b: null, c: null, s: null });
    else if (mp.type === T.CITADEL_USER_MESSAGE_REJUV_STATUS) q.events.push({ tick, k: 'rejuv', a: num(x.playerPawn), b: num(x.killingTeam), c: num(x.eventType), s: null });
  }) as never);

  // the file, counted as it's read
  let read = 0;
  const counted = file.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) { read += chunk.byteLength; onProgress(Math.min(1, read / file.size)); out.enqueue(chunk); },
  }));
  try { await parser.parse(counted); } finally { await parser.dispose(); }

  q.players = [...players.values()];
  q.urn = [...urnBySecond.entries()].sort((a, b) => a[0] - b[0]).map(([s, p]) => ({ s, ...p }));
  return q;
}

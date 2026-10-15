// Turns a CS2 .dem into compact per-round data for the review screen.
// Runs in the Vite dev server (Node) — the parser is a native module.
// Parser-agnostic: `p` provides parseHeader / parseEvent / parseEvents / parseTicks / parseGrenades, each taking the
// demo (`input`: a file path for the native parser, bytes for the browser build) as its first argument.
// tools/demo.mjs passes the native parser (desktop app, server); src/ui/demoWorker.ts the WebAssembly build (website).

const TICKRATE = 64;
const SAMPLE_EVERY = 16; // ticks → 0.25 s
const side = n => (n === 3 || n === '3' ? 'CT' : n === 2 || n === '2' ? 'T' : null);
const num = v => (typeof v === 'number' ? v : v == null ? NaN : Number(v));
const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const sid = v => (v == null ? '' : String(v));

/** `progress(step, of)` is called between the parser passes (each one reads the whole demo). */
export function buildDemoData(parser, input, progress = () => {}) {
  // count the passes so a slow (browser) parse can show progress
  let pass = 0;
  const p = Object.fromEntries(Object.entries(parser).map(([k, f]) => [k, (...args) => { progress(++pass); return f(...args); }]));
  const header = p.parseHeader(input) ?? {};
  const map = String(pick(header, 'map_name', 'mapName') ?? 'unknown');

  const roundEvents = p.parseEvents(input, ['round_freeze_end', 'round_end', 'bomb_planted', 'bomb_defused', 'bomb_exploded']) ?? [];
  const evName = e => pick(e, 'event_name', 'eventName');
  const freezeEnds = roundEvents.filter(e => evName(e) === 'round_freeze_end').map(e => num(e.tick)).sort((a, b) => a - b);
  const roundEnds = roundEvents.filter(e => evName(e) === 'round_end').sort((a, b) => num(a.tick) - num(b.tick));

  // Pair each freeze-end with the next round-end.
  const rounds = [];
  for (const start of freezeEnds) {
    const end = roundEnds.find(e => num(e.tick) > start);
    if (!end) continue;
    if (rounds.length && rounds[rounds.length - 1].end === num(end.tick)) rounds.pop(); // keep the last freeze-end before a round end
    const w = pick(end, 'winner', 'winner_team');
    rounds.push({
      start, end: num(end.tick),
      winner: side(num(w)) ?? (String(w).toUpperCase().includes('CT') ? 'CT' : String(w).toUpperCase() === 'T' ? 'T' : null),
      reason: String(pick(end, 'reason', 'message') ?? ''),
    });
  }

  // Positions, sampled.
  const wanted = [];
  for (const r of rounds) for (let t = r.start; t <= r.end; t += SAMPLE_EVERY) wanted.push(t);
  const ticks = wanted.length
    ? p.parseTicks(input, ['X', 'Y', 'Z', 'yaw', 'health', 'is_alive', 'team_num'], wanted) ?? []
    : [];

  // Economy, read a few seconds into each round (after most buys). Each field is parsed on its own
  // so a field this parser version doesn't know can't break the whole demo.
  const econTicks = rounds.map(r => Math.min(r.end, r.start + 5 * TICKRATE));
  const econ = new Map(); // `${tick}|${steamid}` -> { ...fields }
  const ECON_FIELDS = {
    money: ['balance'], equip: ['current_equip_value', 'round_start_equip_value'], armor: ['armor_value'],
    helmet: ['has_helmet'], defuser: ['has_defuser'], weapons: ['inventory'], active: ['active_weapon_name'],
  };
  for (const [key, candidates] of Object.entries(ECON_FIELDS))
    for (const prop of candidates) {
      const rows = econTicks.length ? safe(() => p.parseTicks(input, [prop], econTicks)) : null;
      if (!rows?.length) continue;
      for (const row of rows) {
        const k = `${num(row.tick)}|${sid(pick(row, 'steamid', 'player_steamid'))}`;
        const e = econ.get(k) ?? {};
        if (e[key] === undefined) e[key] = row[prop];
        econ.set(k, e);
      }
      break; // first candidate that works
    }

  const deaths = p.parseEvent(input, 'player_death', ['X', 'Y', 'team_num'], []) ?? [];
  const blinds = safe(() => p.parseEvent(input, 'player_blind', ['team_num'], [])) ?? [];
  const nades = safe(() => p.parseEvents(input, ['flashbang_detonate', 'hegrenade_detonate', 'smokegrenade_detonate', 'inferno_startburn'])) ?? [];
  const nadeEnds = safe(() => p.parseEvents(input, ['smokegrenade_expired', 'inferno_expire'])) ?? [];
  const flights = safe(() => grenadeFlights(p, input)) ?? [];
  // damage: grenades (HE / fire) for grading utility, guns for ADR and missed duels
  const allHurts = safe(() => p.parseEvent(input, 'player_hurt', [], [])) ?? [];
  const hurts = allHurts.filter(h => /hegrenade|inferno|molotov|incgrenade/.test(String(pick(h, 'weapon') ?? '')));
  const gunHurts = allHurts.filter(h => !/hegrenade|inferno|molotov|incgrenade|world|knife|bayonet/.test(String(pick(h, 'weapon') ?? '')));
  // every gun shot (one event per bullet; grenades, knife, bomb and taser excluded)
  const shotsAll = (safe(() => p.parseEvent(input, 'weapon_fire', [], [])) ?? [])
    .filter(w => !/grenade|flashbang|molotov|incgrenade|decoy|knife|bayonet|c4|taser/.test(String(pick(w, 'weapon') ?? '')));
  const plants = roundEvents.filter(e => evName(e) === 'bomb_planted').map(e => num(e.tick));
  // where the bomb is: who picks it up, where it's dropped / planted, defused or blown up (positions are the player's)
  const BOMB_KIND = { bomb_pickup: 'carry', bomb_dropped: 'drop', bomb_planted: 'plant', bomb_defused: 'defuse', bomb_exploded: 'explode' };
  const bombEvents = (safe(() => p.parseEvents(input, Object.keys(BOMB_KIND), ['X', 'Y'], [])) ?? [])
    .map(e => ({ tick: num(e.tick), kind: BOMB_KIND[evName(e)], id: sid(pick(e, 'user_steamid')), x: num(pick(e, 'user_X', 'user_x')), y: num(pick(e, 'user_Y', 'user_y')) }))
    .filter(e => e.kind && Number.isFinite(e.tick)).sort((a, b) => a.tick - b.tick);

  const names = {};
  const out = rounds.map((r, idx) => {
    const tOf = tick => (tick - r.start) / TICKRATE;
    const inRound = tick => tick >= r.start && tick <= r.end;
    const frames = { t: [], players: {} };
    const byTick = new Map();
    for (const row of ticks) {
      const tick = num(row.tick);
      if (!inRound(tick)) continue;
      if (!byTick.has(tick)) byTick.set(tick, []);
      byTick.get(tick).push(row);
    }
    const tickList = [...byTick.keys()].sort((a, b) => a - b);
    tickList.forEach((tick, k) => {
      frames.t.push(tOf(tick));
      for (const row of byTick.get(tick)) {
        const id = sid(pick(row, 'steamid', 'player_steamid'));
        const s = side(num(row.team_num));
        if (!id || !s) continue;
        names[id] = String(pick(row, 'name', 'player_name') ?? id);
        const p = (frames.players[id] ??= { side: s, x: [], y: [], z: [], yaw: [], hp: [], alive: [] });
        // pad if this player was missing from earlier samples
        while (p.x.length < k) { p.x.push(p.x.at(-1) ?? num(row.X)); p.y.push(p.y.at(-1) ?? num(row.Y)); p.z.push(p.z.at(-1) ?? num(row.Z)); p.yaw.push(p.yaw.at(-1) ?? 0); p.hp.push(p.hp.at(-1) ?? 100); p.alive.push(p.alive.at(-1) ?? 1); }
        p.x.push(round1(num(row.X))); p.y.push(round1(num(row.Y))); p.z.push(round1(num(row.Z)));
        p.yaw.push(round1(num(row.yaw))); p.hp.push(num(row.health)); p.alive.push(row.is_alive === false || num(row.health) <= 0 ? 0 : 1);
      }
    });
    const kills = deaths.filter(d => inRound(num(d.tick))).map(d => ({
      t: tOf(num(d.tick)),
      attacker: sid(pick(d, 'attacker_steamid')), victim: sid(pick(d, 'user_steamid', 'victim_steamid')),
      weapon: String(pick(d, 'weapon') ?? ''), headshot: !!pick(d, 'headshot'),
      x: num(pick(d, 'user_X', 'user_x')), y: num(pick(d, 'user_Y', 'user_y')),
      ax: num(pick(d, 'attacker_X', 'attacker_x')), ay: num(pick(d, 'attacker_Y', 'attacker_y')),
    }));
    const util = nades.filter(n => inRound(num(n.tick))).map(n => ({
      t: tOf(num(n.tick)),
      type: { flashbang_detonate: 'flash', hegrenade_detonate: 'he', smokegrenade_detonate: 'smoke', inferno_startburn: 'molotov' }[evName(n)],
      thrower: sid(pick(n, 'user_steamid', 'player_steamid')),
      x: num(pick(n, 'x', 'X')), y: num(pick(n, 'y', 'Y')),
      ...throwOf(n, flights, nadeEnds, tOf),
    })).filter(u => u.type && Number.isFinite(u.x));
    const shots = shotsAll.filter(w => inRound(num(w.tick))).map(w => ({ t: round2(tOf(num(w.tick))), id: sid(pick(w, 'user_steamid')) }));
    const hits = gunHurts.filter(h => inRound(num(h.tick))).map(h => ({
      t: round2(tOf(num(h.tick))), attacker: sid(pick(h, 'attacker_steamid')), victim: sid(pick(h, 'user_steamid')),
      dmg: num(pick(h, 'dmg_health')) || 0, head: pick(h, 'hitgroup') === 'head',
    }));
    const nadeDamage = hurts.filter(h => inRound(num(h.tick))).map(h => ({
      t: tOf(num(h.tick)), attacker: sid(pick(h, 'attacker_steamid')), victim: sid(pick(h, 'user_steamid')),
      dmg: num(pick(h, 'dmg_health')) || 0, weapon: /hegrenade/.test(String(h.weapon)) ? 'he' : 'molotov',
    }));
    const blind = blinds.filter(b => inRound(num(b.tick))).map(b => ({
      t: tOf(num(b.tick)),
      victim: sid(pick(b, 'user_steamid')), attacker: sid(pick(b, 'attacker_steamid')),
      dur: num(pick(b, 'blind_duration')),
    }));
    const plant = plants.find(inRound);
    const roundEcon = {};
    for (const id of Object.keys(frames.players)) {
      const e = econ.get(`${econTicks[idx]}|${id}`);
      if (!e) continue;
      const weapons = Array.isArray(e.weapons) ? e.weapons.map(String) : e.active ? [String(e.active)] : [];
      roundEcon[id] = {
        money: Number.isFinite(num(e.money)) ? num(e.money) : null,
        equip: Number.isFinite(num(e.equip)) ? num(e.equip) : null,
        armor: Number.isFinite(num(e.armor)) ? num(e.armor) : 0,
        helmet: !!e.helmet, defuser: !!e.defuser, weapons,
      };
    }
    // the bomb at the start (who has it after freeze time; the inventory a few seconds in confirms it), then
    // everything that happens to it
    const inRoundBomb = bombEvents.filter(e => inRound(e.tick));
    const before = bombEvents.filter(e => e.tick < r.start).at(-1);
    const holder = Object.keys(roundEcon).find(id => roundEcon[id].weapons.some(w => /c4/i.test(w)));
    const start = holder && !inRoundBomb.some(e => e.tick <= econTicks[idx]) ? { kind: 'carry', id: holder, x: NaN, y: NaN }
      : before && (before.kind === 'carry' || before.kind === 'drop') ? before : null;
    const bomb = [...(start ? [{ ...start, tick: r.start }] : []), ...inRoundBomb]
      .map(e => ({ t: round2(tOf(e.tick)), kind: e.kind, id: e.id, x: round1(e.x), y: round1(e.y) }));
    return {
      n: idx + 1, winner: r.winner, reason: r.reason, duration: tOf(r.end),
      plant: plant !== undefined ? tOf(plant) : null,
      frames, kills, util, blind, econ: roundEcon, nadeDamage, shots, hits, bomb,
    };
  });
  // Premier / competitive rating of every player, read once early in the match (rank type 11 = Premier)
  const ranks = {};
  const rankRows = rounds.length ? safe(() => p.parseTicks(input, ['rank', 'comp_rank_type', 'comp_wins'], [rounds[0].start + 64])) ?? [] : [];
  for (const row of rankRows) {
    const id = sid(pick(row, 'steamid', 'player_steamid'));
    const rating = num(row.rank);
    if (id && Number.isFinite(rating) && rating > 0) ranks[id] = { rating, type: num(row.comp_rank_type) === 11 ? 'premier' : 'competitive', wins: num(row.comp_wins) || 0 };
  }
  return { map, tickrate: TICKRATE, names, ranks, rounds: out.filter(r => r.frames.t.length > 4) };
}

const PROJECTILE = { CSmokeGrenadeProjectile: 'smoke', CFlashbangProjectile: 'flash', CHEGrenadeProjectile: 'he', CMolotovProjectile: 'molotov' };

/** Every thrown grenade's flight: one entry per throw (entity ids get reused, so split on gaps). */
function grenadeFlights(p, input) {
  const rows = p.parseGrenades(input) ?? [];
  const open = new Map();
  const out = [];
  for (const r of rows) {
    const type = PROJECTILE[r.grenade_type];
    if (!type || r.x == null) continue;
    const key = r.grenade_entity_id;
    let f = open.get(key);
    const tick = num(r.tick);
    if (!f || f.type !== type || tick - f.last > 8 || sid(r.steamid) !== f.thrower) {
      f = { type, thrower: sid(r.steamid), start: tick, last: tick, pts: [] };
      open.set(key, f);
      out.push(f);
    }
    f.last = tick;
    f.pts.push([tick, round1(num(r.x)), round1(num(r.y))]);
  }
  return out;
}

/** Throw time, flight path and real lifetime for one detonation event. */
function throwOf(n, flights, ends, tOf) {
  const tick = num(n.tick), thrower = sid(pick(n, 'user_steamid', 'player_steamid'));
  const type = { flashbang_detonate: 'flash', hegrenade_detonate: 'he', smokegrenade_detonate: 'smoke', inferno_startburn: 'molotov' }[pick(n, 'event_name', 'eventName')];
  const x = num(pick(n, 'x', 'X')), y = num(pick(n, 'y', 'Y'));
  // the flight that ends closest to this detonation, from the same player
  let best = null, bd = Infinity;
  for (const f of flights) {
    if (f.type !== type || f.thrower !== thrower || f.start > tick || tick - f.start > 64 * 12) continue;
    const landed = f.pts.findLast(p => p[0] <= tick) ?? f.pts.at(-1);
    const d = Math.hypot(landed[1] - x, landed[2] - y) + Math.abs(Math.min(f.last, tick) - tick);
    if (d < bd) { bd = d; best = f; }
  }
  const out = {};
  if (best && bd < 400) {
    out.throwT = tOf(best.start);
    // every 4 ticks (~16 Hz) is smooth enough on a radar
    const pts = best.pts.filter((p, i) => p[0] <= tick && (i % 4 === 0));
    pts.push([tick, x, y]);
    out.path = pts.map(p => [p[1], p[2]]);
  }
  if (type === 'smoke' || type === 'molotov') {
    const endName = type === 'smoke' ? 'smokegrenade_expired' : 'inferno_expire';
    const id = pick(n, 'entityid');
    const end = ends.find(e => pick(e, 'event_name', 'eventName') === endName && num(e.tick) > tick && (id === undefined || pick(e, 'entityid') === id)
      && Math.hypot(num(e.x) - x, num(e.y) - y) < 50);
    if (end) out.end = tOf(num(end.tick));
  }
  return out;
}

function safe(fn) { try { return fn(); } catch { return null; } }
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;

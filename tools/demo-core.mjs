// Turns a CS2 .dem into compact per-round data for the review screen.
// Runs in the Vite dev server (Node) — the parser is a native module.
// Parser-agnostic: `p` provides parseHeader / parseEvent / parseEvents / parseTicks / parseGrenades, each taking the
// demo (`input`: a file path for the native parser, bytes for the browser build) as its first argument.
// tools/demo.mjs passes the native parser (desktop app, server); src/ui/demoWorker.ts the WebAssembly build (website).

/**
 * Bump when this reads demos differently (new fields), so saved reads are redone: by the learn tools
 * (<folder>/.stratboard-parsed), the site (demos read from your replays folder, kept in the browser) and the server.
 * 6: gear over the round (inventory, armour, kit, money once a second); 7: grenade flight paths, bounces, kill flags
 */
export const PARSE_V = 7;

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
  // micro detail at the same samples (read on its own, so a parser build without one of these can't break the
  // positions): aim pitch, walking / crouching / scoped / in the air / spotted by the enemy, weapon in hand, ammo
  const MICRO_PROPS = ['pitch', 'is_walking', 'ducking', 'is_scoped', 'is_airborne', 'spotted', 'active_weapon_name', 'active_weapon_ammo'];
  const microRows = wanted.length ? safe(() => p.parseTicks(input, MICRO_PROPS, wanted)) ?? [] : [];
  const micro = new Map();
  for (const row of microRows) micro.set(`${num(row.tick)}|${sid(pick(row, 'steamid', 'player_steamid'))}`, row);

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

  // gear over the round, once a second: inventory (guns, grenades, knife, bomb), armour, helmet, kit, money
  const gearTicks = wanted.filter((_, i) => i % 4 === 0);
  const gearRows = gearTicks.length ? safe(() => p.parseTicks(input, ['inventory', 'armor_value', 'has_helmet', 'has_defuser', 'balance'], gearTicks)) ?? [] : [];
  const gearAt = new Map(); // tick -> rows
  for (const row of gearRows) { const t = num(row.tick); if (!gearAt.has(t)) gearAt.set(t, []); gearAt.get(t).push(row); }

  const deaths = p.parseEvent(input, 'player_death', ['X', 'Y', 'team_num'], []) ?? [];
  // fights: both players' position and aim at 16 samples a second for the 3 s before every kill (spotting, reaction
  // time, crosshair placement, shooting while moving)
  const FIGHT_STEP = Math.max(1, Math.round(TICKRATE / 16)), FIGHT_SPAN = 3 * TICKRATE;
  const fightTicks = new Set();
  for (const d of deaths) {
    const a = sid(pick(d, 'attacker_steamid')), v = sid(pick(d, 'user_steamid', 'victim_steamid'));
    if (!a || !v || a === v) continue;
    const k = num(d.tick);
    for (let t = k - FIGHT_SPAN; t <= k; t += FIGHT_STEP) fightTicks.add(Math.max(0, t));
  }
  const fightRows = fightTicks.size ? safe(() => p.parseTicks(input, ['X', 'Y', 'Z', 'yaw', 'pitch'], [...fightTicks].sort((a, b) => a - b))) ?? [] : [];
  const fightAt = new Map(); // `${tick}|${steamid}` -> row
  for (const row of fightRows) fightAt.set(`${num(row.tick)}|${sid(pick(row, 'steamid', 'player_steamid'))}`, row);
  let blinds = safe(() => p.parseEvent(input, 'player_blind', ['team_num'], [])) ?? [];
  // tournament (GOTV broadcast) demos, e.g. HLTV's, leave player_blind out: rebuild it from each player's flash
  // duration just before and just after every flashbang goes off (a jump = flashed by its thrower, for that long)
  if (!blinds.length) {
    const pops = safe(() => p.parseEvent(input, 'flashbang_detonate', [], [])) ?? [];
    const at = pops.flatMap(e => [num(e.tick) - 1, num(e.tick) + 4]);
    const rows = at.length ? safe(() => p.parseTicks(input, ['flash_duration'], [...new Set(at)].sort((a, b) => a - b))) ?? [] : [];
    const dur = new Map(); // `${tick}|${steamid}` -> seconds
    for (const r of rows) dur.set(`${num(r.tick)}|${sid(pick(r, 'steamid', 'player_steamid'))}`, num(r.flash_duration) || 0);
    blinds = pops.flatMap(e => {
      const t = num(e.tick), by = sid(pick(e, 'user_steamid'));
      return rows.filter(r => num(r.tick) === t + 4).flatMap(r => {
        const id = sid(pick(r, 'steamid', 'player_steamid'));
        const after = dur.get(`${t + 4}|${id}`) ?? 0, before = dur.get(`${t - 1}|${id}`) ?? 0;
        return after > 0.3 && after > before + 0.05 ? [{ tick: t, user_steamid: id, attacker_steamid: by, blind_duration: +after.toFixed(2) }] : [];
      });
    });
  }
  const nades = safe(() => p.parseEvents(input, ['flashbang_detonate', 'hegrenade_detonate', 'smokegrenade_detonate', 'inferno_startburn'])) ?? [];
  const nadeEnds = safe(() => p.parseEvents(input, ['smokegrenade_expired', 'inferno_expire'])) ?? [];
  const flights = safe(() => grenadeFlights(p, input)) ?? [];
  // damage: grenades (HE / fire) for grading utility, guns for ADR and missed duels
  const allHurts = safe(() => p.parseEvent(input, 'player_hurt', [], [])) ?? [];
  const hurts = allHurts.filter(h => /hegrenade|inferno|molotov|incgrenade/.test(String(pick(h, 'weapon') ?? '')));
  const gunHurts = allHurts.filter(h => !/hegrenade|inferno|molotov|incgrenade|world|knife|bayonet/.test(String(pick(h, 'weapon') ?? '')));
  // every gun shot (one event per bullet; grenades, knife, bomb and taser excluded)
  const firesAll = safe(() => p.parseEvent(input, 'weapon_fire', ['X', 'Y'], [])) ?? [];
  const shotsAllRaw = firesAll.filter(w => !/grenade|flashbang|molotov|incgrenade|decoy|knife|bayonet|c4|taser/.test(String(pick(w, 'weapon') ?? '')));
  // each shot's shooter speed (from their position 4 ticks earlier: counter-strafing) and stance
  const shotTicks = new Set();
  for (const w of shotsAllRaw) { const t = num(w.tick); shotTicks.add(t); shotTicks.add(Math.max(0, t - 4)); }
  const shotRows = shotTicks.size ? safe(() => p.parseTicks(input, ['X', 'Y', 'is_walking', 'ducking', 'is_scoped', 'is_airborne', 'active_weapon_ammo'], [...shotTicks].sort((a, b) => a - b))) ?? [] : [];
  const shotAt = new Map();
  for (const row of shotRows) shotAt.set(`${num(row.tick)}|${sid(pick(row, 'steamid', 'player_steamid'))}`, row);
  const shotsAll = shotsAllRaw.map(w => {
    const t = num(w.tick), id = sid(pick(w, 'user_steamid'));
    const now = shotAt.get(`${t}|${id}`), before = shotAt.get(`${Math.max(0, t - 4)}|${id}`);
    if (!now) return w;
    const spd = before ? Math.round(Math.hypot(num(now.X) - num(before.X), num(now.Y) - num(before.Y)) / (4 / TICKRATE)) : undefined;
    // the AWP unscopes the moment it fires: "scoped" is read from just before the shot
    return { ...w, _spd: spd, _fl: microFlags(now) | (before?.is_scoped ? 4 : 0), _w: weaponShort(pick(w, 'weapon')) };
  });
  // grenade throws (weapon_fire fires on release): when and where each was thrown, for builds without flight paths
  const NADE_WEAPON = { weapon_smokegrenade: 'smoke', weapon_flashbang: 'flash', weapon_hegrenade: 'he', weapon_molotov: 'molotov', weapon_incgrenade: 'molotov' };
  const throws = firesAll.filter(w => NADE_WEAPON[String(pick(w, 'weapon'))]).map(w => ({
    tick: num(w.tick), type: NADE_WEAPON[String(pick(w, 'weapon'))], thrower: sid(pick(w, 'user_steamid')),
    x: num(pick(w, 'user_X', 'user_x')), y: num(pick(w, 'user_Y', 'user_y')),
  }));
  const plants = roundEvents.filter(e => evName(e) === 'bomb_planted').map(e => num(e.tick));
  // where the bomb is: who picks it up, where it's dropped / planted, defused or blown up (positions are the player's)
  const BOMB_KIND = { bomb_pickup: 'carry', bomb_dropped: 'drop', bomb_planted: 'plant', bomb_defused: 'defuse', bomb_exploded: 'explode' };
  const bombEvents = (safe(() => p.parseEvents(input, Object.keys(BOMB_KIND), ['X', 'Y'], [])) ?? [])
    .map(e => ({ tick: num(e.tick), kind: BOMB_KIND[evName(e)], id: sid(pick(e, 'user_steamid')), x: num(pick(e, 'user_X', 'user_x')), y: num(pick(e, 'user_Y', 'user_y')) }))
    .filter(e => e.kind && Number.isFinite(e.tick)).sort((a, b) => a.tick - b.tick);
  // planting and defusing, start to finish (or let go), for the HUD's timers: [start tick, end tick, done, kit]
  const tryEvents = (safe(() => p.parseEvents(input, ['bomb_beginplant', 'bomb_abortplant', 'bomb_begindefuse', 'bomb_abortdefuse'], [], [])) ?? [])
    .map(e => ({ tick: num(e.tick), name: evName(e), id: sid(pick(e, 'user_steamid')), kit: !!pick(e, 'haskit') }))
    .filter(e => Number.isFinite(e.tick)).sort((a, b) => a.tick - b.tick);
  const bombTries = tryEvents.filter(e => /begin/.test(e.name)).map(b => {
    const kind = /plant/.test(b.name) ? 'plant' : 'defuse';
    // it ends when it's let go, finished, or the same player starts again (demos often leave the abort out); never
    // longer than it takes (3.2 s to plant, 10 s to defuse), so a lost end can't run on
    const max = b.tick + (kind === 'plant' ? 4 : 11) * TICKRATE;
    const abort = tryEvents.find(e => e.tick > b.tick && e.id === b.id && e.name === `bomb_abort${kind}`);
    const again = tryEvents.find(e => e.tick > b.tick && e.id === b.id && e.name === `bomb_begin${kind}`);
    const done = bombEvents.find(e => e.tick >= b.tick && e.tick <= max && e.id === b.id && e.kind === kind);
    const end = [abort?.tick, again?.tick, done?.tick].filter(t => Number.isFinite(t) && t <= max).sort((x, y) => x - y)[0];
    return { tick: b.tick, end, kind, id: b.id, done: !!done && done.tick === end, kit: b.kit };
  }).filter(x => Number.isFinite(x.end));

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
        const hasMicro = microRows.length > 0;
        const p = (frames.players[id] ??= { side: s, x: [], y: [], z: [], yaw: [], hp: [], alive: [], ...(hasMicro ? { pitch: [], fl: [], w: [], am: [] } : {}) });
        // pad if this player was missing from earlier samples
        while (p.x.length < k) {
          p.x.push(p.x.at(-1) ?? num(row.X)); p.y.push(p.y.at(-1) ?? num(row.Y)); p.z.push(p.z.at(-1) ?? num(row.Z)); p.yaw.push(p.yaw.at(-1) ?? 0); p.hp.push(p.hp.at(-1) ?? 100); p.alive.push(p.alive.at(-1) ?? 1);
          if (p.pitch) { p.pitch.push(p.pitch.at(-1) ?? 0); p.fl.push(p.fl.at(-1) ?? 0); p.w.push(p.w.at(-1) ?? ''); p.am.push(p.am.at(-1) ?? 0); }
        }
        p.x.push(round1(num(row.X))); p.y.push(round1(num(row.Y))); p.z.push(round1(num(row.Z)));
        p.yaw.push(round1(num(row.yaw))); p.hp.push(num(row.health)); p.alive.push(row.is_alive === false || num(row.health) <= 0 ? 0 : 1);
        if (p.pitch) {
          const m = micro.get(`${tick}|${id}`) ?? {};
          p.pitch.push(round1(num(m.pitch) || 0));
          p.fl.push(microFlags(m));
          p.w.push(weaponShort(m.active_weapon_name));
          p.am.push(Number.isFinite(num(m.active_weapon_ammo)) ? num(m.active_weapon_ammo) : -1);
        }
      }
    });
    const kills = deaths.filter(d => inRound(num(d.tick))).map(d => ({
      t: tOf(num(d.tick)),
      attacker: sid(pick(d, 'attacker_steamid')), victim: sid(pick(d, 'user_steamid', 'victim_steamid')),
      weapon: String(pick(d, 'weapon') ?? ''), headshot: !!pick(d, 'headshot'),
      x: num(pick(d, 'user_X', 'user_x')), y: num(pick(d, 'user_Y', 'user_y')),
      ax: num(pick(d, 'attacker_X', 'attacker_x')), ay: num(pick(d, 'attacker_Y', 'attacker_y')),
      ...killFlags(d),
    }));
    const fights = deaths.filter(d => inRound(num(d.tick))).map(d => {
      const a = sid(pick(d, 'attacker_steamid')), v = sid(pick(d, 'user_steamid', 'victim_steamid'));
      if (!a || !v || a === v || !fightRows.length) return null;
      const k = num(d.tick), track = id => {
        const out = { x: [], y: [], z: [], yaw: [], pitch: [] };
        for (let t = k - FIGHT_SPAN; t <= k; t += FIGHT_STEP) {
          const row = fightAt.get(`${Math.max(0, t)}|${id}`);
          out.x.push(row ? round1(num(row.X)) : NaN); out.y.push(row ? round1(num(row.Y)) : NaN); out.z.push(row ? round1(num(row.Z)) : NaN);
          out.yaw.push(row ? round1(num(row.yaw)) : NaN); out.pitch.push(row ? round1(num(row.pitch)) : NaN);
        }
        return out;
      };
      return { t0: round2(tOf(k - FIGHT_SPAN)), dt: FIGHT_STEP / TICKRATE, attacker: a, victim: v, a: track(a), v: track(v) };
    }).filter(Boolean);
    const util = nades.filter(n => inRound(num(n.tick))).map(n => ({
      t: tOf(num(n.tick)),
      type: { flashbang_detonate: 'flash', hegrenade_detonate: 'he', smokegrenade_detonate: 'smoke', inferno_startburn: 'molotov' }[evName(n)],
      thrower: sid(pick(n, 'user_steamid', 'player_steamid')),
      x: num(pick(n, 'x', 'X')), y: num(pick(n, 'y', 'Y')),
      ...throwOf(n, flights, nadeEnds, tOf, throws),
    })).filter(u => u.type && Number.isFinite(u.x));
    const shots = shotsAll.filter(w => inRound(num(w.tick))).map(w => ({
      t: round2(tOf(num(w.tick))), id: sid(pick(w, 'user_steamid')),
      ...(w._spd !== undefined ? { spd: w._spd } : {}), ...(w._fl !== undefined ? { fl: w._fl, w: w._w } : {}),
    }));
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
    const tries = bombTries.filter(b => inRound(b.tick))
      .map(b => ({ t: round2(tOf(b.tick)), end: round2(tOf(b.end)), kind: b.kind, id: b.id, done: b.done, ...(b.kind === 'defuse' ? { kit: b.kit } : {}) }));
    // each player's gear, only when it changes: [t, inventory, armour, helmet, kit, money]
    const gear = {};
    if (gearRows.length)
      for (const tick of gearTicks) {
        if (!inRound(tick)) continue;
        for (const row of gearAt.get(tick) ?? []) {
          const id = sid(pick(row, 'steamid', 'player_steamid'));
          if (!id || !frames.players[id]) continue;
          const inv = Array.isArray(row.inventory) ? row.inventory.map(String) : [];
          const g = [round2(tOf(tick)), inv, num(row.armor_value) || 0, row.has_helmet ? 1 : 0, row.has_defuser ? 1 : 0, Number.isFinite(num(row.balance)) ? num(row.balance) : -1];
          const list = (gear[id] ??= []), last = list.at(-1);
          if (!last || last[1].join('|') !== inv.join('|') || last[2] !== g[2] || last[3] !== g[3] || last[4] !== g[4] || last[5] !== g[5]) list.push(g);
        }
      }
    return {
      n: idx + 1, winner: r.winner, reason: r.reason, duration: tOf(r.end),
      plant: plant !== undefined ? tOf(plant) : null,
      frames, kills, util, blind, econ: roundEcon, nadeDamage, shots, hits, bomb, fights,
      ...(tries.length ? { bombTries: tries } : {}),
      ...(Object.keys(gear).length ? { gear } : {}),
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
    f.pts.push([tick, round1(num(r.x)), round1(num(r.y)), round1(num(r.z))]);
  }
  return out;
}

/** Throw time, flight path and real lifetime for one detonation event. */
function throwOf(n, flights, ends, tOf, throws) {
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
    pts.push([tick, x, y, round1(num(pick(n, 'z', 'Z')))]);
    // x, y and the height (world z): the board draws the high part of a throw (over a wall or a box) as "in the air"
    out.path = pts.map(p => (Number.isFinite(p[3]) ? [p[1], p[2], p[3]] : [p[1], p[2]]));
    const b = bouncesOf(best.pts.filter(p => p[0] <= tick));
    if (b.length) out.bounces = b.map(([t, x, y, wall]) => [x, y, round2(tOf(t)), wall]);
  } else {
    // no flight data (browser build): the same player's last throw of this grenade before it went off
    const th = throws.findLast(w => w.type === type && w.thrower === thrower && w.tick <= tick && tick - w.tick < 64 * 12);
    if (th) { out.throwT = tOf(th.tick); if (Number.isFinite(th.x)) out.from = [round1(th.x), round1(th.y)]; }
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

/**
 * Where a grenade hit something on its way: [tick, x, y, 1 = a wall / 0 = the floor or a roof]. In the air only
 * gravity changes its velocity (320 units/s², 0.08 a tick at 64 ticks); a bigger jump between two ticks is a hit.
 * `pts` are [tick, x, y, z], one per tick. Rolling slowly (under 1.5 units a tick) and stopping dead don't count.
 */
export function bouncesOf(pts) {
  const G = 320 / TICKRATE / TICKRATE, out = [];
  let last = -Infinity;
  for (let i = 2; i < pts.length; i++) {
    const [t0, x0, y0, z0] = pts[i - 2], [t1, x1, y1, z1] = pts[i - 1], [t2, x2, y2, z2] = pts[i];
    if (t1 - t0 !== 1 || t2 - t1 !== 1 || ![z0, z1, z2].every(Number.isFinite)) continue;
    const v1 = [x1 - x0, y1 - y0, z1 - z0], v2 = [x2 - x1, y2 - y1, z2 - z1];
    const speed = Math.hypot(...v1);
    if (speed < 1.5 || Math.hypot(...v2) < 0.5) continue; // a dead stop is the landing, not a bounce
    const dh = Math.hypot(v2[0] - v1[0], v2[1] - v1[1]), dz = Math.abs(v2[2] - v1[2] + G);
    if (Math.hypot(dh, dz) < Math.max(1.2, speed * 0.15) || t1 - last <= 3) continue;
    out.push([t1, x1, y1, dh > dz ? 1 : 0]);
    last = t1;
  }
  return out;
}

/** What made a kill special, from player_death: walls shot through, through a smoke, shooter blind / in the air / AWP unscoped, the assist. */
function killFlags(d) {
  const out = {};
  const wall = num(pick(d, 'penetrated'));
  if (wall > 0) out.wall = wall;
  if (pick(d, 'thrusmoke')) out.smoke = true;
  if (pick(d, 'attackerblind')) out.blind = true;
  if (pick(d, 'noscope')) out.noscope = true;
  if (pick(d, 'attackerinair')) out.air = true;
  const assist = sid(pick(d, 'assister_steamid'));
  if (assist && assist !== '0') { out.assist = assist; if (pick(d, 'assistedflash')) out.flashAssist = true; }
  const dist = num(pick(d, 'distance'));
  if (Number.isFinite(dist) && dist > 0) out.dist = Math.round(dist);
  return out;
}

function safe(fn) { try { return fn(); } catch { return null; } }
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;

/** Stance bits: 1 walking (silent), 2 crouching, 4 scoped, 8 in the air, 16 spotted by the enemy (on their radar). */
function microFlags(m) {
  return (m.is_walking ? 1 : 0) | (m.ducking ? 2 : 0) | (m.is_scoped ? 4 : 0) | (m.is_airborne ? 8 : 0) | (m.spotted ? 16 : 0);
}
/** "AK-47" / "weapon_ak47" → "ak47". */
function weaponShort(name) {
  return String(name ?? '').toLowerCase().replace(/^weapon_/, '').replace(/[^a-z0-9]/g, '');
}

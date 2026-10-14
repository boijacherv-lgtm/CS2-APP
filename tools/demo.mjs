// Turns a CS2 .dem into compact per-round data for the review screen.
// Runs in the Vite dev server (Node) — the parser is a native module.
import { parseEvent, parseEvents, parseHeader, parseTicks } from '@laihoe/demoparser2';

const TICKRATE = 64;
const SAMPLE_EVERY = 16; // ticks → 0.25 s
const side = n => (n === 3 || n === '3' ? 'CT' : n === 2 || n === '2' ? 'T' : null);
const num = v => (typeof v === 'number' ? v : v == null ? NaN : Number(v));
const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const sid = v => (v == null ? '' : String(v));

export function parseDemo(path) {
  const header = parseHeader(path) ?? {};
  const map = String(pick(header, 'map_name', 'mapName') ?? 'unknown');

  const roundEvents = parseEvents(path, ['round_freeze_end', 'round_end', 'bomb_planted', 'bomb_defused', 'bomb_exploded']) ?? [];
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
    ? parseTicks(path, ['X', 'Y', 'Z', 'yaw', 'health', 'is_alive', 'team_num'], wanted) ?? []
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
      const rows = econTicks.length ? safe(() => parseTicks(path, [prop], econTicks)) : null;
      if (!rows?.length) continue;
      for (const row of rows) {
        const k = `${num(row.tick)}|${sid(pick(row, 'steamid', 'player_steamid'))}`;
        const e = econ.get(k) ?? {};
        if (e[key] === undefined) e[key] = row[prop];
        econ.set(k, e);
      }
      break; // first candidate that works
    }

  const deaths = parseEvent(path, 'player_death', ['X', 'Y', 'team_num'], []) ?? [];
  const blinds = safe(() => parseEvent(path, 'player_blind', ['team_num'], [])) ?? [];
  const nades = safe(() => parseEvents(path, ['flashbang_detonate', 'hegrenade_detonate', 'smokegrenade_detonate', 'inferno_startburn'])) ?? [];
  const plants = roundEvents.filter(e => evName(e) === 'bomb_planted').map(e => num(e.tick));

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
    })).filter(u => u.type && Number.isFinite(u.x));
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
    return {
      n: idx + 1, winner: r.winner, reason: r.reason, duration: tOf(r.end),
      plant: plant !== undefined ? tOf(plant) : null,
      frames, kills, util, blind, econ: roundEcon,
    };
  });
  return { map, tickrate: TICKRATE, names, rounds: out.filter(r => r.frames.t.length > 4) };
}

function safe(fn) { try { return fn(); } catch { return null; } }
const round1 = v => Math.round(v * 10) / 10;

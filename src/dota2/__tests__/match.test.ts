import { describe, expect, it } from 'vitest';
import { BUILDINGS, cellToMap, mins, roshanOnMap } from '../data';
import { coachMatch } from '../coach';
import type { ReplayHero } from '../replay/parser';
import { buildingUp, clashes, deadAt, laneResults, lastKnown, matchFromOpenDota, seriesAt, teamKillsAt, type RawMatch } from '../match';

const player = (slot: number, hero: number, extra: object = {}) => ({
  player_slot: slot < 5 ? slot : 128 + slot - 5, isRadiant: slot < 5, hero_id: hero, kills: 0, deaths: 0, assists: 0, last_hits: 0, denies: 0, level: 1, gold_per_min: 300, xp_per_min: 300, ...extra,
});
// Anti-Mage (1) in the bottom lane against Axe (2), who kills them twice; the second death is in a 1 against 3 fight
const raw: RawMatch = {
  match_id: 1, duration: 1800, radiant_win: false, start_time: 0, version: 22,
  players: [
    player(0, 1, { lane: 1, networth_t: Array.from({ length: 31 }, (_, i) => i * 200), lh_t: Array(31).fill(30), dn_t: Array(31).fill(1), obs_log: [{ time: 100, key: '[100,100]', x: 100, y: 100 }], obs_left_log: [{ time: 200, key: '[100,100]' }],
      deaths_log: [{ time: 300, key: 'npc_dota_hero_axe', time_dead: 20, gold_lost: 100, gold_fed: 200 }, { time: 900, key: 'npc_dota_hero_axe', time_dead: 40, gold_lost: 800, gold_fed: 900 }] }),
    player(1, 5), player(2, 6), player(3, 7), player(4, 8),
    player(5, 2, { lane: 1, networth_t: Array.from({ length: 31 }, (_, i) => i * 400), lh_t: Array(31).fill(60), dn_t: Array(31).fill(5) }), player(6, 9), player(7, 10), player(8, 11), player(9, 12),
  ],
  objectives: [
    { time: 920, type: 'building_kill', key: 'npc_dota_goodguys_tower1_bot' },
    { time: 1000, type: 'building_kill', key: 'npc_dota_goodguys_tower4' },
    { time: 1010, type: 'building_kill', key: 'npc_dota_goodguys_tower4' },
    { time: 1100, type: 'CHAT_MESSAGE_ROSHAN_KILL', team: 3 },
  ],
  teamfights: [{ start: 890, end: 910, players: Array.from({ length: 10 }, (_, i) => (
    i === 0 ? { damage: 100, deaths_pos: { 100: { 100: 1 } } } : i >= 5 && i <= 7 ? { damage: 300 } : {}
  )) }],
};

describe('Dota 2 match', () => {
  const m = matchFromOpenDota(raw);
  it('reads deaths with their killer, and a position when a teamfight logged one', () => {
    expect(m.deaths.map(d => [d.t, d.killer])).toEqual([[300, 5], [900, 5]]);
    expect(m.deaths[0].at).toBeNull();
    expect(m.deaths[1].at).toEqual(cellToMap(100, 100));
    expect(teamKillsAt(m, 1, 1000)).toBe(2);
    expect(deadAt(m, 0, 310)?.t).toBe(300);
    expect(deadAt(m, 0, 330)).toBeNull();
  });
  it('tells the two tier-4 towers apart, and the ancient falls at the end', () => {
    const t4 = BUILDINGS.filter(b => b.key === 'npc_dota_goodguys_tower4');
    expect(t4.length).toBe(2);
    expect(t4.every(b => !buildingUp(m, b.uid, 1500))).toBe(true);
    expect(buildingUp(m, t4[1].uid, 1005)).toBe(true);
    expect(buildingUp(m, '0_fort', 1799)).toBe(true);
    expect(buildingUp(m, '0_fort', 1800)).toBe(false);
  });
  it('ends a ward when the log says it died', () => {
    expect(m.wards[0]).toMatchObject({ kind: 'obs', t: 100, until: 200 });
  });
  it('moves Roshan into each lair as each map draws it, and stays put on an exact one', () => {
    const top = cellToMap(103, 146.7), bottom = cellToMap(150.3, 106.4);
    expect(roshanOnMap('simple', top).x).toBeGreaterThan(top.x);
    expect(roshanOnMap('simple', top).y).toBeGreaterThan(top.y);
    expect(roshanOnMap('game', bottom)).toEqual(bottom);
    const between = roshanOnMap('simple', cellToMap(126.65, 123));
    expect(between.x - cellToMap(126.65, 123).x).toBeLessThan(roshanOnMap('simple', top).x - top.x);
  });
  it('names every building as the logs do', () => {
    expect(BUILDINGS.length).toBe(36);
    expect(BUILDINGS.find(b => b.uid === '1_tower1_bot')!.key).toBe('npc_dota_badguys_tower1_bot');
    expect(BUILDINGS.find(b => b.uid === '0_melee_rax_top')!.key).toBe('npc_dota_goodguys_melee_rax_top');
    expect(BUILDINGS.find(b => b.uid === '0_melee_rax_top')!.name).toBe('top melee barracks');
    expect(BUILDINGS.find(b => b.uid === '0_tower4#2')!.name).toBe('T4');
  });
  it('keeps one last known place per hero: ward, then death, then fountain after respawn', () => {
    const fountain = lastKnown(m, 0, 0).at;
    expect(lastKnown(m, 0, 150).at).toEqual(cellToMap(100, 100));
    expect(lastKnown(m, 0, 150).age).toBe(50);
    expect(lastKnown(m, 0, 905)).toMatchObject({ at: cellToMap(100, 100), dead: true });
    expect(lastKnown(m, 0, 950).at).toEqual(fountain);
    expect(lastKnown(m, 1, 1000).at).toEqual(fountain);
  });
  it('calls a lane at 10:00: won only by a clear margin', () => {
    const [bottom] = laneResults(m);
    expect(bottom).toMatchObject({ lane: 1, radiant: 2000, dire: 4000, winner: 1 });
    const even = matchFromOpenDota({ ...raw, players: raw.players.map((p, i) => (i === 5 ? { ...p, networth_t: Array.from({ length: 31 }, (_, j) => j * 205) } : p)) });
    expect(laneResults(even)[0].winner).toBeNull();
  });
  it('keeps the draft in order, and the skill order', () => {
    const d = matchFromOpenDota({ ...raw, picks_bans: [{ is_pick: true, hero_id: 2, team: 1, order: 1 }, { is_pick: false, hero_id: 9, team: 0, order: 0 }], players: raw.players.map((p, i) => (i === 0 ? { ...p, ability_upgrades_arr: [5004, 5005] } : p)) });
    expect(d.draft).toEqual([{ hero: 9, team: 0, pick: false }, { hero: 2, team: 1, pick: true }]);
    expect(d.players[0].upgrades).toEqual([5004, 5005]);
  });
  it('collects what the whole map hears about, in order', () => {
    const named = matchFromOpenDota({ ...raw, players: raw.players.map((p, i) => (i === 0 ? { ...p, runes_log: [{ time: 240, key: '5' }] } : p)) });
    expect(named.events[0]).toEqual({ t: 240, kind: 'rune', slot: 0, rune: 5 });
    expect(named.events.find(e => e.kind === 'roshan')).toEqual({ t: 1100, kind: 'roshan', team: 1 });
    expect(named.events.filter(e => e.kind === 'building').length).toBe(4);
  });
  it('reads series between the minutes and clock times before the horn', () => {
    expect(seriesAt([0, 60], 30)).toBe(30);
    expect(mins(-46)).toBe('−0:46');
    expect(mins(125)).toBe('2:05');
  });
});

describe('Dota 2 coach', () => {
  const m = matchFromOpenDota(raw);
  const moves = coachMatch(m);
  it('calls a death with nobody else dying around it picked off', () => {
    const d = moves.find(x => x.kind === 'death' && x.t === 300)!;
    expect(d.tags).toContain('PICKED OFF');
    expect(d.note).toBe('?!');
  });
  it('does not call a death picked off when others died around it, even with no fight logged', () => {
    const withMate = { ...raw, teamfights: [], players: raw.players.map((p, i) => (i === 1 ? { ...p, deaths_log: [{ time: 310, key: 'npc_dota_hero_axe' }] } : p)) };
    const d = coachMatch(matchFromOpenDota(withMate)).find(x => x.kind === 'death' && x.t === 300)!;
    expect(d.tags).not.toContain('PICKED OFF');
  });
  it('finds fights from the deaths themselves, with the gold on each side', () => {
    const three = { ...raw, players: raw.players.map((p, i) => (i === 1 || i === 2 ? { ...p, deaths_log: [{ time: 305 + i, key: 'npc_dota_hero_axe', gold_lost: 10, gold_fed: 100 }] } : p)) };
    const [c] = clashes(matchFromOpenDota(three));
    expect(c).toMatchObject({ start: 300, lost: { 0: 3, 1: 0 } });
    expect(c.gold[1]).toBe(400);
    expect(c.gold[0]).toBe(-120);
  });
  it('counts who was in the fight, the gold, and the tower that fell after', () => {
    const d = moves.find(x => x.kind === 'death' && x.t === 900)!;
    expect(d.tags).toEqual(expect.arrayContaining(['OUTNUMBERED', 'EXPENSIVE', 'COST OBJECTIVE']));
    expect(d.note).toBe('??');
  });
  it('compares the lane at 10:00 with the enemy in it', () => {
    const lost = moves.find(x => x.kind === 'laning' && x.slot === 0)!, won = moves.find(x => x.kind === 'laning' && x.slot === 5)!;
    expect(lost.tags).toContain('LANE LOST');
    expect(lost.note).toBe('?');
    expect(won.note).toBe('!!');
  });
  it('names the hero on every card, trims a long nick and ignores one with no letters', () => {
    const named = { ...raw, players: raw.players.map((p, i) => (i === 0 ? { ...p, personaname: '1-0ps9JIq2m8TWI3pyoBMY6aBV' } : i === 5 ? { ...p, personaname: '/' } : p)) };
    const d = coachMatch(matchFromOpenDota(named)).find(x => x.kind === 'death' && x.t === 300)!;
    expect(d.title).toBe('Anti-Mage (1-0ps9JIq2m8T…) died to Axe at 5:00');
  });
  it('with the replay, counts who really stood near and what was ready to use', () => {
    const still = (heroId: number, team: number, x: number, y: number): ReplayHero => ({ heroId, team, x: [x, x], y: [y, y], hp: [100, 100], items: heroId === 1 ? [{ t: 0, slots: ['item_black_king_bar', 'item_blink'] }] : [], skills: [], itemCasts: heroId === 1 ? { item_blink: [{ t: 290, until: 305 }] } : {}, levels: [], mana: [], manaFrom: 0 });
    // Anti-Mage at (100,100): a teammate next to them, Axe next to them, everyone else far away
    const tracks = { times: [0, 2000], unitTimes: [], units: [], heroes: [still(1, 2, 100, 100), still(5, 2, 102, 100), still(2, 3, 101, 100), ...[6, 7, 8].map(h => still(h, 2, 170, 170)), ...[9, 10, 11, 12].map(h => still(h, 3, 70, 70))] };
    const d = coachMatch(m, tracks).find(x => x.kind === 'death' && x.t === 300)!;
    expect(d.tags).not.toContain('PICKED OFF');
    expect(d.tags).toContain('SAVE UNUSED');
    expect(d.why.join(' ')).toContain('Black King Bar was ready');
    expect(d.why.join(' ')).not.toContain('Blink');
    const alone = { ...tracks, heroes: tracks.heroes.map(h => (h.heroId === 5 ? still(5, 2, 170, 170) : h)) };
    expect(coachMatch(m, alone).find(x => x.kind === 'death' && x.t === 300)!.tags).toContain('PICKED OFF');
  });
  it('has nothing to grade on a match without a parse', () => {
    expect(coachMatch(matchFromOpenDota({ ...raw, version: null, od_data: { has_parsed: false } }))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { BUILDINGS, CAMP_REACH, CAMPS, cellToMap, heroOf, isNight, mins, nextDawnOrDusk, roshanOnMap, TREES, visionShape } from '../data';
import { LETTERS } from '../../engine/recap';
import { speedAt } from '../coach';
import { fightLetter, gradeMatch, laneLetter, letterOfScore, matchScore, supportScore } from '../grades';
import { assignPositions, autoPick, bestPair, counterEdge, countersOf, POSITION_INFO, synergy, type HeroPairs } from '../draft';
import { letterOfStanding, supportNumbers, supportsOf } from '../support';
import { talentPicks } from '../D2Talents';
import ABILITIES from '../generated/abilities.json';
import CHAT_WHEEL from '../generated/chatwheel.json';
import TALENTS from '../generated/talents.json';
import { campsNow } from '../tracks';
import { bestWards, placeOf } from '../wardSpots';
import { coachMatch } from '../coach';
import type { ReplayHero } from '../replay/parser';
import { buildingUp, clashes, deadAt, keyFacts, laneResults, lastKnown, matchFromOpenDota, seriesAt, teamKillsAt, type RawMatch } from '../match';

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
  it('counts neutrals into the camp they stand in, and leaves out those pulled away', () => {
    const neutral = (x: number, y: number) => ({ kind: 'neutral' as const, team: 4, at: { x, y } });
    const c = CAMPS[10];
    const { counts, strays } = campsNow([neutral(c.x, c.y), neutral(c.x + CAMP_REACH / 2, c.y), neutral(0.5, 0.5), { kind: 'creep', team: 2, at: c }]);
    expect(counts[10]).toBe(2);
    expect(counts.reduce((a, b) => a + b)).toBe(2);
    expect(strays).toHaveLength(1);
  });
  it('turns day and night every five minutes, starting with day', () => {
    expect([-30, 0, 299, 300, 599, 600].map(isNight)).toEqual([false, false, false, true, true, false]);
    expect(nextDawnOrDusk(-30)).toBe(300);
    expect(nextDawnOrDusk(300)).toBe(600);
  });
  it('cuts a ward\'s vision at the trees in its way', () => {
    const at = { x: 0.5, y: 0.5 };
    const clear = visionShape(at, 0.1, []);
    expect(clear.open).toBeCloseTo(1);
    const shaded = visionShape(at, 0.1, [{ x: 0.55, y: 0.5 }]);
    expect(shaded.open).toBeLessThan(1);
    expect(shaded.points[0]).toBeCloseTo(0.55); // the ray going right stops at the tree
    expect(shaded.points[90]).toBeCloseTo(0.4); // the ray going left doesn't
    expect(visionShape(at, 0.1, [{ x: 0.5, y: 0.5 }]).open).toBeCloseTo(1); // standing in it isn't blocked
  });
  it('gives each side its own best ward spots, named and at most eight', () => {
    const radiant = bestWards(0, 0, 'obs'), dire = bestWards(1, 0, 'obs');
    expect(radiant.length).toBeGreaterThan(0);
    expect(radiant.length).toBeLessThanOrEqual(8);
    expect(radiant.map(s => s.at)).not.toEqual(dire.map(s => s.at));
    for (const s of radiant) { expect(s.place).toMatch(/^By | of /); expect(s.open).toBeGreaterThan(0); expect(s.open).toBeLessThanOrEqual(1); }
    expect(placeOf(cellToMap(103, 146.7))).toBe('By Top Roshan lair');
    expect(placeOf(cellToMap(103, 151))).toBe('North of Top Roshan lair');
  });
  // four heroes, every pair even except: 1 and 2 win together, 3 beats 4
  const pairsData: HeroPairs = {
    matches: 1000, days: 1, ids: [1, 2, 3, 4], roles: [['Carry'], ['Support'], ['Support'], ['Durable']],
    games: [1000, 1000, 1000, 1000], wins: [500, 500, 500, 500],
    // pairs in order: 1-2, 1-3, 1-4, 2-3, 2-4, 3-4
    withGames: [500, 500, 500, 500, 500, 500], withWins: [400, 250, 250, 250, 250, 250],
    vsGames: [500, 500, 500, 500, 500, 500], vsWins: [250, 250, 250, 250, 250, 400],
  };
  it('finds the heroes who win together and the heroes who beat each other', () => {
    expect(synergy(pairsData, 1, 2)).toBeGreaterThan(0.2);
    expect(synergy(pairsData, 2, 1)).toBeCloseTo(synergy(pairsData, 1, 2));
    expect(synergy(pairsData, 1, 3)).toBeCloseTo(0);
    expect(counterEdge(pairsData, 3, 4)).toBeGreaterThan(0.2);
    expect(counterEdge(pairsData, 4, 3)).toBeCloseTo(-counterEdge(pairsData, 3, 4));
    expect(countersOf(pairsData, 4, 1).beatIt[0].hero).toBe(3);
    expect(countersOf(pairsData, 3, 1).itBeats[0].hero).toBe(4);
    expect(bestPair(pairsData, [1, 2, 3])).toMatchObject({ a: 1, b: 2 });
  });
  it('doesn\'t call a pair of weak heroes good for losing as much as expected in a few games', () => {
    const weak: HeroPairs = { ...pairsData, wins: [300, 300, 500, 500], withGames: [15, 500, 500, 500, 500, 500], withWins: [4, 250, 250, 250, 250, 250] };
    expect(synergy(weak, 1, 2)).toBeLessThan(0.02);
  });
  it('auto-picks what goes with the team and against the enemy, never someone taken', () => {
    expect(autoPick(pairsData, [1], [])[0]).toBe(2);
    expect(autoPick(pairsData, [], [4])[0]).toBe(3);
    const rest = autoPick(pairsData, [1], [4]);
    expect(rest).not.toContain(1);
    expect(rest).not.toContain(4);
    expect(new Set(rest).size).toBe(rest.length);
    expect(autoPick(pairsData, [1, 2, 3, 4], [])).toEqual([]);
    expect(autoPick(pairsData, [], [], () => 0)).toHaveLength(4);
  });
  it('gives each hero a position of their own, the one their tags suit', () => {
    const five: HeroPairs = { ...pairsData, ids: [1, 2, 3, 4, 5], roles: [['Support', 'Disabler'], ['Carry'], ['Durable', 'Initiator'], ['Nuker', 'Escape'], ['Support', 'Nuker']] };
    const plan = assignPositions(five, [1, 2, 3, 4, 5]);
    expect(plan.map(p => p.position)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.map(p => p.hero)).toEqual([2, 4, 3, 5, 1]);
    expect(POSITION_INFO[1].lane(0)).toBe(1);
    expect(POSITION_INFO[1].lane(1)).toBe(3);
    expect(assignPositions(five, [])).toEqual([]);
  });
  it('slows to 1× around a graded moment, and only if asked', () => {
    const moves = [{ t: 100 }];
    expect(speedAt(moves, 99, 16, true)).toBe(1);
    expect(speedAt(moves, 104, 16, true)).toBe(1);
    expect(speedAt(moves, 90, 16, true)).toBe(16);
    expect(speedAt(moves, 110, 16, true)).toBe(16);
    expect(speedAt(moves, 100, 16, false)).toBe(16);
    expect(speedAt(moves, 100, 1, true)).toBe(1);
  });
  it('finds the talents in a skill order, and the hero level each came by', () => {
    const [id, talent] = Object.entries(ABILITIES).find(([, a]) => a.talent)!, [skill] = Object.entries(ABILITIES).find(([, a]) => !a.talent)!;
    const order = [...Array<number>(9).fill(Number(skill)), Number(id)];
    expect(talentPicks(order).get(talent.key)).toBe(10);
    expect(talentPicks([...Array<number>(17).fill(Number(skill)), Number(id)]).get(talent.key)).toBe(20);
    expect(talentPicks([Number(skill)]).size).toBe(0);
  });
  it('knows every hero\'s eight talents, numbers filled in', () => {
    const trees = Object.values(TALENTS) as [string, string][][];
    expect(trees.length).toBeGreaterThan(100);
    expect(trees.every(t => t.length === 8)).toBe(true);
    expect(trees.flat().filter(([, text]) => text.includes('{s:')).length).toBe(0);
  });
  it('reads the chat: who said what and when, wheel phrases in words, nothing wordless', () => {
    const m = matchFromOpenDota({ ...raw, chat: [
      { time: 90, type: 'chatwheel', key: '75', slot: 5, player_slot: 128 },
      { time: 30, type: 'chat', key: ' gl hf ', slot: 0, player_slot: 0 },
      { time: 40, type: 'chatwheel', key: '137', slot: 1, player_slot: 1 },
      { time: 50, type: 'chat', key: 'hi', unit: 'A coach' },
      { time: 60, type: 'other', key: 'x', slot: 0, player_slot: 0 },
    ] });
    expect(m.chat).toEqual([
      { t: 30, slot: 0, who: null, text: 'gl hf', wheel: false },
      { t: 50, slot: null, who: 'A coach', text: 'hi', wheel: false },
      { t: 90, slot: 5, who: null, text: 'Good game', wheel: true },
    ]);
    expect(matchFromOpenDota(raw).chat).toEqual([]);
    expect(Object.values(CHAT_WHEEL).filter(text => /dota_|#/.test(text))).toEqual([]);
  });
  it('grades a fight: kills and clean wins on top, feeding at the bottom', () => {
    expect(fightLetter(4, 1, 0.3, false)).toBe('S+');
    expect(fightLetter(3, 0, 0.3, true)).toBe('S+');
    expect(fightLetter(3, 1, 0.3, true)).toBe('S');
    expect(fightLetter(0, 0, 0.5, true)).toBe('S');
    expect(fightLetter(2, 1, 0.2, false)).toBe('A');
    expect(fightLetter(1, 1, 0.1, false)).toBe('B');
    expect(fightLetter(0, 1, 0.25, false)).toBe('B');
    expect(fightLetter(0, 0, 0.05, false)).toBe('C');
    expect(fightLetter(0, 1, 0.1, true)).toBe('D');
    expect(fightLetter(0, 1, 0.01, false)).toBe('F');
    expect([1500, 1000, 500, 0, -400, -800, -1500].map(laneLetter)).toEqual(['S+', 'S', 'A', 'B', 'C', 'D', 'F']);
  });
  it('grades a match: every moment counted once per player, the best named', () => {
    const m = matchFromOpenDota({ ...raw, teamfights: [{ start: 100, end: 130, deaths: 1, players: raw.players.map((_, i) => ({ damage: i === 0 ? 3000 : i === 5 ? 1 : 100, healing: 0, deaths: i === 5 ? 1 : 0, gold_delta: i === 0 ? 500 : 0, killed: i === 0 ? { [heroOf(raw.players[5].hero_id).key]: 1 } : {}, ability_uses: { x: 1 } })) }] });
    const g = gradeMatch(m, coachMatch(m, null));
    const fight = g.chapters.find(c => c.kind === 'fight')!;
    expect(fight.winner).toBe(0);
    expect(fight.grades[0]!.letter).toBe('S');
    expect(fight.grades[5]!.letter).toBe('F');
    for (const p of g.players) expect(LETTERS.reduce((a, l) => a + p.counts[l], 0)).toBe(p.graded);
    expect(g.best).not.toBeNull();
  });
  it('lifts a fight a step for helping teammates', () => {
    expect(fightLetter(0, 0, 0.05, false, 2)).toBe('B');
    expect(fightLetter(0, 1, 0.1, true, 2)).toBe('C');
    expect(fightLetter(0, 1, 0.1, true, 1)).toBe('D');
    expect(fightLetter(4, 0, 0.3, true, 5)).toBe('S+');
  });
  it('reads a support\'s numbers: skills on teammates count, on themselves and on enemies don\'t', () => {
    const ally = heroOf(raw.players[1].hero_id).key, self = heroOf(raw.players[0].hero_id).key, foe = heroOf(raw.players[5].hero_id).key;
    const m = matchFromOpenDota({ ...raw, players: raw.players.map((p, i) => (i === 0 ? { ...p, stuns: 60.5, observer_kills: 2, sentry_kills: 1, camps_stacked: 3, item_uses: { glimmer_cape: 4, blink: 9 }, ability_targets: { a: { [ally]: 3, [self]: 7, [foe]: 9 } } } : p)) });
    const p = m.players[0];
    expect([p.allyCasts, p.helpItems, p.stuns, p.dewards]).toEqual([3, 4, 60.5, 3]);
    const n = supportNumbers(m, 0), minutes = m.duration / 60;
    expect(n.helpPerMin).toBeCloseTo(7 / minutes);
    expect(n.stunsPerMin).toBeCloseTo(60.5 / minutes);
    expect(supportsOf(m, 0)).toHaveLength(2);
    expect(['S+', 'S', 'A', 'B', 'C', 'D', 'F']).toEqual([0.95, 0.8, 0.7, 0.5, 0.3, 0.15, 0.05].map(letterOfStanding));
  });
  it('lets a support earn an S for doing their job, and not for doing it badly', () => {
    expect(letterOfScore(supportScore(3.6, 'A', 'A', true))).toBe('S');
    expect(letterOfScore(supportScore(4.5, 'S', 'S', true))).toBe('S+');
    expect(letterOfScore(supportScore(3.6, 'B', 'B', false))).toBe('B');
    expect(['D', 'F']).toContain(letterOfScore(supportScore(2.8, 'D', 'D', false)));
    expect(letterOfScore(supportScore(1, 'F', 'F', true))).toBe('D');
  });
  it('lifts a match grade for a great game overall, within limits', () => {
    expect(matchScore(4, 13, 8, 2, true)).toBeCloseTo(4.75);
    expect(matchScore(4, 30, 30, 0, false)).toBeCloseTo(4.6);
    expect(matchScore(2, 0, 2, 10, false)).toBeCloseTo(2.012);
    expect(letterOfScore(matchScore(1, 0, 2, 10, true))).toBe('D');
    expect([5.5, 5, 4.5, 4, 3.2, 2.5, 1].map(letterOfScore)).toEqual(['S+', 'S', 'A', 'B', 'C', 'D', 'F']);
  });
  it('keeps every camp and tree on the map', () => {
    for (const c of CAMPS) expect(Math.min(c.x, c.y, 1 - c.x, 1 - c.y)).toBeGreaterThan(0);
    expect(TREES.length).toBeGreaterThan(500);
    expect(TREES.every(([x, y]) => x >= -10 && x <= 1010 && y >= -10 && y <= 1010)).toBe(true);
  });
  it('sums a match up: where the gold swung hardest, who ended on top, Roshans per side', () => {
    const f = keyFacts(matchFromOpenDota({ ...raw, radiant_gold_adv: [0, 100, 200, 300, 400, -3000, -3100], players: raw.players.map((p, i) => (i === 3 ? { ...p, net_worth: 9000, kills: 7 } : i === 5 ? { ...p, net_worth: 12000, kills: 2 } : p)) }));
    expect(f.swing).toEqual({ t: 180, team: 1, gold: 3400 });
    expect(f.richest).toBe(5);
    expect(f.killer).toBe(3);
    expect(f.roshan).toEqual([0, 1]);
  });
  it('sums up a match with nothing to go on without inventing anything', () => {
    const f = keyFacts(matchFromOpenDota({ ...raw, objectives: [], radiant_gold_adv: null }));
    expect(f.swing).toBeNull();
    expect(f.richest).toBeNull();
    expect(f.killer).toBeNull();
    expect(f.roshan).toEqual([0, 0]);
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

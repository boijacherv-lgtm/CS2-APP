import { describe, expect, it } from 'vitest';
import { abilityById, applyGameData, applyMapLayout, BUILDINGS, CAMPS, cellToMap, heroOf, itemByKey, layoutFrom, SIGHTS, skillLook, type MapLayout } from '../data';
import { dotaDataUrl } from '../dataFeed';
import { layoutForMatch } from '../gameData';
import LAYOUTS from '../generated/mapLayouts.json';
import { talentWords } from '../talentText';

const LAYOUT_742 = (LAYOUTS as unknown as { patches: Record<string, { layout: MapLayout }> }).patches['61'].layout;
/** The fixtures a 7.42 replay gives, rebuilt from the kept layout. */
const fixtures = () => [
  ...([0, 1] as const).flatMap(team => Object.entries(LAYOUT_742.buildings[team]).map(([uid, [x, y]]) => ({
    kind: uid === 'fort' ? 'fort' : uid.includes('rax') ? 'rax' : 'tower', team, x, y,
  }))),
  ...LAYOUT_742.camps.map(([x, y, tier]) => ({ kind: 'camp', team: 0, x, y, tier })),
  ...LAYOUT_742.gates.map(([x, y]) => ({ kind: 'gate', team: 0, x, y })),
];

describe('the game as the current patch has it', () => {
  it('only lets the proxy fetch the four lists', () => {
    expect(dotaDataUrl(new URLSearchParams('path=herolist'))).toBe('https://www.dota2.com/datafeed/herolist?language=english');
    expect(dotaDataUrl(new URLSearchParams('path=herodata&hero_id=102'))).toContain('hero_id=102');
    expect(dotaDataUrl(new URLSearchParams('path=herodata&hero_id=../x'))).toBeNull();
    expect(dotaDataUrl(new URLSearchParams('path=itemdata'))).toBeNull();
  });
  it('takes in new heroes, items and skills, keeping what the new lists leave out', () => {
    applyGameData({
      heroes: [{ id: 999, key: 'npc_dota_hero_newcomer', name: 'Newcomer', icon: null }],
      items: [{ id: 9999, key: 'greater_horn', name: 'Greater Horn of Battle', cost: 0, icon: null }],
      abilities: [[99999, { key: 'newcomer_strike', name: 'Strike', talent: false }]],
    });
    expect(heroOf(999).name).toBe('Newcomer');
    expect(heroOf(1).name).toBe('Anti-Mage');
    expect(itemByKey.get('greater_horn')?.name).toBe('Greater Horn of Battle');
    expect(abilityById(99999)?.key).toBe('newcomer_strike');
    expect(skillLook('newcomer_strike', 'npc_dota_hero_newcomer').name).toBe('Strike');
  });
  it("writes a talent with its numbers, and leaves out a number nobody gives", () => {
    const t = { name: 'special_bonus_x', name_loc: '+{s:bonus_value} Strength', special_values: [{ name: 'bonus_value', values_float: [12] }] };
    expect(talentWords(t, new Map())).toBe('+12 Strength');
    expect(talentWords({ ...t, special_values: [] }, new Map([['special_bonus_x|value', 3]]))).toBe('+3 Strength');
    expect(talentWords({ ...t, name_loc: '+{s:bonus_speed} Pull Speed', special_values: [] }, new Map())).toBe('Pull Speed');
  });
  it("reads where a patch put the map's things from a replay, and moves them there", () => {
    const layout = layoutFrom(fixtures())!;
    expect(layout.buildings[0].tower1_mid).toEqual(LAYOUT_742.buildings[0].tower1_mid);
    expect(layout.camps).toHaveLength(28);
    const mid = BUILDINGS.find(b => b.uid === '0_tower1_mid')!, before = { x: mid.x, y: mid.y };
    expect(applyMapLayout(layout)).toBe(true);
    expect(mid.x).toBeCloseTo(cellToMap(...LAYOUT_742.buildings[0].tower1_mid).x);
    expect(CAMPS).toHaveLength(28);
    expect(SIGHTS.filter(s => s.kind === 'gate').map(s => s.at)).toEqual(LAYOUT_742.gates.map(([x, y]) => cellToMap(x, y)));
    expect(applyMapLayout(null)).toBe(true);
    expect({ x: mid.x, y: mid.y }).toEqual(before);
    expect(layoutFrom([])).toBeNull();
  });
  it("picks a match's map by its patch, or by when it was played", () => {
    expect(layoutForMatch({ patch: 61, startTime: 0 })).toBe(LAYOUT_742);
    expect(layoutForMatch({ patch: null, startTime: 1_900_000_000 })).toBe(LAYOUT_742);
    expect(layoutForMatch({ patch: 60, startTime: 1_780_000_000 })).toBeNull();
    expect(layoutForMatch(null)).toBe(LAYOUT_742);
  });
});

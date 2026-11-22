import { describe, expect, it } from 'vitest';
import { direction, tally, verdict } from '../../engine/patchWords';
import { buildsFrom, daysOnPatch, heroMeta, itemStages, patchChanges, rankOf, type HeroStat } from '../meta';

const stat = (id: number, picks: number, wins: number, more: Partial<HeroStat> = {}): HeroStat => ({
  id, roles: [], pro_pick: 0, pro_win: 0, pro_ban: 0, pub_pick: picks, pub_win: wins,
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap(b => [[`${b}_pick`, b === 5 ? picks : 0], [`${b}_win`, b === 5 ? wins : 0]])),
  ...more,
} as HeroStat);

describe("Dota 2's meta", () => {
  it('rates heroes at the chosen ranks, pulling few games toward even', () => {
    const rows = heroMeta([stat(1, 10_000, 5_600), stat(2, 10_000, 4_500), stat(3, 10, 9)], rankOf('high'), null);
    expect(rows[0].tier).toBe('S');
    expect(rows[1].tier).toBe('D');
    // 9 wins of 10 games isn't a 90% hero
    expect(rows[2].winRate).toBeLessThan(0.52);
    expect(rows[0].pickRate).toBeCloseTo(10_000 / ((20_010) / 10));
    expect(heroMeta([stat(1, 10_000, 5_600)], rankOf('low'), null)[0].games).toBe(0);
  });
  it('compares the days since the patch with the days before', () => {
    const now = 1_000_000_000, patch = now - 1.5 * 86400;
    expect(daysOnPatch(patch, now)).toBe(2);
    expect(daysOnPatch(now - 30 * 86400, now)).toBe(6);
    const s = stat(1, 7000, 3500, { pub_pick_trend: [1000, 1000, 1000, 1000, 1000, 1000, 1000], pub_win_trend: [450, 450, 450, 450, 450, 600, 600] });
    const [row] = heroMeta([s], rankOf('all'), patch, now);
    expect(row.since!.games).toBe(2000);
    expect(row.since!.winRate).toBeGreaterThan(row.since!.before);
  });
  it('reads patch notes into buffs and nerfs per hero, skill and item', () => {
    const changes = patchChanges({
      patch_name: '7.42', patch_timestamp: 0,
      heroes: [{ hero_id: 4, hero_notes: [{ note: 'Base movement speed increased from 285 to 290' }], abilities: [{ ability_id: 5015, ability_notes: [{ note: 'Spell Amplification decreased from 15/20/25/30% to 12/16/20/24%' }] }] }],
      items: [{ ability_id: 1, ability_notes: [{ note: 'Cooldown increased from 15s to 16s' }] }],
      general_notes: [{ title: 'Global Mechanics', generic: [{ note: '<span class="Subtitle">Hero Stats</span>' }, { note: 'Base hero Health increased from 120 to 200' }] }],
    }, id => (id === 5015 ? 'Bloodrage' : null), id => (id === 1 ? 'Blink Dagger' : null));
    expect(changes.filter(c => c.kind === 'hero').map(c => c.dir)).toEqual([1, -1]);
    expect(changes.find(c => c.ability === 'Bloodrage')?.text).toContain('Spell Amplification');
    expect(changes.find(c => c.kind === 'item')).toMatchObject({ name: 'Blink Dagger', dir: -1 });
    expect(changes.filter(c => c.kind === 'general')).toHaveLength(1);
    expect(verdict(tally(changes, 'hero').get(4)!)).toBe('mixed');
  });
  it('weighs every level of a by-level change', () => {
    // 100 in all, against 96: a little less
    expect(direction('Max Thirst Move Speed rescaled from 10/20/30/40% to 12/20/28/36%')).toBe(-1);
    expect(direction('Move Damage increased from 35/45/55% to 45/50/55%')).toBe(1);
    expect(direction('Mana Cost decreased from 80/100/120/140 to 80/95/110/125')).toBe(1);
    expect(direction('Cast Point decreased from 0.4 to 0.3')).toBe(1);
  });
  it('finds the few ways a hero is built, named by what sets them apart, in buy order', () => {
    const cost = (k: string) => ({ bfury: 4100, yasha: 2050, manta: 4650, skadi: 5300, butterfly: 4975, black_king_bar: 4050, sange: 2050, sange_and_yasha: 4100, power_treads: 1400, pers: 1400 } as Record<string, number>)[k] ?? 100;
    const game = (won: boolean, ...keys: string[]) => ({ won, at: 0, skills: [5003, 5004, 5003], buys: [{ t: -90, key: 'tango' }, { t: -90, key: 'branches' }, { t: -90, key: 'branches' }, { t: 300, key: 'power_treads' }, { t: 500, key: 'pers' }, ...keys.map((key, i) => ({ t: 800 + i * 100, key }))] });
    const games = [
      ...Array.from({ length: 6 }, (_, i) => game(i < 4, 'bfury', 'yasha', 'manta', 'skadi')),
      ...Array.from({ length: 4 }, () => game(false, 'bfury', 'yasha', 'manta', 'butterfly')),
      ...Array.from({ length: 3 }, () => game(true, 'bfury', 'sange', 'sange_and_yasha', 'black_king_bar')),
      game(true, 'bfury', 'black_king_bar'),
    ];
    const builds = buildsFrom(games, cost);
    expect(builds).toHaveLength(3);
    expect(builds[0]).toMatchObject({ games: 6, wins: 4, boots: 'power_treads', core: ['manta', 'skadi'], base: ['bfury'] });
    expect(builds[2].core).toEqual(['sange_and_yasha', 'black_king_bar']);
    // Yasha a minute before Manta is one step with it
    expect(builds[0].order.map(o => o.key)).toEqual(['power_treads', 'bfury', 'manta', 'skadi']);
    expect(builds[0].start).toEqual([{ key: 'branches', count: 2 }, { key: 'tango', count: 1 }]);
    expect(builds[0].skills).toEqual([5003, 5004, 5003]);
    // Sange bought just before it goes into Sange and Yasha is one step
    expect(builds[2].order.map(o => o.key)).not.toContain('sange');
    expect(buildsFrom(games.slice(0, 2), cost)).toEqual([]);
  });
  it("lists a hero's items by stage, most bought first", () => {
    const stages = itemStages({ start_game_items: { 1: 5, 2: 20 }, early_game_items: {}, mid_game_items: { 3: 4 }, late_game_items: {} });
    expect(stages.start.map(i => i.item)).toEqual([2, 1]);
    expect(stages.start[1].share).toBe(0.25);
    expect(stages.early).toEqual([]);
  });
});

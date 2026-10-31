// @ts-expect-error this project has no types for Node's own modules; tests run in Node
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cellToMap, itemLook, skillLook } from '../data';
import type { ReplayTracks } from '../replay/parser';
import { readReplay } from '../replay/parser';
import { bunzip2, snappy, unpackReplay } from '../replay/unpack';
import { unzstd } from '../replay/zstd';
import { heroAt, heroTrail, itemCooldownAt, itemsAt, skillsAt, unitsAt, vitalsAt } from '../tracks';

/** Data with both repeats and noise, like a real file: exercises matches, literals and every kind of table. */
function sample(size: number) {
  const out = new Uint8Array(size);
  let x = 12345;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = i % 7000 < 3000 ? 97 + (i % 13) : i % 7000 < 5000 ? (x >> 16) & 0xff : (x >> 16) & 7;
  }
  return out;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('Replay unpacking', () => {
  it('reads Zstandard at every compression level', () => {
    const data = sample(600_000);
    for (const level of [1, 3, 9, 19]) {
      const packed = zlib.zstdCompressSync(data, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });
      expect(same(unzstd(new Uint8Array(packed)), data)).toBe(true);
    }
  });
  it('reads bzip2 (made with the bzip2 tool)', () => {
    let want = '';
    for (let i = 0; i < 40000; i++) want += String.fromCharCode(97 + ((i * i) % 7)) + (i % 500 < 40 ? 'zzzzzzzzzz' : '');
    const packed = Uint8Array.from(atob('QlpoOTFBWSZTWTJAVOgAEWlBgAEAOgAAEDABGZQMAE1JU2oFJSZPAIvkHKYqgmVUsXkHKYqgnUHCxVBNAnU0CcXKq4tQVS8qrqagqloE6mgTkVixVBOwOU0qgmlUuLQJxeqqiVlKPi9TIJoExepoE0lH4sgmgT+LuSKcKEgZICp0AA=='), c => c.charCodeAt(0));
    expect(new TextDecoder().decode(bunzip2(packed))).toBe(want);
  });
  it('reads Snappy: literals and overlapping copies', () => {
    // 6 bytes: "ab" then a copy of 4 from 2 back
    expect(new TextDecoder().decode(snappy(Uint8Array.of(6, 1 << 2, 97, 98, (0 << 5) | (0 << 2) | 1, 2)))).toBe('ababab');
  });
  it('tells which compression a file has, whatever its name', () => {
    const data = sample(1000);
    expect(same(unpackReplay(new Uint8Array(zlib.zstdCompressSync(data))), data)).toBe(true);
    expect(unpackReplay(data)).toBe(data);
  });
  it('refuses what is not a replay', () => {
    expect(() => readReplay(new TextEncoder().encode('not a replay at all'))).toThrow('Not a Source 2 replay');
  });
});

describe('Hero movement', () => {
  const tracks: ReplayTracks = {
    times: [0, 1, 2, 3],
    heroes: [{ heroId: 7, team: 2, x: [100, 101, 180, 181], y: [100, 100, 180, 180], hp: [90, 80, 80, 0], items: [
      { t: -30, slots: ['item_tango*3', null] }, { t: 100, slots: ['item_tango*2', 'item_blink'] }, { t: 500, slots: [null, 'item_blink'] },
    ], skills: [
      { name: 'axe_culling_blade', levels: [{ t: -30, level: 0, hidden: false }, { t: 360, level: 1, hidden: false }], casts: [{ t: 400, until: 480 }, { t: 600, until: 610 }] },
      { name: 'axe_secret', levels: [{ t: -30, level: 1, hidden: true }], casts: [] },
    ], itemCasts: { item_blink: [{ t: 300, until: 315 }] }, levels: [{ t: -30, level: 1 }, { t: 200, level: 6 }], mana: [100, 50, 25], manaFrom: 1 }],
    unitTimes: [0, 1, 2, 3, 4],
    units: [
      { kind: 'creep', team: 2, from: 1, every: 1, x: [1000, 1010], y: [1000, 1000] },
      { kind: 'neutral', team: 4, from: 0, every: 3, x: [900, 930], y: [900, 900] },
      { kind: 'courier', team: 3, from: 0, every: 1, x: [800, 0, 810], y: [800, 0, 810] },
      { kind: 'roshan', team: 4, from: 0, every: 1, x: [1030, 1030, 1030, 1030, 1030], y: [1467, 1467, 1467, 1467, 1467], hp: [100, 90, 80, 70, 60] },
    ],
  };
  const ofKind = (t: number, kind: string) => unitsAt(tracks, t).find(u => u.kind === kind);
  it('tells what a hero carries at any moment, not only at the end', () => {
    expect(itemsAt(tracks, 7, -90)).toEqual(['item_tango*3', null]);
    expect(itemsAt(tracks, 7, 99)).toEqual(['item_tango*3', null]);
    expect(itemsAt(tracks, 7, 100)).toEqual(['item_tango*2', 'item_blink']);
    expect(itemsAt(tracks, 7, 9999)).toEqual([null, 'item_blink']);
    expect(itemsAt(tracks, 8, 100)).toBeNull();
  });
  it('shows a skill with its level, and its cooldown only while it runs; a hidden one not at all', () => {
    expect(skillsAt(tracks, 7, 100)).toEqual([{ name: 'axe_culling_blade', level: 0, cooldown: null }]);
    expect(skillsAt(tracks, 7, 380)[0].level).toBe(1);
    expect(skillsAt(tracks, 7, 440)[0].cooldown).toEqual({ left: 40, total: 80 });
    expect(skillsAt(tracks, 7, 500)[0].cooldown).toBeNull();
    expect(skillsAt(tracks, 7, 605)[0].cooldown).toEqual({ left: 5, total: 10 });
  });
  it('runs item cooldowns by the item, whatever its charges', () => {
    expect(itemCooldownAt(tracks, 7, 'item_blink', 310)).toEqual({ left: 5, total: 15 });
    expect(itemCooldownAt(tracks, 7, 'item_blink*2', 310)?.left).toBe(5);
    expect(itemCooldownAt(tracks, 7, 'item_blink', 320)).toBeNull();
    expect(itemCooldownAt(tracks, 7, 'item_tango', 310)).toBeNull();
  });
  it('knows a hero\'s level and mana at any moment', () => {
    expect(vitalsAt(tracks, 7, 50)?.level).toBe(1);
    expect(vitalsAt(tracks, 7, 250)?.level).toBe(6);
    expect(vitalsAt(tracks, 7, 0)?.mana).toBe(100);
    expect(vitalsAt(tracks, 7, 2)?.mana).toBe(50);
    expect(vitalsAt(tracks, 8, 2)).toBeNull();
  });
  it('names a skill without its hero, and finds its icon', () => {
    expect(skillLook('dark_seer_ion_shell', 'npc_dota_hero_dark_seer')).toMatchObject({ name: 'Ion Shell' });
    expect(skillLook('axe_battle_hunger', 'npc_dota_hero_axe').icon).toContain('/abilities/axe_battle_hunger.png');
  });
  it('reads a replay item: name, icon and charges, also one the shop list lacks', () => {
    expect(itemLook('item_tango*3')).toMatchObject({ key: 'tango', name: 'Tango', charges: 3 });
    expect(itemLook('item_pogo_stick')).toMatchObject({ key: 'pogo_stick', name: 'Pogo Stick', charges: 0 });
    expect(itemLook('item_pogo_stick').icon).toContain('/items/pogo_stick.png');
  });
  it('has a creep only while it lives, sliding along its way', () => {
    expect(ofKind(0.5, 'creep')).toBeUndefined();
    expect(ofKind(1.5, 'creep')!.at.x).toBeCloseTo(cellToMap(100.5, 100).x);
    expect(ofKind(3.5, 'creep')).toBeUndefined();
  });
  it('slides a neutral across its wider spaced samples', () => {
    expect(ofKind(1.5, 'neutral')!.at.x).toBeCloseTo(cellToMap(91.5, 90).x);
    expect(ofKind(3.5, 'neutral')!.at.x).toBeCloseTo(cellToMap(93, 90).x);
  });
  it('hides a courier while it is dead, and brings it back', () => {
    expect(ofKind(0.5, 'courier')).toBeDefined();
    expect(ofKind(1.5, 'courier')).toBeUndefined();
    expect(ofKind(2.5, 'courier')!.at.x).toBeCloseTo(cellToMap(81, 81).x);
  });
  it('knows how hurt Roshan is', () => {
    expect(ofKind(2.1, 'roshan')!.hp).toBe(80);
  });
  it('slides between samples', () => {
    expect(heroAt(tracks, 7, 0.5)!.at.x).toBeCloseTo(cellToMap(100.5, 100).x);
    expect(heroAt(tracks, 7, 0.5)!.hp).toBe(90);
  });
  it('rounds a corner instead of turning on the spot', () => {
    const corner: ReplayTracks = { times: [0, 1, 2], heroes: [{ heroId: 1, team: 2, x: [100, 101, 101], y: [100, 100, 101], hp: [100, 100, 100], items: [], skills: [], itemCasts: {}, levels: [], mana: [], manaFrom: 0 }], unitTimes: [], units: [] };
    const at = heroAt(corner, 1, 1)!.at, sharp = cellToMap(101, 100);
    expect(at.x).toBeLessThan(sharp.x);
    expect(at.y).toBeLessThan(sharp.y);
  });
  it('jumps across a teleport instead of sliding over the map', () => {
    expect(heroAt(tracks, 7, 1.5)!.at).toEqual(cellToMap(101, 100));
    expect(heroAt(tracks, 7, 2)!.at.x).toBeCloseTo(cellToMap(180, 180).x, 2);
  });
  it('holds at both ends of the match, and knows nothing of other heroes', () => {
    expect(heroAt(tracks, 7, -50)!.at).toEqual(cellToMap(100, 100));
    expect(heroAt(tracks, 7, 99)!.at).toEqual(cellToMap(181, 180));
    expect(heroAt(tracks, 8, 1)).toBeNull();
  });
  it('draws a way back only as far as the last teleport or death', () => {
    expect(heroTrail(tracks, 7, 2, 20).length).toBe(1);
    expect(heroTrail(tracks, 7, 3, 20)).toEqual([]);
  });
});

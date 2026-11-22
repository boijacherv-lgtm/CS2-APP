/**
 * The game's own data, read live so a patch shows the day it comes out: heroes, skills and talents from Valve's
 * datafeed (through our proxy: Valve doesn't let web pages read it), items with their costs from OpenDota. Kept in
 * this browser and asked again every few hours, or as soon as Valve lists a newer patch. Until then, and if all of
 * that fails, the lists built into the site stand in.
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { API_URL, ONLINE } from '../env';
import { getItem, setItem } from '../ui/localStore';
import { applyGameData, applyMapLayout, layoutFrom, type D2Ability, type D2Hero, type D2Item, type MapLayout } from './data';
import LAYOUT_DATA from './generated/mapLayouts.json';
import type { ReplayTracks } from './replay/parser';
import { bonusesIn, talentWords, type ValveTalent } from './talentText';

const KEY = 'd2game1', HERO_KEY = (patch: string, id: number) => `d2herodata3:${patch}:${id}`;
/** How long the lists are trusted before Valve is asked whether there's a newer patch. */
const FRESH = 3 * 3600_000;
const ICONS = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';

/** Valve's datafeed on the proxy: the dev server here, the Worker on the website (none: the bundled lists stay). */
export function valveUrl(path: 'herolist' | 'abilitylist' | 'patchnoteslist' | 'herodata' | 'patchnotes', heroId?: number, version?: string): string | null {
  const q = `path=${path}${heroId !== undefined ? `&hero_id=${heroId}` : ''}${version ? `&version=${version}` : ''}`;
  if (!ONLINE) return `/api/dota-data?${q}`;
  return API_URL ? `${API_URL}/dota-data?${q}` : null;
}
export async function json<T>(url: string | null): Promise<T> {
  if (!url) throw new Error('No way to reach the game data here.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Game data: ${res.status}`);
  return res.json() as Promise<T>;
}

interface Saved { patch: string; at: number; heroes: D2Hero[]; items: D2Item[]; abilities: [number, D2Ability][] }
export type GameDataState = { patch: string | null; status: 'bundled' | 'loading' | 'live' | 'failed'; version: number };
/** Which game data the site shows, and a number that changes whenever new data was put in place (for re-rendering). */
export const useGameData = create<GameDataState>(() => ({ patch: null, status: 'bundled', version: 0 }));
const put = (saved: Saved) => {
  applyGameData(saved);
  useGameData.setState(s => ({ patch: saved.patch, status: 'live', version: s.version + 1 }));
};

/** The newest patch Valve lists, by its name ("7.42"). */
async function latestPatch(): Promise<string> {
  const { patches } = await json<{ patches: { patch_number: string; patch_timestamp: number }[] }>(valveUrl('patchnoteslist'));
  return [...patches].sort((a, b) => b.patch_timestamp - a.patch_timestamp)[0]?.patch_number ?? 'unknown';
}

type ValveEntry = { id: number; name: string; name_loc: string; name_english_loc?: string };
async function fetchAll(patch: string): Promise<Saved> {
  const [heroList, abilityList, itemList] = await Promise.all([
    json<{ result: { data: { heroes: ValveEntry[] } } }>(valveUrl('herolist')),
    json<{ result: { data: { itemabilities: ValveEntry[] } } }>(valveUrl('abilitylist')),
    json<Record<string, { id: number; dname?: string; cost?: number | null; img?: string }>>('https://api.opendota.com/api/constants/items'),
  ]);
  const heroes = heroList.result.data.heroes.map((h): D2Hero => {
    const short = h.name.replace('npc_dota_hero_', '');
    return { id: h.id, key: h.name, name: h.name_english_loc || h.name_loc, icon: `${ICONS}/heroes/icons/${short}.png` };
  });
  // a talent's own name has codes for its numbers ("+{s:value} Strength"): without its hero's data, the words alone
  const plain = (s: string) => s.replace(/[+-]?\{s:[^}]+\}%?s? ?/g, '').replace(/\s+/g, ' ').trim();
  const abilities = abilityList.result.data.itemabilities.filter(a => a.id > 0 && !a.name.startsWith('item_') && a.name_loc)
    .map((a): [number, D2Ability] => [a.id, { key: a.name, name: plain(a.name_english_loc || a.name_loc), talent: a.name.startsWith('special_bonus_') }]);
  const items = Object.entries(itemList).filter(([key, i]) => i.dname && !key.startsWith('recipe_'))
    .map(([key, i]): D2Item => ({ id: i.id, key, name: i.dname!, cost: i.cost ?? 0, icon: `${ICONS}/items/${key}.png` }));
  return { patch, at: Date.now(), heroes, items, abilities };
}

let started: Promise<void> | null = null;
/** Puts the newest game data in place: what this browser kept at once, then Valve's when that's old or a patch came out. */
export function loadGameData(): Promise<void> {
  return (started ??= (async () => {
    const saved = await getItem<Saved>(KEY);
    if (saved?.heroes?.length) put(saved);
    if (saved && Date.now() - saved.at < FRESH) return;
    useGameData.setState({ status: saved ? 'live' : 'loading' });
    try {
      const patch = await latestPatch();
      if (saved && saved.patch === patch) { await setItem(KEY, { ...saved, at: Date.now() }); return; }
      const fresh = await fetchAll(patch);
      put(fresh);
      await setItem(KEY, fresh);
    } catch {
      useGameData.setState({ status: saved ? 'live' : 'failed' });
    }
  })());
}

/** One hero as this patch has them: talents (lowest level first, two to a level, with their numbers) and skills' words. */
export interface HeroData {
  talents: [string, string][];
  skills: Record<string, { name: string; desc: string }>;
  stats: { health: number; healthRegen: number; mana: number; armor: number; speed: number; range: number; damage: [number, number] };
}
type ValveSkill = { name: string; name_loc: string; desc_loc: string; special_values?: { name: string; values_float: number[] }[] };
type ValveHero = {
  abilities: ValveSkill[]; talents: ValveTalent[]; max_health: number; health_regen: number; max_mana: number;
  armor: number; movement_speed: number; attack_range: number; damage_min: number; damage_max: number;
};
const heroes = new Map<number, HeroData>(), asked = new Map<number, Promise<HeroData | null>>();
/** A skill's words as plain text: %name% is one of its numbers (by level: 30/40/50), and %%% a percent sign after one. */
const clean = (skill: ValveSkill) => skill.desc_loc.replace(/<[^>]+>/g, ' ')
  .replace(/%([a-z_0-9]+)%(%%)?/gi, (_, key: string, pct?: string) => {
    const v = skill.special_values?.find(x => x.name === key)?.values_float;
    return v?.length ? [...new Set(v.map(n => Math.round(n * 100) / 100))].join('/') + (pct ? '%' : '') : '';
  })
  .replace(/%%/g, '%').replace(/\s+/g, ' ').trim();

/** A hero's data, from this browser when this patch's was kept, else from Valve; null when it can't be had. */
export function heroData(id: number): Promise<HeroData | null> {
  if (!asked.has(id)) asked.set(id, (async () => {
    await loadGameData();
    const patch = useGameData.getState().patch ?? 'bundled', key = HERO_KEY(patch, id);
    try {
      const kept = await getItem<HeroData>(key);
      const data = kept ?? await (async () => {
        const raw = await json<{ result: { data: { heroes: ValveHero[] } } }>(valveUrl('herodata', id));
        const h = raw.result.data.heroes[0];
        if (!h) return null;
        const bonuses = bonusesIn(h);
        const out: HeroData = {
          talents: h.talents.map(t => [t.name, talentWords(t, bonuses)]),
          skills: Object.fromEntries(h.abilities.filter(a => a.name_loc).map(a => [a.name, { name: a.name_loc, desc: clean(a) }])),
          stats: {
            health: h.max_health, healthRegen: h.health_regen, mana: h.max_mana, armor: h.armor,
            speed: h.movement_speed, range: h.attack_range, damage: [h.damage_min, h.damage_max],
          },
        };
        await setItem(key, out);
        return out;
      })();
      if (data) { heroes.set(id, data); useGameData.setState(s => ({ version: s.version + 1 })); }
      return data;
    } catch {
      asked.delete(id);
      return null;
    }
  })());
  return asked.get(id)!;
}
/** What's known of a hero right now, without asking (null: not loaded yet). */
export const heroDataNow = (id: number): HeroData | null => heroes.get(id) ?? null;

/** A hero's data for a component: asked for once, and re-rendered when it arrives. */
export function useHeroData(id: number | null | undefined): HeroData | null {
  useGameData(s => s.version);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (id) void heroData(id).then(d => { if (d) setTick(t => t + 1); });
  }, [id]);
  return id ? heroDataNow(id) : null;
}

/** For a page: starts reading the game's data, and re-renders the page when new data is in place. */
export function useLiveGameData(): GameDataState {
  useEffect(() => { void loadGameData(); }, []);
  return useGameData();
}

/** The map as each patch laid it out (tools/dota-layout.ts), for matches whose replay can't be read for it. */
const LAYOUTS = (LAYOUT_DATA as unknown as { patches: Record<string, { name: string; from: number; layout: MapLayout }> }).patches;
/** The layout of the patch a match was played on (null: the one the site was built with, 7.41 or older). */
export function layoutForMatch(match: { patch?: number | null; startTime: number } | null): MapLayout | null {
  const known = Object.entries(LAYOUTS).sort((a, b) => b[1].from - a[1].from);
  if (!match) return known[0]?.[1].layout ?? null;
  if (match.patch != null && LAYOUTS[match.patch]) return LAYOUTS[match.patch].layout;
  return known.find(([, p]) => p.from <= match.startTime)?.[1].layout ?? null;
}
/**
 * Puts the map's buildings, camps, gates and rune spots where they were in this match: from its replay when it's been
 * read (any patch, even one newer than the site), else as its patch had them. Without a match: the newest patch's map.
 */
export function useMapLayout(match: { patch?: number | null; startTime: number } | null, tracks: ReplayTracks | null) {
  const layout = useMemo(() => (tracks?.fixtures?.length && layoutFrom(tracks.fixtures)) || layoutForMatch(match), [match, tracks]);
  useEffect(() => {
    if (applyMapLayout(layout)) useGameData.setState(s => ({ version: s.version + 1 }));
  }, [layout]);
}

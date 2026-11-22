/**
 * Dota 2's meta, for Meta & builds: every hero's win, pick and ban rates at the chosen ranks (OpenDota's hero stats,
 * the last week of public and pro matches), how each has done since the newest patch against before it (OpenDota's
 * day-by-day counts), the patch notes read into buffs and nerfs (Valve's own notes), and what a hero's players buy
 * at each stage of the match (OpenDota's item popularity).
 */
import { direction, type PatchChange } from '../engine/patchWords';
import { json, valveUrl } from './gameData';

const API = 'https://api.opendota.com/api';

/** OpenDota's ranks are numbered 1 (Herald) to 8 (Immortal). */
export interface RankBand { id: string; label: string; brackets: number[] | 'pro' }
export const RANKS: RankBand[] = [
  { id: 'all', label: 'All ranks', brackets: [1, 2, 3, 4, 5, 6, 7, 8] },
  { id: 'low', label: 'Herald – Guardian', brackets: [1, 2] },
  { id: 'mid', label: 'Crusader – Archon', brackets: [3, 4] },
  { id: 'high', label: 'Legend – Ancient', brackets: [5, 6] },
  { id: 'top', label: 'Divine – Immortal', brackets: [7, 8] },
  { id: 'pro', label: 'Pro matches', brackets: 'pro' },
];
export const rankOf = (id: string) => RANKS.find(r => r.id === id) ?? RANKS[0];

export type HeroStat = {
  id: number; roles: string[]; pro_pick: number; pro_win: number; pro_ban: number;
  pub_pick: number; pub_win: number; pub_pick_trend?: number[]; pub_win_trend?: number[];
} & Record<`${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}_${'pick' | 'win'}`, number>;

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';
export interface HeroMeta {
  hero: number; games: number; winRate: number; pickRate: number;
  /** Bans: only pro matches say. */
  banRate: number | null; proPicks: number; proBans: number; tier: Tier;
  /** Since the patch (public matches, all ranks): its win rate and games, and before it. */
  since?: { winRate: number; games: number; before: number };
}

/** Games of an even record mixed into a hero's own: a few games can't put a hero at the top. */
const PULL = 400;
const shrink = (wins: number, games: number) => (wins + PULL / 2) / (games + PULL);
export const tierOf = (winRate: number): Tier => (winRate >= 0.525 ? 'S' : winRate >= 0.51 ? 'A' : winRate >= 0.49 ? 'B' : winRate >= 0.475 ? 'C' : 'D');

/** The days at the end of OpenDota's day-by-day counts that are on the patch (none: it's older than they go back). */
export function daysOnPatch(patchFrom: number, now: number, days = 7): number {
  return Math.max(0, Math.min(days - 1, Math.ceil((now - patchFrom) / 86400)));
}

/** Every hero at these ranks: games, rates, tier, and how they've done since the patch. */
export function heroMeta(stats: HeroStat[], band: RankBand, patchFrom: number | null, now = Date.now() / 1000): HeroMeta[] {
  const pick = (s: HeroStat) => (band.brackets === 'pro' ? s.pro_pick : band.brackets.reduce((a, b) => a + (s[`${b as 1}_pick`] ?? 0), 0));
  const win = (s: HeroStat) => (band.brackets === 'pro' ? s.pro_win : band.brackets.reduce((a, b) => a + (s[`${b as 1}_win`] ?? 0), 0));
  // ten heroes to a match
  const matches = stats.reduce((a, s) => a + pick(s), 0) / 10 || 1;
  const proMatches = stats.reduce((a, s) => a + s.pro_pick, 0) / 10 || 1;
  const days = patchFrom ? daysOnPatch(patchFrom, now) : 0;
  return stats.map(s => {
    const games = pick(s), winRate = shrink(win(s), games);
    const row: HeroMeta = {
      hero: s.id, games, winRate, pickRate: games / matches, banRate: s.pro_ban ? s.pro_ban / proMatches : null,
      proPicks: s.pro_pick, proBans: s.pro_ban, tier: tierOf(winRate),
    };
    const picks = s.pub_pick_trend ?? [], wins = s.pub_win_trend ?? [];
    if (days && picks.length > days) {
      const sum = (l: number[], from: number, to: number) => l.slice(from, to).reduce((a, v) => a + v, 0);
      const n = picks.length, nowGames = sum(picks, n - days, n), beforeGames = sum(picks, 0, n - days);
      if (nowGames && beforeGames) row.since = { winRate: shrink(sum(wins, n - days, n), nowGames), games: nowGames, before: shrink(sum(wins, 0, n - days), beforeGames) };
    }
    return row;
  });
}

// ---- patch notes ----------------------------------------------------------------------------------------------------

export interface PatchInfo { name: string; at: number }
type Note = { note: string; info?: string };
export type RawNotes = {
  patch_name: string; patch_timestamp: number;
  general_notes?: { title?: string; generic?: Note[] }[];
  items?: { ability_id: number; ability_notes?: Note[] }[];
  neutral_items?: { ability_id: number; ability_notes?: Note[] }[];
  heroes?: { hero_id: number; hero_notes?: Note[]; talent_notes?: Note[]; abilities?: { ability_id: number; ability_notes?: Note[] }[] }[];
};
/** Plain text from a note (they carry a little HTML for headings). */
const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** One patch's notes as changes to heroes (with the skill they're about), items and the game, each a buff, nerf or neither. */
export function patchChanges(notes: RawNotes, skillName: (id: number) => string | null, itemName: (id: number) => string | null): PatchChange[] {
  const out: PatchChange[] = [];
  const add = (kind: PatchChange['kind'], id: number | null, name: string, ability: string | null, list: Note[] | undefined) => {
    for (const n of list ?? []) {
      const text = plain(n.note);
      // a heading inside the notes ("Hero Stats"), not a change
      if (!text || /class="Subtitle"/.test(n.note)) continue;
      out.push({ kind, id, name, ability, text, dir: kind === 'general' ? 0 : direction(text) });
    }
  };
  for (const h of notes.heroes ?? []) {
    add('hero', h.hero_id, '', null, h.hero_notes);
    add('hero', h.hero_id, '', 'Talents', h.talent_notes);
    for (const a of h.abilities ?? []) add('hero', h.hero_id, '', skillName(a.ability_id), a.ability_notes);
  }
  for (const i of [...(notes.items ?? []), ...(notes.neutral_items ?? [])]) if (i.ability_id > 0) add('item', i.ability_id, itemName(i.ability_id) ?? '', null, i.ability_notes);
  for (const g of notes.general_notes ?? []) add('general', null, g.title ?? 'General', g.title ?? null, g.generic);
  return out;
}

/** The newest patches Valve lists, newest first (letter patches too: 7.41a). */
export async function patchList(count = 8): Promise<PatchInfo[]> {
  const { patches } = await json<{ patches: { patch_number: string; patch_timestamp: number }[] }>(valveUrl('patchnoteslist'));
  return [...patches].sort((a, b) => b.patch_timestamp - a.patch_timestamp).slice(0, count).map(p => ({ name: p.patch_number, at: p.patch_timestamp }));
}
const notesKept = new Map<string, Promise<RawNotes>>();
export function patchNotes(name: string): Promise<RawNotes> {
  if (!notesKept.has(name)) notesKept.set(name, json<RawNotes>(valveUrl('patchnotes', undefined, name)).catch(e => { notesKept.delete(name); throw e; }));
  return notesKept.get(name)!;
}

let statsKept: Promise<HeroStat[]> | null = null;
/** OpenDota's hero stats, asked once a visit. */
export function heroStats(): Promise<HeroStat[]> {
  return (statsKept ??= fetch(`${API}/heroStats`).then(r => (r.ok ? r.json() as Promise<HeroStat[]> : Promise.reject(new Error(`OpenDota: ${r.status}`))))
    .catch(e => { statsKept = null; throw e; }));
}

// ---- builds -------------------------------------------------------------------------------------------------------

export type Stage = 'start' | 'early' | 'mid' | 'late';
export const STAGES: { id: Stage; label: string; when: string }[] = [
  { id: 'start', label: 'Starting items', when: 'before the horn' },
  { id: 'early', label: 'Early game', when: 'laning, to about 10:00' },
  { id: 'mid', label: 'Mid game', when: 'about 10:00 to 25:00' },
  { id: 'late', label: 'Late game', when: 'after about 25:00' },
];
type Popularity = Record<`${Stage}_game_items`, Record<string, number>>;
/** What a hero's players buy at each stage, most bought first, with each item's share of the stage's most bought. */
export async function heroItems(hero: number): Promise<Record<Stage, { item: number; count: number; share: number }[]>> {
  const r = await fetch(`${API}/heroes/${hero}/itemPopularity`);
  if (!r.ok) throw new Error(`OpenDota: ${r.status}`);
  return itemStages(await r.json() as Popularity);
}
export function itemStages(pop: Popularity): Record<Stage, { item: number; count: number; share: number }[]> {
  return Object.fromEntries(STAGES.map(({ id }) => {
    const list = Object.entries(pop[`${id}_game_items`] ?? {}).map(([item, count]) => ({ item: Number(item), count })).sort((a, b) => b.count - a.count);
    const top = list[0]?.count || 1;
    return [id, list.map(x => ({ ...x, share: x.count / top }))];
  })) as Record<Stage, { item: number; count: number; share: number }[]>;
}

// ---- whole builds, from pro matches ----------------------------------------------------------------------------

/** One player's match on the hero: what they bought when (s), the skill taken at each level, and whether they won. */
export interface BuildGame { won: boolean; at: number; buys: { t: number; key: string }[]; skills: number[] }
export interface Build {
  /** The big items that set it apart from the other builds, in the order most of its games do them. */
  core: string[];
  /** The big items every build shares (the start they have in common). */
  base: string[];
  games: number; wins: number;
  start: { key: string; count: number }[];
  boots: string | null;
  /** Every item most of its games get, in buy order, with the usual minute. */
  order: { key: string; t: number; share: number }[];
  /** The skill most of its games take at each level. */
  skills: number[];
}
/** Items that cost this much are the ones a build is made of (a support's Mekansm, Pavise or Shard too); cheaper ones are parts. */
const BIG = 1400;
/** Big parts and things bought again and again, never a build's own item. */
const NOT_CORE = new Set(['pers', 'mithril_hammer', 'platemail', 'reaver', 'eagle', 'relic', 'demon_edge', 'mystic_staff', 'ultimate_orb', 'hyperstone', 'cheese', 'refresher_shard', 'aegis', 'ward_dispenser', 'tpscroll', 'smoke_of_deceit', 'dust', 'blood_grenade', 'tome_of_knowledge', 'aghanims_shard_roshan', 'ultimate_scepter_roshan', 'ultimate_scepter_2']);
const BOOTS = new Set(['power_treads', 'phase_boots', 'arcane_boots', 'tranquil_boots', 'travel_boots', 'travel_boots_2', 'guardian_greaves', 'boots_of_bearing']);
/** An item a build counts in its order, and in a game at most every this many builds. */
const ORDER_SHARE = 0.4, MAX_BUILDS = 3, MIN_GAMES = 3;
/** Big items that are parts of a bigger one, and how close before it a part counts as the same step (s). */
const PARTS: Record<string, string[]> = { kaya_and_sange: ['kaya', 'sange'], abyssal_blade: ['sange'], bfury: ['pers'], sphere: ['pers'], refresher: ['pers'], manta: ['yasha'], greater_crit: ['lesser_crit'], disperser: ['diffusal_blade'], sange_and_yasha: ['sange', 'yasha'], yasha_and_kaya: ['yasha', 'kaya'], bloodthorn: ['orchid'], nullifier: ['helm_of_the_overlord'], overwhelming_blink: ['blink'], swift_blink: ['blink'], arcane_blink: ['blink'], sheepstick: [], skadi: [] };
const MERGED = 180;
const median = (l: number[]) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

/**
 * The few ways a hero is built: games grouped by their first three big items (in any order), the most played groups
 * first. `cost` says what an item costs (0 if unknown). Fewer than three games on a way isn't a build.
 */
export function buildsFrom(games: BuildGame[], cost: (key: string) => number): Build[] {
  const isCore = (key: string) => !BOOTS.has(key) && !NOT_CORE.has(key) && !key.startsWith('recipe_') && cost(key) >= BIG;
  const firsts = (g: BuildGame) => {
    const seen = new Set<string>();
    return g.buys.filter(b => b.t > 0 && isCore(b.key) && !seen.has(b.key) && seen.add(b.key));
  };
  // games grouped by their first n big items: a hero everyone starts the same way (Battle Fury, Yasha, Manta) splits
  // further on, a support with few big items earlier on. The n giving the most builds, and then the most games, wins.
  const groupBy = (n: number) => {
    const groups = new Map<string, BuildGame[]>();
    for (const g of games) {
      const core = firsts(g).slice(0, n).map(b => b.key);
      if (core.length < n) continue;
      const id = [...core].sort().join('+');
      groups.set(id, [...(groups.get(id) ?? []), g]);
    }
    return [...groups].filter(([, l]) => l.length >= MIN_GAMES).sort((a, b) => b[1].length - a[1].length).slice(0, MAX_BUILDS)
      .map(([id, list]) => ({ items: id.split('+'), list }));
  };
  const score = (l: { list: BuildGame[] }[]) => Math.min(l.length, MAX_BUILDS) * games.length + l.reduce((a, x) => a + x.list.length, 0);
  const best = [3, 4, 2, 5].map(groupBy).reduce((a, b) => (score(b) > score(a) ? b : a));
  // what tells the builds apart: the items of each one's group that not every build shares
  const shared = best.length > 1 ? best[0].items.filter(i => best.every(b => b.items.includes(i))) : [];
  return best.map(({ items, list }) => {
    // every big item's first buy in each game, and the boots
    const times = new Map<string, number[]>(), boots = new Map<string, number>(), start = new Map<string, number>();
    for (const g of list) {
      const seen = new Set<string>();
      for (const b of g.buys) {
        if (b.t <= 0) { start.set(b.key, (start.get(b.key) ?? 0) + 1); continue; }
        if (seen.has(b.key)) continue;
        seen.add(b.key);
        if (BOOTS.has(b.key)) boots.set(b.key, (boots.get(b.key) ?? 0) + 1);
        if (isCore(b.key) || BOOTS.has(b.key)) times.set(b.key, [...(times.get(b.key) ?? []), b.t]);
      }
    }
    const kept = [...times].filter(([, t]) => t.length / list.length >= ORDER_SHARE)
      .map(([key, t]) => ({ key, t: median(t), share: t.length / list.length })).sort((a, b) => a.t - b.t);
    // a part bought just before the item it goes into isn't a step of its own (Sange a minute before Kaya and Sange)
    const order = kept.filter(o => !kept.some(c => PARTS[c.key]?.includes(o.key) && o.t >= c.t - MERGED));
    const levels = Math.max(0, ...list.map(g => g.skills.length));
    const skills = Array.from({ length: Math.min(levels, 18) }, (_, i) => {
      const count = new Map<number, number>();
      for (const g of list) if (g.skills[i]) count.set(g.skills[i], (count.get(g.skills[i]) ?? 0) + 1);
      return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    });
    // named by the items that set it apart, in the order its games do them
    const when = (key: string) => order.find(o => o.key === key)?.t ?? Infinity;
    // a part folded into a bigger item goes by that item's name (Sange in Sange and Yasha)
    const named = (key: string) => (order.some(o => o.key === key) ? key : order.find(o => PARTS[o.key]?.includes(key))?.key ?? key);
    const own = [...new Set(items.filter(i => !shared.includes(i)).map(named))].sort((a, b) => when(a) - when(b));
    return {
      core: (own.length ? own : items).sort((a, b) => when(a) - when(b)),
      base: shared.sort((a, b) => when(a) - when(b)), games: list.length, wins: list.filter(g => g.won).length,
      // what a game starts with: the items most games buy before the horn, as often as they're bought per game
      start: [...start].map(([key, n]) => ({ key, count: Math.round(n / list.length) })).filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 8),
      boots: [...boots].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      order, skills,
    };
  });
}

/** How many of a hero's pro matches the builds are read from. */
const BUILD_GAMES = 150;
type ExplorerRow = { radiant_win: boolean; player_slot: number; start_time: number; purchase_log: { time: number; key: string }[] | null; ability_upgrades_arr: number[] | null };
const buildsKept = new Map<number, Promise<{ games: BuildGame[]; since: number }>>();
/** A hero's newest pro matches with what was bought and skilled (OpenDota's explorer: pro matches are the parsed ones it keeps). */
export function heroBuildGames(hero: number): Promise<{ games: BuildGame[]; since: number }> {
  if (!buildsKept.has(hero)) buildsKept.set(hero, (async () => {
    const sql = `SELECT m.radiant_win, pm.player_slot, m.start_time, pm.purchase_log, pm.ability_upgrades_arr FROM player_matches pm JOIN matches m USING(match_id) WHERE pm.hero_id = ${Math.trunc(hero)} AND pm.purchase_log IS NOT NULL ORDER BY m.match_id DESC LIMIT ${BUILD_GAMES}`;
    const r = await fetch(`${API}/explorer?sql=${encodeURIComponent(sql)}`);
    if (!r.ok) throw new Error(`OpenDota: ${r.status}`);
    const { rows } = await r.json() as { rows: ExplorerRow[] };
    const games = rows.filter(x => x.purchase_log).map(x => ({
      won: x.radiant_win === x.player_slot < 128, at: x.start_time,
      buys: x.purchase_log!.map(b => ({ t: b.time, key: b.key })), skills: x.ability_upgrades_arr ?? [],
    }));
    return { games, since: Math.min(...games.map(g => g.at)) };
  })().catch(e => { buildsKept.delete(hero); throw e; }));
  return buildsKept.get(hero)!;
}

import HEROES from './generated/heroes.json';
import ITEMS from './generated/items.json';

/** Dota 2's static data: heroes, items, teams and the map's buildings (0–1 across, Radiant bottom left). */
export type D2Team = 0 | 1;
export const TEAM_NAME: Record<D2Team, string> = { 0: 'Radiant', 1: 'Dire' };
export const TEAM_COLOR: Record<D2Team, string> = { 0: '#7fd05a', 1: '#e5533d' };

export interface D2Hero { id: number; key: string; name: string; icon: string | null }
export const D2_HEROES = HEROES as D2Hero[];
const byId = new Map(D2_HEROES.map(h => [h.id, h]));
const byKey = new Map(D2_HEROES.map(h => [h.key, h]));
/** A match OpenDota has only just heard of has no heroes yet (id 0). */
export const heroOf = (id: number): D2Hero => byId.get(id) ?? { id, key: '', name: id ? `Hero ${id}` : 'Unknown hero', icon: null };
/** The hero behind a unit name in the logs (an illusion counts as its hero; a creep has none). */
export const heroByKey = (key: string | undefined) => (key ? byKey.get(key.replace(/^illusion_/, '')) : undefined);

export interface D2Item { id: number; key: string; name: string; cost: number; icon: string | null }
export const D2_ITEMS = ITEMS as D2Item[];
export const itemById = new Map(D2_ITEMS.map(i => [i.id, i]));
export const itemByKey = new Map(D2_ITEMS.map(i => [i.key, i]));

const ITEM_ICONS = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items';
/** An item as a replay names it (`item_tango*3`): its name, icon and charges, also for items the shop list doesn't have (neutral ones). */
export function itemLook(slot: string): { key: string; name: string; icon: string; charges: number } {
  const [raw, count] = slot.split('*'), key = raw.replace(/^item_/, ''), known = itemByKey.get(key);
  return {
    key, charges: Number(count) || 0, icon: known?.icon ?? `${ITEM_ICONS}/${key}.png`,
    name: known?.name ?? key.replace(/^enhancement_/, '').split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' '),
  };
}

export type Pt = { x: number; y: number };
/** The part of the game's world the map shows, in map cells (the image's edges, measured against a replay's positions). */
const VIEW = { left: 63, top: 192.5, span: 130 };
/** The map's width in game units (128 to a cell). */
export const MAP_UNITS = VIEW.span * 128;
/** Map cells (y up) to map coordinates (0–1, y down). */
export const cellToMap = (cx: number, cy: number): Pt => ({ x: (cx - VIEW.left) / VIEW.span, y: (VIEW.top - cy) / VIEW.span });

export const mins = (s: number) => {
  const a = Math.abs(Math.trunc(s));
  return `${s < 0 && a > 0 ? '−' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
};

export interface Building { uid: string; key: string; team: D2Team; kind: 'tower' | 'rax' | 'fort'; name: string; x: number; y: number }
/**
 * The game's own map images (patch 7.41, from Liquipedia). Each is lined up with the game's coordinates by how a replay's
 * creeps, towers and Roshan fall on it: image pixel = a × cell + b across, c × cell + d down.
 */
export type MapStyle = 'simple' | 'game';
const MAP_IMAGES: Record<MapStyle, { src: string; a: number; b: number; c: number; d: number }> = {
  simple: { src: '/images/maps/dota2-simple.png', a: 6.93, b: -376, c: -6.918, d: 1393 },
  game: { src: '/images/maps/dota2-game.png', a: 6.32, b: -295, c: -6.306, d: 1304 },
};
const IMAGE_SIZE = 1024;
/** A map image and where it lies in map coordinates (it's larger than the map: its frame falls outside). */
export function mapImage(style: MapStyle) {
  const { src, a, b, c, d } = MAP_IMAGES[style];
  return { src, x: -(a * VIEW.left + b) / (a * VIEW.span), y: (c * VIEW.top + d) / (VIEW.span * c), w: IMAGE_SIZE / (a * VIEW.span), h: -IMAGE_SIZE / (c * VIEW.span) };
}
/** Roshan's two lairs, across the map's x (from a replay), and how far each is drawn from there on each image, in its pixels. */
const LAIR_X = { top: cellToMap(103, 0).x, bottom: cellToMap(150.3, 0).x };
const LAIR_SHIFT: Record<MapStyle, { top: Pt; bottom: Pt }> = {
  simple: { top: { x: 17, y: 15 }, bottom: { x: 0, y: 8 } },
  game: { top: { x: 6, y: 4 }, bottom: { x: 0, y: 0 } },
};
/**
 * Where to draw Roshan so he's in the lair as this image shows it: the images aren't exact there, and he's the one thing
 * that always stands on a drawn landmark. Walking between lairs he shifts gradually from one to the other.
 */
export function roshanOnMap(style: MapStyle, at: Pt): Pt {
  const { a, c } = MAP_IMAGES[style], s = LAIR_SHIFT[style];
  const w = Math.max(0, Math.min(1, (at.x - LAIR_X.top) / (LAIR_X.bottom - LAIR_X.top)));
  return { x: at.x + (s.top.x + (s.bottom.x - s.top.x) * w) / (a * VIEW.span), y: at.y + (s.top.y + (s.bottom.y - s.top.y) * w) / (-c * VIEW.span) };
}
/** Where each building stands, in map cells, as read from a replay (they don't move between matches). */
const SPOTS: Record<D2Team, Record<string, [number, number]>> = {
  0: {
    tower1_top: [78.5, 142.5], tower2_top: [77.21, 121.19], tower3_top: [76.5, 101.37], tower1_mid: [115.94, 117], tower2_mid: [103.08, 105.14], tower3_mid: [91.75, 95.62], tower1_bot: [165.97, 78.16], tower2_bot: [125.19, 79.12], tower3_bot: [97.12, 80.25],
    range_rax_top: [74.53, 98.63], melee_rax_top: [78.5, 98.64], range_rax_mid: [88.47, 95.2], melee_rax_mid: [91.5, 92.44], range_rax_bot: [94.57, 82.27], melee_rax_bot: [94.56, 78.31],
    'tower4#1': [83.37, 90], 'tower4#2': [85.87, 87.44], fort: [81.75, 86.19],
  },
  1: {
    tower1_top: [86.79, 175.16], tower2_top: [127, 175], tower3_top: [155.75, 173.12], tower1_mid: [132.09, 133.09], tower2_mid: [147.5, 144.5], tower3_mid: [161.37, 157.37], tower1_bot: [176.98, 110.5], tower2_bot: [178, 131], tower3_bot: [177.5, 151.69],
    range_rax_top: [158.42, 175.07], melee_rax_top: [158.45, 170.94], range_rax_mid: [161.87, 160.68], melee_rax_mid: [164.73, 157.87], range_rax_bot: [175.37, 154.37], melee_rax_bot: [179.5, 154.5],
    'tower4#1': [166.62, 165.31], 'tower4#2': [169.25, 162.62], fort: [171.19, 167.06],
  },
};
/** What a rune is, by its number in the replay and in OpenDota's log. */
export const RUNE_NAME: Record<number, string> = { 0: 'Amplify Damage', 1: 'Haste', 2: 'Illusion', 3: 'Invisibility', 4: 'Regeneration', 5: 'Bounty', 6: 'Arcane', 7: 'Water', 8: 'Wisdom', 9: 'Shield' };
const RUNE_FILE: Record<number, string> = { 0: 'amplify', 1: 'haste', 2: 'illusion', 3: 'invisibility', 4: 'regeneration', 5: 'bounty', 6: 'arcane', 7: 'water', 8: 'wisdom', 9: 'shield' };
/** The game's map icon for a rune. */
export const runeIcon = (rune: number | undefined): string | null => (rune !== undefined && RUNE_FILE[rune] ? `/images/icons/dota2/runes/${RUNE_FILE[rune]}.png` : null);
export const RUNE_ICONS = Object.keys(RUNE_FILE).map(r => runeIcon(Number(r)));
const SIDE: Record<D2Team, string> = { 0: 'goodguys', 1: 'badguys' };
const buildingName = (uid: string) => {
  if (uid === 'fort') return 'Ancient';
  const [, kind, lane] = uid.match(/^(tower\d|melee_rax|range_rax)_?(\w*)/)!;
  const what = kind.startsWith('tower') ? `T${kind[5]}` : `${kind === 'melee_rax' ? 'melee' : 'ranged'} barracks`;
  return lane && !lane.startsWith('#') ? `${lane} ${what}` : what;
};
export const BUILDINGS: Building[] = ([0, 1] as D2Team[]).flatMap(team => Object.entries(SPOTS[team]).map(([uid, [cx, cy]]): Building => ({
  uid: `${team}_${uid}`, key: `npc_dota_${SIDE[team]}_${uid.replace(/#\d$/, '')}`, team,
  kind: uid === 'fort' ? 'fort' : uid.includes('rax') ? 'rax' : 'tower', name: buildingName(uid), ...cellToMap(cx, cy),
})));
export const buildingOf = new Map(BUILDINGS.map(b => [b.uid, b]));
/** Where the lanes' first towers are, by OpenDota's lane number (1 bottom, 2 mid, 3 top), for the lane setup. */
export const LANE_TOWER: Record<1 | 2 | 3, Record<D2Team, string>> = {
  1: { 0: '0_tower1_bot', 1: '1_tower1_bot' }, 2: { 0: '0_tower1_mid', 1: '1_tower1_mid' }, 3: { 0: '0_tower1_top', 1: '1_tower1_top' },
};
/** Vision of an Observer Ward, in map widths. */
export const OBS_VISION = 1600 / MAP_UNITS;

// Deadlock's static data from deadlock-api.com, trimmed to what the site uses: heroes (name, colour, icons), shop items
// (name, cost, tier, slot, icon) and the map (size, objectives, lanes, camps, urn, shops, teleporters…). Run again when
// the game changes.
//
//   npm run dl:assets
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.deadlock-api.com';
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated');
const get = async (p: string) => { const r = await fetch(API + p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

type Hero = { id: number; name: string; player_selectable: boolean; disabled: boolean; in_development: boolean; colors?: { style_hex?: string }; images: Record<string, string> };
const heroes = (await get('/v1/assets/heroes?only_active=true')) as Hero[];
const outHeroes = heroes.filter(h => h.player_selectable && !h.disabled).map(h => ({
  id: h.id, name: h.name, color: h.colors?.style_hex ?? '#888888',
  icon: h.images.minimap_image_webp ?? h.images.minimap_image ?? h.images.icon_image_small_webp ?? null,
  card: h.images.icon_image_small_webp ?? h.images.icon_image_small ?? null,
})).sort((a, b) => a.name.localeCompare(b.name));

type Pt = { left_relative: number; top_relative: number; position?: number[]; [k: string]: unknown };
const map = await get('/v1/assets/map');
const rel = (p: Pt) => ({ x: +p.left_relative.toFixed(4), y: +p.top_relative.toFixed(4) });
// The API's objective spots are on another frame than everything else on its map (they're centred on 0.45, the map
// on 0.5, where the mid boss stands): lined up on the game's own minimap (Oct 2026), they need this shift and a
// 5.5% vertical stretch. Its "core" spots are off the map: the patron is the "titan" spot.
const fixObjective = (x: number, y: number) => ({ x: +(0.9896 * x + 0.0035 * y + 0.0518).toFixed(4), y: +(1.0555 * y + 0.0277).toFixed(4) });
const objectives = Object.entries(map.objective_positions as Record<string, Pt>).filter(([id]) => !id.endsWith('_core')).map(([id, p]) => {
  const m = id.match(/^team(\d)_(.+)$/)!;
  return { id, team: Number(m[1]), kind: m[2].replace(/_\d+$/, ''), lane: Number(m[2].match(/_(\d+)$/)?.[1] ?? 0) || null, ...fixObjective(p.left_relative, p.top_relative) };
});
// what the API doesn't have, read off the game's minimap for the bottom team (Amber) and turned half a circle around
// the middle for the top team (the map is the same both ways round; lane 1 is on the left for both teams)
const mirror = (p: { x: number; y: number }) => ({ x: +(1 - p.x).toFixed(4), y: +(1 - p.y).toFixed(4) });
const BASE0: Record<1 | 3 | 4, { x: number; y: number }> = { 1: { x: 0.334, y: 0.808 }, 3: { x: 0.441, y: 0.756 }, 4: { x: 0.547, y: 0.808 } };
const SHRINE0 = [{ x: 0.366, y: 0.869 }, { x: 0.514, y: 0.869 }];
for (const lane of [1, 3, 4] as const) {
  objectives.push({ id: `team0_base_${lane}`, team: 0, kind: 'base', lane, ...BASE0[lane] });
  // turned around, the bottom team's left lane is the top team's right one
  objectives.push({ id: `team1_base_${lane}`, team: 1, kind: 'base', lane, ...mirror(BASE0[({ 1: 4, 3: 3, 4: 1 } as const)[lane]]) });
}
SHRINE0.forEach((p, i) => {
  objectives.push({ id: `team0_shrine_${i + 1}`, team: 0, kind: 'shrine', lane: null, ...p });
  objectives.push({ id: `team1_shrine_${i + 1}`, team: 1, kind: 'shrine', lane: null, ...mirror(SHRINE0[1 - i]) });
});
const ents = map.entities as Record<string, Pt[]>;
const pick = (k: string, extra: (p: Pt) => object = () => ({})) => (ents[k] ?? []).map(p => ({ ...rel(p), ...extra(p) }));
const r = map.radius as number;
const toRel = (x: number, y: number) => ({ x: +((x + r) / (2 * r)).toFixed(4), y: +((r - y) / (2 * r)).toFixed(4) });
type Zip = { origin: number[]; color: string; P0_points: number[][] };
const outMap = {
  radius: r,
  objectives,
  lanes: (map.zipline_paths as Zip[]).map(z => ({ color: z.color, pts: z.P0_points.map(q => toRel(z.origin[0] + q[0], z.origin[1] + q[1])) })),
  camps: (map.neutral_camps as (Pt & { name: string; kind: string })[]).map(c => ({ kind: c.kind, ...rel(c) })),
  urnSpawns: pick('soul_urn_spawns'), urnPads: pick('soul_urn_pads'),
  shops: pick('shops', p => ({ team: p.team, kind: p.kind })),
  teleporters: pick('teleporters'), bridgeBuffs: pick('bridge_buffs'), rifts: pick('unstable_rifts'), bells: pick('bells'),
  // the mid boss stands in the middle of the map
  midBoss: { x: 0.5, y: 0.5 },
};
type Item = { id: number; name: string; cost: number; item_tier: number; item_slot_type: string; shopable: boolean; disabled?: boolean | null; image_webp?: string; image?: string };
const items = (await get('/v1/assets/items/by-type/upgrade')) as Item[];
const outItems = items.filter(i => i.shopable && !i.disabled).map(i => ({
  id: i.id, name: i.name, cost: i.cost, tier: i.item_tier, slot: i.item_slot_type, icon: i.image_webp ?? i.image ?? null,
})).sort((a, b) => a.tier - b.tier || a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify(outItems));
fs.writeFileSync(path.join(OUT, 'heroes.json'), JSON.stringify(outHeroes));
fs.writeFileSync(path.join(OUT, 'map.json'), JSON.stringify(outMap));
console.log(`${outHeroes.length} heroes, ${outItems.length} items, ${objectives.length} objectives, ${outMap.lanes.length} lanes, ${outMap.camps.length} camps → ${path.relative(process.cwd(), OUT)}`);

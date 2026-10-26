// Deadlock's static data from deadlock-api.com, trimmed to what the site uses: heroes (name, colour, icons) and the
// map (size, objectives, lanes, camps, urn, shops, teleporters…). Run again when the game changes.
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
const objectives = Object.entries(map.objective_positions as Record<string, Pt>).map(([id, p]) => {
  const m = id.match(/^team(\d)_(.+)$/)!;
  return { id, team: Number(m[1]), kind: m[2].replace(/_\d+$/, ''), lane: Number(m[2].match(/_(\d+)$/)?.[1] ?? 0) || null, ...rel(p) };
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
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'heroes.json'), JSON.stringify(outHeroes));
fs.writeFileSync(path.join(OUT, 'map.json'), JSON.stringify(outMap));
console.log(`${outHeroes.length} heroes, ${objectives.length} objectives, ${outMap.lanes.length} lanes, ${outMap.camps.length} camps → ${path.relative(process.cwd(), OUT)}`);

// Dota 2's static data from opendota.com, trimmed to what the site uses: heroes (name, icon) and items (name, cost,
// icon). Run again when the game changes.
//
//   npm run dota:assets
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.opendota.com/api/constants';
const CDN = 'https://cdn.cloudflare.steamstatic.com';
const OUT = path.resolve(import.meta.dirname, '../src/dota2/generated');
const get = async (p: string) => { const r = await fetch(`${API}/${p}`); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

type Hero = { id: number; name: string; localized_name: string; icon: string };
const heroes = Object.values((await get('heroes')) as Record<string, Hero>).map(h => ({
  id: h.id, key: h.name, name: h.localized_name, icon: CDN + h.icon.replace(/\?$/, ''),
})).sort((a, b) => a.name.localeCompare(b.name));

type Item = { id?: number; dname?: string; cost?: number | null; img?: string };
const items = Object.entries((await get('items')) as Record<string, Item>)
  .filter(([key, i]) => i.id && i.dname && i.cost && !key.startsWith('recipe_'))
  .map(([key, i]) => ({ id: i.id!, key, name: i.dname!, cost: i.cost!, icon: i.img ? CDN + i.img.replace(/\?.*$/, '') : null }))
  .sort((a, b) => a.name.localeCompare(b.name));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'heroes.json'), JSON.stringify(heroes));
fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify(items));
console.log(`${heroes.length} heroes, ${items.length} items → ${path.relative(process.cwd(), OUT)}`);

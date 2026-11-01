// Every hero's talent tree with its real numbers, for the site's talent view: OpenDota says which talent is on which
// level, Valve's hero data says what each one does. Run again when the game changes.
//
//   npx vite-node tools/dota-talents.ts
import fs from 'node:fs';
import HEROES from '../src/dota2/generated/heroes.json';

const OUT = 'src/dota2/generated/talents.json', PAUSE = 800;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

type Value = { name: string; values_float: number[]; bonuses?: { name: string; value: number }[] };
type Talent = { name: string; name_loc: string; special_values: Value[] };
/** A hero's skills say what each talent adds to them: `talent|field` → how much. Found wherever skills are listed, facets too. */
function bonusesIn(node: unknown, into = new Map<string, number>()) {
  if (Array.isArray(node)) for (const x of node) bonusesIn(x, into);
  else if (node && typeof node === 'object') {
    const o = node as { special_values?: Value[] };
    for (const v of o.special_values ?? []) for (const b of v.bonuses ?? []) into.set(`${b.name}|${v.name}`, Math.abs(b.value));
    for (const x of Object.values(node)) if (typeof x === 'object') bonusesIn(x, into);
  }
  return into;
}
const tree = await (await fetch('https://api.opendota.com/api/constants/hero_abilities')).json() as Record<string, { talents: { name: string; level: number }[] }>;

const number = (v: number) => String(Math.round(v * 100) / 100);
/** "+{s:value} Health Regen" with its number in. */
const words = (t: Talent, bonuses: Map<string, number>) => t.name_loc.replace(/\{s:([^}]+)\}/g, (_, key: string) => {
  const field = key.replace(/^bonus_/, ''), own = t.special_values.find(v => v.name === key || v.name === field);
  if (own?.values_float.length) return number(own.values_float[0]);
  const from = bonuses.get(`${t.name}|${field}`) ?? bonuses.get(`${t.name}|${key}`);
  if (from !== undefined) return number(from);
  // a single number for this talent can only be this one
  const all = [...bonuses].filter(([k]) => k.startsWith(`${t.name}|`));
  if (all.length === 1) return number(all[0][1]);
  unknown++;
  return 'X';
}).replace(/\s+/g, ' ').trim();
let unknown = 0;

const out: Record<string, [string, string][]> = {};
let missing = 0;
for (const hero of HEROES) {
  await wait(PAUSE);
  const res = await fetch(`https://www.dota2.com/datafeed/herodata?language=english&hero_id=${hero.id}`, { headers: { 'user-agent': 'Mozilla/5.0' } }).catch(() => null);
  const data = res?.ok ? await res.json() as { result: { data: { heroes: { talents: Talent[] }[] } } } : null;
  const talents = data?.result.data.heroes[0]?.talents ?? [], levels = tree[hero.key]?.talents ?? [];
  if (!talents.length || !levels.length) { missing++; console.log(`no talents for ${hero.name}`); continue; }
  // tiers of two, lowest first: each entry is the talent's key and what it does
  const tiers: [string, string][] = [];
  for (const level of [1, 2, 3, 4]) for (const { name } of levels.filter(l => l.level === level)) {
    const t = talents.find(x => x.name === name);
    tiers.push([name, t ? words(t, bonusesIn(data!.result.data.heroes[0])) : name]);
  }
  out[hero.id] = tiers;
}
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(out).length} heroes, ${missing} missing, ${unknown} numbers unknown, ${(fs.statSync(OUT).size / 1000).toFixed(0)} KB`);
console.log(out[1]);

// Every hero's talent tree with its real numbers, for the site's talent view: OpenDota says which talent is on which
// level, Valve's hero data says what each one does. Run again when the game changes.
//
//   npx vite-node tools/dota-talents.ts
import fs from 'node:fs';
import HEROES from '../src/dota2/generated/heroes.json';
import { bonusesIn, talentWords, type ValveTalent } from '../src/dota2/talentText';

const OUT = 'src/dota2/generated/talents.json', PAUSE = 800;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const tree = await (await fetch('https://api.opendota.com/api/constants/hero_abilities')).json() as Record<string, { talents: { name: string; level: number }[] }>;

let stale = 0;

const out: Record<string, [string, string][]> = {};
let missing = 0;
for (const hero of HEROES) {
  await wait(PAUSE);
  const res = await fetch(`https://www.dota2.com/datafeed/herodata?language=english&hero_id=${hero.id}`, { headers: { 'user-agent': 'Mozilla/5.0' } }).catch(() => null);
  const data = res?.ok ? await res.json() as { result: { data: { heroes: { talents: ValveTalent[] }[] } } } : null;
  const talents = data?.result.data.heroes[0]?.talents ?? [], levels = tree[hero.key]?.talents ?? [];
  if (!talents.length || !levels.length) { missing++; console.log(`no talents for ${hero.name}`); continue; }
  // tiers of two, lowest first: each entry is the talent's key and what it does
  const tiers: [string, string][] = [];
  const listed = new Set(levels.map(l => l.name));
  // OpenDota's list can lag a patch behind Valve's: a talent Valve no longer has was replaced by the one OpenDota doesn't know
  const newer = talents.filter(x => !listed.has(x.name));
  for (const level of [1, 2, 3, 4]) for (const { name } of levels.filter(l => l.level === level)) {
    const t = talents.find(x => x.name === name) ?? newer.shift();
    if (!t) { console.log(`${hero.name}: nothing says what ${name} does`); stale++; }
    tiers.push(t ? [t.name, talentWords(t, bonusesIn(data!.result.data.heroes[0]))] : [name, 'Unknown talent']);
  }
  out[hero.id] = tiers;
}
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(out).length} heroes, ${missing} missing, ${stale} talents unknown, ${(fs.statSync(OUT).size / 1000).toFixed(0)} KB`);
console.log(out[1]);

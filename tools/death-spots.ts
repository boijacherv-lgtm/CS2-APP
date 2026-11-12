// Where FACEIT level-10 players die, per map and side: every kill in the training reads, by callout, early (first 40 s)
// and later. Feeds the guide page /guides/deaths. Writes src/map/generated/death-spots.json.
//   npx vite-node tools/death-spots.ts -- <training folder> [--demos 200]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { newestParsed, PARSE_V } from './learn-lib';
import type { DemoData } from '../src/engine/recap';
import { getEngine, MAPS } from '../src/map/catalog';
import { worldToRadar } from '../src/engine/coords';
import { placeOf } from '../src/engine/situations';

const args = process.argv.slice(2).filter(a => a !== '--');
const folder = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const di = args.indexOf('--demos'), DEMOS = di >= 0 ? Number(args[di + 1]) : 200;
const OUT = path.resolve(import.meta.dirname, '../src/map/generated/death-spots.json');
if (!folder) { console.log('Give the training folder.'); process.exit(1); }
const files = [...newestParsed(folder)].filter(([, p]) => p.v === PARSE_V).map(([, p]) => p.file);
const step = Math.max(1, Math.floor(files.length / DEMOS));
type Count = Record<string, number>;
const by: Record<string, { demos: number; deaths: number; CT: { early: Count; late: Count }; T: { early: Count; late: Count } }> = {};
for (const f of files.filter((_, i) => i % step === 0).slice(0, DEMOS)) {
  let d: DemoData;
  try { d = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')) as DemoData; } catch { continue; }
  if (!MAPS.some(m => m.id === d.map)) continue;
  const e = getEngine(d.map, 0);
  const m = (by[d.map] ??= { demos: 0, deaths: 0, CT: { early: {}, late: {} }, T: { early: {}, late: {} } });
  m.demos++;
  for (const r of d.rounds) for (const k of r.kills) {
    const side = r.frames.players[k.victim]?.side;
    if (side !== 'CT' && side !== 'T') continue;
    const place = placeOf(e, worldToRadar({ x: k.x, y: k.y }, e.map.radar));
    if (!place) continue;
    const bucket = m[side][k.t < 40 ? 'early' : 'late'];
    bucket[place] = (bucket[place] ?? 0) + 1;
    m.deaths++;
  }
}
const top = (c: Count, n: number) => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([place, k]) => ({ place, share: +(k / Math.max(1, n)).toFixed(3) }));
const out = Object.fromEntries(Object.entries(by).map(([map, m]) => {
  const tot = (s: 'CT' | 'T', w: 'early' | 'late') => Object.values(m[s][w]).reduce((a, b) => a + b, 0);
  return [map, { demos: m.demos, deaths: m.deaths, CT: { early: top(m.CT.early, tot('CT', 'early')), late: top(m.CT.late, tot('CT', 'late')) }, T: { early: top(m.T.early, tot('T', 'early')), late: top(m.T.late, tot('T', 'late')) } }];
}));
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`→ ${path.relative(process.cwd(), OUT)}: ${Object.keys(out).length} maps, ${Object.values(by).reduce((a, m) => a + m.demos, 0)} demos`);

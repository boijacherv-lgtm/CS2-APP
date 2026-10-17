// Learns the standard grenade spots from a folder of good players' demos (e.g. FACEIT level 10): every smoke and
// molotov landing, grouped per map, side and type; a spot that several different matches use is "standard". The
// review then calls a smoke there book ("a standard smoke"), and a smoke far from every standard spot that blocked
// nothing a missed smoke. Writes src/map/generated/util-spots.json.
//
//   npm run learn:spots -- <folder>
//
// Reads .dem, .dem.gz and .dem.zst; each demo's landings are cached in <folder>/.stratboard-spots-cache.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseDemo } from './demo.mjs';
import type { DemoData } from '../src/engine/recap';

const args = process.argv.slice(2).filter(a => a !== '--');
const folder = args[0];
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run learn:spots -- <folder with demos>'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, '../src/map/generated/util-spots.json');
const CACHE = path.join(folder, '.stratboard-spots-cache.json');
/** Landings closer than this (world units) are the same spot; a smoke is ~144 units across. */
const SAME_SPOT = 130;
/** A spot is standard when this many landings from at least MIN_DEMOS different matches use it. */
const MIN_THROWS = 4, MIN_DEMOS = 3;

type Landing = { type: 'smoke' | 'molotov'; side: 'CT' | 'T'; x: number; y: number };
type Cached = { map: string | null; landings: Landing[]; error?: string };
const cache: Record<string, Cached> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const files = fs.readdirSync(folder).filter(f => /\.dem(\.gz|\.zst)?$/i.test(f)).sort();
const keyOf = (f: string) => `${f.replace(/ \(\d+\)(?=\.dem)/, '')}|${fs.statSync(path.join(folder, f)).size}`;
const seen = new Set<string>();

function read(file: string): Cached {
  let p = file, temp = false;
  if (!/\.dem$/i.test(file)) {
    const raw = fs.readFileSync(file);
    p = path.join(os.tmpdir(), `stratboard-spots-${process.pid}.dem`);
    fs.writeFileSync(p, /\.zst$/i.test(file) ? zlib.zstdDecompressSync(raw) : zlib.gunzipSync(raw));
    temp = true;
  }
  try {
    const d: DemoData = parseDemo(p);
    const landings: Landing[] = [];
    for (const r of d.rounds)
      for (const u of r.util) {
        const side = r.frames.players[u.thrower]?.side;
        if ((u.type === 'smoke' || u.type === 'molotov') && side) landings.push({ type: u.type, side, x: Math.round(u.x), y: Math.round(u.y) });
      }
    return { map: d.map, landings };
  } finally { if (temp) fs.rmSync(p, { force: true }); }
}

files.forEach((f, i) => {
  const key = keyOf(f);
  if (seen.has(key)) return;
  seen.add(key);
  if (!cache[key]) {
    const t = Date.now();
    try { cache[key] = read(path.join(folder, f)); } catch (e) { cache[key] = { map: null, landings: [], error: e instanceof Error ? e.message : String(e) }; }
    console.log(`[${i + 1}/${files.length}] ${f}  ${cache[key].error ? `skipped: ${cache[key].error}` : `${cache[key].map}, ${cache[key].landings.length} grenades`}  ${((Date.now() - t) / 1000).toFixed(0)} s`);
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  }
});

// group landings into spots per map / type / side: greedy, densest first
type Spot = { type: Landing['type']; side: Landing['side']; x: number; y: number; throws: number; demos: number };
const out: Record<string, Spot[]> = {};
const byMap = new Map<string, { l: Landing; demo: string }[]>();
for (const [k, c] of Object.entries(cache)) {
  if (!seen.has(k) || !c.map) continue;
  for (const l of c.landings) byMap.set(c.map, [...(byMap.get(c.map) ?? []), { l, demo: k }]);
}
for (const [map, all] of byMap) {
  const spots: Spot[] = [];
  for (const type of ['smoke', 'molotov'] as const)
    for (const side of ['CT', 'T'] as const) {
      let left = all.filter(a => a.l.type === type && a.l.side === side);
      while (left.length) {
        // the landing with the most others near it is the next spot's centre
        let best = left[0], bestN = 0;
        for (const a of left) {
          const n = left.filter(b => Math.hypot(a.l.x - b.l.x, a.l.y - b.l.y) < SAME_SPOT).length;
          if (n > bestN) { best = a; bestN = n; }
        }
        const near = left.filter(b => Math.hypot(best.l.x - b.l.x, best.l.y - b.l.y) < SAME_SPOT);
        const demos = new Set(near.map(b => b.demo)).size;
        if (near.length < MIN_THROWS || demos < MIN_DEMOS) break;
        spots.push({
          type, side, throws: near.length, demos,
          x: Math.round(near.reduce((a, b) => a + b.l.x, 0) / near.length), y: Math.round(near.reduce((a, b) => a + b.l.y, 0) / near.length),
        });
        left = left.filter(b => !near.includes(b));
      }
    }
  out[map] = spots;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
for (const [map, spots] of Object.entries(out))
  console.log(`${map.padEnd(12)} ${spots.filter(s => s.type === 'smoke').length} standard smokes, ${spots.filter(s => s.type === 'molotov').length} molotov spots`);
console.log(`\nSaved ${path.relative(process.cwd(), OUT)}.`);

// Learns exactly where good players (e.g. FACEIT level 10) hold: every living player's position once a second while
// they're (nearly) still, per
// map, level, side and part of the round, grouped into spots (a few metres across) with their share of the time.
// The Review's "Pro positions" layer draws these spots where they really are, instead of one circle per callout.
// Writes src/map/generated/stand-spots.json.
//
//   npm run learn:stands -- <folder>
//
// Reads the demos already read by the other learn tools (<folder>/.stratboard-parsed); a demo never read is skipped
// (run learn:all on the folder first).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getEngine, MAPS } from '../src/map/catalog';
import { worldToRadar } from '../src/engine/coords';
import { PHASES, phaseOf, type Phase } from '../src/engine/situations';
import type { DemoData } from '../src/engine/recap';

const args = process.argv.slice(2).filter(a => a !== '--');
const folder = args[0];
if (!folder || !fs.existsSync(path.join(folder, '.stratboard-parsed'))) { console.error('Usage: npm run learn:stands -- <folder with read demos>'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, '../src/map/generated/stand-spots.json');
/** Grid cell (radar px, on the 1024 px radar) and how close (cells) two cells must be to join one spot. */
const CELL = 12, JOIN = 2;
/** Spots kept per map, level, side and phase, and the smallest share of the time worth drawing. */
const KEEP = 14, MIN_SHARE = 0.012;
/** Moved less than this (world units) in a second = holding the spot (walking is ~130 units a second). */
const HOLD = 45;

// one file per demo: the newest read of each
const dir = path.join(folder, '.stratboard-parsed');
const newest = new Map<string, { v: number; file: string }>();
for (const f of fs.readdirSync(dir)) {
  const m = f.match(/^v(\d+)-(.+)\.json\.gz$/);
  if (!m) continue;
  const v = Number(m[1]), was = newest.get(m[2]);
  if (!was || v > was.v) newest.set(m[2], { v, file: f });
}

type Key = string; // map|level|side|phase
const time = new Map<Key, Map<number, number>>(); // key -> cell -> player-seconds
const total = new Map<Key, number>();
const demos = new Map<string, number>();
let read = 0, skipped = 0;

for (const { file } of newest.values()) {
  let d: DemoData;
  try { d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString('utf8')); } catch { skipped++; continue; }
  const def = MAPS.find(m => m.id === d.map);
  if (!def) { skipped++; continue; }
  read++;
  demos.set(d.map, (demos.get(d.map) ?? 0) + 1);
  const radar = getEngine(d.map, 0).map.radar;
  const levelOf = (z: number) => {
    const i = def.levels.findIndex(l => l.altitude && z >= l.altitude[0] && z <= l.altitude[1]);
    return i < 0 ? 0 : i;
  };
  for (const r of d.rounds) {
    const ft = r.frames.t;
    for (let k = 4; k < ft.length; k += 4) { // samples are 0.25 s apart: once a second
      const ph = phaseOf(ft[k], r.plant);
      for (const p of Object.values(r.frames.players)) {
        if (!p.alive[k]) continue;
        // holding a spot, not running past it: under HOLD units moved in the last second
        if (Math.hypot(p.x[k] - p.x[k - 4], p.y[k] - p.y[k - 4]) > HOLD) continue;
        const pos = worldToRadar({ x: p.x[k], y: p.y[k] }, radar);
        if (!(pos.x >= 0 && pos.x < 1024 && pos.y >= 0 && pos.y < 1024)) continue;
        const key = `${d.map}|${levelOf(p.z[k])}|${p.side}|${ph}`;
        const cell = Math.floor(pos.y / CELL) * 1000 + Math.floor(pos.x / CELL);
        let m = time.get(key);
        if (!m) time.set(key, (m = new Map()));
        m.set(cell, (m.get(cell) ?? 0) + 1);
        total.set(key, (total.get(key) ?? 0) + 1);
      }
    }
  }
}

/** The busiest cells, each grown into a spot by taking its not-yet-used neighbours: weighted centre and share. */
function spotsOf(cells: Map<number, number>, sum: number, map: string, level: number) {
  const engine = getEngine(map, level);
  const used = new Set<number>();
  const out: { x: number; y: number; share: number; place: string }[] = [];
  for (const [cell] of [...cells].sort((a, b) => b[1] - a[1])) {
    if (used.has(cell) || out.length >= KEEP) continue;
    const cy = Math.floor(cell / 1000), cx = cell % 1000;
    let w = 0, x = 0, y = 0;
    for (let dy = -JOIN; dy <= JOIN; dy++) for (let dx = -JOIN; dx <= JOIN; dx++) {
      const c = (cy + dy) * 1000 + (cx + dx), n = cells.get(c);
      if (!n || used.has(c)) continue;
      used.add(c); w += n; x += (cx + dx + 0.5) * CELL * n; y += (cy + dy + 0.5) * CELL * n;
    }
    const share = w / sum;
    if (share < MIN_SHARE) break;
    const at = { x: x / w, y: y / w };
    const near = [...engine.map.callouts].sort((a, b) => Math.hypot(a.pos.x - at.x, a.pos.y - at.y) - Math.hypot(b.pos.x - at.x, b.pos.y - at.y))[0];
    out.push({ x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, share: Math.round(share * 1000) / 1000, place: near?.name ?? '' });
  }
  return out;
}

const result: Record<string, { demos: number; levels: Record<string, Partial<Record<'CT' | 'T', Partial<Record<Phase, ReturnType<typeof spotsOf>>>>>> }> = {};
for (const [key, cells] of time) {
  const [map, lv, side, ph] = key.split('|') as [string, string, 'CT' | 'T', Phase];
  const spots = spotsOf(cells, total.get(key)!, map, Number(lv));
  ((((result[map] ??= { demos: demos.get(map) ?? 0, levels: {} }).levels[lv] ??= {})[side] ??= {})[ph] = spots);
}
// stable order for clean diffs
const sorted = Object.fromEntries(Object.keys(result).sort().map(m => [m, {
  demos: result[m].demos,
  levels: Object.fromEntries(Object.keys(result[m].levels).sort().map(l => [l, Object.fromEntries((['CT', 'T'] as const).filter(s => result[m].levels[l][s]).map(s => [s,
    Object.fromEntries(PHASES.filter(p => result[m].levels[l][s]![p]).map(p => [p, result[m].levels[l][s]![p]]))]))])),
}]));
fs.writeFileSync(OUT, JSON.stringify(sorted));
console.log(`${read} demos read (${skipped} skipped), ${Object.keys(sorted).length} maps → ${path.relative(process.cwd(), OUT)}`);
for (const m of Object.keys(sorted)) console.log(`  ${m}: ${sorted[m].demos} demos`);

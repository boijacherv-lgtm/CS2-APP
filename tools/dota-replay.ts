// Reads a Dota 2 replay (.dem or .dem.bz2) with the site's own reader and prints what it found, to check the reader.
//
//   npx vite-node tools/dota-replay.ts path/to/match.dem.bz2
import fs from 'node:fs';
import { readReplay } from '../src/dota2/replay/parser';
import { unpackReplay } from '../src/dota2/replay/unpack';

const file = process.argv[2];
if (!file) throw new Error('Which replay?');
let t0 = Date.now();
const raw = new Uint8Array(fs.readFileSync(file));
const dem = unpackReplay(raw);
console.log(`unpacked to ${(dem.length / 1e6).toFixed(0)} MB in ${Date.now() - t0} ms`);
t0 = Date.now();
const r = readReplay(dem);
console.log(`read in ${Date.now() - t0} ms: ${r.times.length} samples, ${r.times[0]} s to ${r.times.at(-1)} s, ${r.heroes.length} heroes`);
for (const h of r.heroes) {
  const at = (i: number) => `(${h.x[i]}, ${h.y[i]} hp${h.hp[i]})`;
  const dead = h.hp.filter(x => x === 0).length, moved = h.x.reduce((a, x, i) => a + (i ? Math.hypot(x - h.x[i - 1], h.y[i] - h.y[i - 1]) : 0), 0);
  console.log(`hero ${h.heroId} team ${h.team} ${h.x.length} pts start ${at(0)} mid ${at(h.x.length >> 1)} end ${at(h.x.length - 1)} dead ${(dead / 3).toFixed(0)} s, moved ${moved.toFixed(0)} cells`);
}

// Calibrates the search engine (src/engine/search.ts) on level-10 play, and checks that it means something:
//   classes    Excellent / Good / Inaccuracy / Mistake thresholds at the 40th / 65th / 85th / 95th percentile of
//              level-10 players' own loss (a Mistake = worse than 85% of their moments)
//   accuracy   scaled so a typical level-10 moment scores about 90
//   check      does a side that plays closer to the engine's best options win more rounds than the win chance
//              expected? (the difference between the sides' average loss, against round won − win chance at 10 s;
//              on every demo: the engine never learned from these rounds' outcomes)
// Writes src/engine/models/search-calibration.json.
//
//   npm run calibrate:search -- <folder> [--max 150]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { newestParsed, PARSE_V } from './learn-lib';
import type { DemoData } from '../src/engine/recap';
import { getEngine, MAPS } from '../src/map/catalog';
import { searchRound } from '../src/engine/search';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run calibrate:search -- <folder> [--max 150]'); process.exit(1); }
const MAX = Number(opt('max', '150'));
const OUT = path.resolve(import.meta.dirname, '../src/engine/models/search-calibration.json');

// only demos already read once (their saved read loads in a fraction of a second; imported ones too: their demo
// files aren't here); spread over the maps
const files = [...newestParsed(folder)].filter(([, p]) => p.v === PARSE_V).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const step = Math.max(1, Math.ceil(files.length / MAX));
const only = opt('only', '').replace(/[^\w.-]+/g, '_');
const pick = files.filter((_, i) => i % step === 0).filter(([id]) => !only || id.startsWith(only)).map(([, p]) => p.file);
console.log(`${files.length} demos read before; using ${pick.length}.`);

const losses: number[] = [];
const pairs: { diff: number; resid: number }[] = [];
// per moment: the class of the move, and how the round then went against the win chance at that moment
const byClass: Record<string, { n: number; resid: number; loss: number }> = {};
const t0 = Date.now();
for (const [i, f] of pick.entries()) {
  let d;
  try { d = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')) as DemoData; } catch { continue; }
  if (!MAPS.some(m => m.id === d.map)) continue;
  const engine = getEngine(d.map, 0);
  for (const r of d.rounds) {
    if (!r.winner) continue;
    let rs;
    try { rs = searchRound(engine, r); } catch { continue; }
    const bySide = { CT: [] as number[], T: [] as number[] };
    for (const m of rs.moments) {
      losses.push(m.loss); bySide[m.side].push(m.loss);
      const b = m.loss <= 0.003 ? 'best' : m.loss <= 0.02 ? 'small' : m.loss <= 0.06 ? 'medium' : 'big';
      const x = (byClass[b] ??= { n: 0, resid: 0, loss: 0 }); x.n++; x.loss += m.loss; x.resid += (r.winner === m.side ? 1 : 0) - m.before;
    }
    const first = rs.moments.find(m => m.side === 'CT');
    if (!first || !bySide.CT.length || !bySide.T.length) continue;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // T's average loss minus CT's: positive = CT played closer to the engine
    pairs.push({ diff: avg(bySide.T) - avg(bySide.CT), resid: (r.winner === 'CT' ? 1 : 0) - first.before });
  }
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${pick.length} demos, ${losses.length} moments`);
}
if (losses.length < 1000) { console.error(`Only ${losses.length} moments: not enough.`); process.exit(1); }
losses.sort((a, b) => a - b);
const q = (p: number) => +losses[Math.min(losses.length - 1, Math.floor(p * losses.length))].toFixed(4);
const thresholds = [q(0.4), q(0.65), q(0.85), q(0.95)].map((v, i, a) => Math.max(v, i ? a[i - 1] + 0.002 : 0.003));
// the real cost: how much a point of engine loss lowers the result against the win chance at that moment (the
// slope of a straight line through every moment). The engine's raw losses exaggerate; this brings them to scale.
// through the groups' averages (weighted by size): single moments are too noisy for a straight line
const gs = Object.values(byClass).map(g => ({ w: g.n, x: g.loss / g.n, y: g.resid / g.n }));
const W = gs.reduce((a, g) => a + g.w, 0), gx = gs.reduce((a, g) => a + g.w * g.x, 0) / W, gy = gs.reduce((a, g) => a + g.w * g.y, 0) / W;
const slope = gs.reduce((a, g) => a + g.w * (g.x - gx) * (g.y - gy), 0) / (gs.reduce((a, g) => a + g.w * (g.x - gx) ** 2, 0) || 1);
const costScale = Math.min(1, Math.max(0.05, -slope));
// accuracy: chess.com's curve on the real cost, scaled so level-10 players average about 88
const accAt = (sc: number) => losses.reduce((a, l) => a + Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * l * costScale * 100 * sc) - 3.1669)), 0) / losses.length;
let lo = 0.01, hi = 200;
for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (accAt(mid) > 88) lo = mid; else hi = mid; }
const scale = Math.sqrt(lo * hi);
// the check: correlation between playing closer to the engine and beating the expected result
const n = pairs.length;
const mx = pairs.reduce((a, p) => a + p.diff, 0) / n, my = pairs.reduce((a, p) => a + p.resid, 0) / n;
const cov = pairs.reduce((a, p) => a + (p.diff - mx) * (p.resid - my), 0);
const sx = Math.sqrt(pairs.reduce((a, p) => a + (p.diff - mx) ** 2, 0)), sy = Math.sqrt(pairs.reduce((a, p) => a + (p.resid - my) ** 2, 0));
const corr = sx && sy ? cov / (sx * sy) : 0;
// and simpler to read: rounds where a side played clearly closer to the engine, how often it won vs expected
const clear = pairs.filter(p => Math.abs(p.diff) > 0.01);
const beat = clear.reduce((a, p) => a + Math.sign(p.diff) * p.resid, 0) / (clear.length || 1);

const out = { thresholds, scale: +scale.toFixed(3), costScale: +costScale.toFixed(3), moments: losses.length, rounds: n, check: { corr: +corr.toFixed(3), clearRounds: clear.length, beatBy: +beat.toFixed(3) }, calibratedAt: new Date().toISOString().slice(0, 10) };
if (!args.includes('--check-only')) fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`\nSearch engine calibrated on ${losses.length} level-10 moments (${n} rounds) in ${((Date.now() - t0) / 60000).toFixed(1)} min:`);
console.log(`  classes: Excellent ≤ ${(thresholds[0] * 100).toFixed(1)}%, Good ≤ ${(thresholds[1] * 100).toFixed(1)}%, Inaccuracy ≤ ${(thresholds[2] * 100).toFixed(1)}%, Mistake ≤ ${(thresholds[3] * 100).toFixed(1)}%, Blunder above; accuracy scale ${scale.toFixed(3)}`);
console.log(`  real cost: a point of engine loss = ${(costScale).toFixed(2)} points of round win chance (slope through the groups)`);
console.log(`  check: playing closer to the engine vs beating the expected result: correlation ${corr.toFixed(3)} over ${n} rounds;`);
console.log(`         in ${clear.length} rounds where one side was clearly closer, it did ${(beat * 100).toFixed(1)} points better than its win chance said.`);
console.log('  per moment (round won − win chance at that moment), by how much the move gave up:');
for (const k of ['best', 'small', 'medium', 'big']) if (byClass[k]) console.log(`    ${k.padEnd(7)} ${String(byClass[k].n).padStart(7)} moments, engine loss ${(100 * byClass[k].loss / byClass[k].n).toFixed(1)}%, result ${(100 * byClass[k].resid / byClass[k].n).toFixed(1)} points`);
(out as Record<string, unknown>).byLoss = Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, { n: v.n, resid: +(v.resid / v.n).toFixed(4) }]));
if (!args.includes('--check-only')) fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`Saved ${path.relative(process.cwd(), OUT)}.`);

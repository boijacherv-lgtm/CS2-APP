// Calibrates the positioning engine (src/engine/engineEval.ts) on level-10 play itself, the way a chess engine's
// accuracy is calibrated on strong games: runs the engine on every level-10 decision in the positions cache and sets
//   the class thresholds  Excellent / Good / Inaccuracy / Mistake / Blunder at the 40th / 65th / 85th / 95th
//                         percentile of their eval loss (a Blunder = worse than 95% of level-10 decisions)
//   the accuracy scale    so a typical (median) level-10 decision scores about 88
// Writes src/engine/models/engine-calibration.json. Run after learn:positions (it runs this by itself).
//
//   npm run calibrate:engine -- <folder>
import fs from 'node:fs';
import path from 'node:path';
import { engineHold, engineMove } from '../src/engine/engineEval';
import { isDecision, type Hold, type Move } from '../src/engine/situations';

const folder = process.argv.slice(2).filter(a => a !== '--')[0];
const CACHE = folder && path.join(folder, '.stratboard-positions-cache.json');
if (!CACHE || !fs.existsSync(CACHE)) { console.error('Usage: npm run calibrate:engine -- <folder with the positions cache>'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, '../src/engine/models/engine-calibration.json');
const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')).demos as Record<string, { map: string | null; rounds: { holds: Hold[]; moves: Move[] }[] }>;

const losses: number[] = [];
for (const c of Object.values(cache)) {
  if (!c.map) continue;
  for (const r of c.rounds) {
    for (const h of r.holds) if (isDecision(h)) { const v = engineHold(c.map, h); if (v) losses.push(v.loss); }
    for (const m of r.moves) if (isDecision({ place: m.from, from: m.t })) { const v = engineMove(c.map, m); if (v) losses.push(v.loss); }
  }
}
if (losses.length < 200) { console.error(`Only ${losses.length} decisions: not enough to calibrate.`); process.exit(1); }
losses.sort((a, b) => a - b);
const q = (p: number) => +losses[Math.min(losses.length - 1, Math.floor(p * losses.length))].toFixed(4);
const thresholds = [q(0.4), q(0.65), q(0.85), q(0.95)];
// chess.com's curve gives 88 at about 3.3 points lost: scale level-10's median loss to that
const median = q(0.5);
const scale = median > 0 ? +(3.3 / (median * 100)).toFixed(3) : 1;
fs.writeFileSync(OUT, JSON.stringify({ thresholds, scale, decisions: losses.length, median }, null, 1) + '\n');
console.log(`Engine calibrated on ${losses.length} level-10 decisions: Excellent ≤ ${(thresholds[0] * 100).toFixed(1)}%, Good ≤ ${(thresholds[1] * 100).toFixed(1)}%, Inaccuracy ≤ ${(thresholds[2] * 100).toFixed(1)}%, Mistake ≤ ${(thresholds[3] * 100).toFixed(1)}%, Blunder above; accuracy scale ${scale}.`);
console.log(`Saved ${path.relative(process.cwd(), OUT)}.`);

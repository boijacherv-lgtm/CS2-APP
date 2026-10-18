// Learns the level ladder (src/engine/level.ts) from the level-10 and the pro demos' caches: how much level-10 games
// vary in each mechanic (reaction, crosshair placement, sound, counter-strafing) and in the coach's performance
// numbers, and where a typical level-10 game and a typical pro game sit on each. Writes src/engine/models/level.json.
// Run after learn:all on both folders (it only reads their caches).
//
//   npm run learn:level -- <level-10 folder> <pro folder>
import fs from 'node:fs';
import path from 'node:path';
import { eachCached, type CoachCached } from './learn-lib';
import type { AnalystRound } from '../src/engine/analyst';
import { zAgainst } from '../src/engine/coach';
import { COACH_MODEL } from '../src/engine/coachModels';
import { mechanicsIndex, mechanicsOf, type Mechanics } from '../src/engine/level';

const [lvlFolder, proFolder] = process.argv.slice(2).filter(a => a !== '--');
if (!lvlFolder || !proFolder || !fs.existsSync(lvlFolder) || !fs.existsSync(proFolder)) { console.error('Usage: npm run learn:level -- <level-10 folder> <pro folder>'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, '../src/engine/models/level.json');

/** Every player's mechanics in every match of a folder (enough fights and time near enemies to measure). */
function mechanics(folder: string): Mechanics[] {
  const out: Mechanics[] = [];
  for (const [, c] of eachCached<{ rounds: AnalystRound[] }>(folder, 'analyst')) {
    if (!c?.rounds?.length) continue;
    const ids = new Set(c.rounds.flatMap(r => [...r.duels.flatMap(d => [d.killer, d.victim]), ...Object.keys(r.micro ?? {})]));
    for (const id of ids) { const m = mechanicsOf(c.rounds, id); if (m.fights >= 5 && m.near >= 50) out.push(m); }
  }
  return out;
}
/** Every player-match's performance against level 10 (the coach's numbers). */
function performance(folder: string): number[] {
  const out: number[] = [];
  for (const [, c] of eachCached<CoachCached>(folder, 'coach')) for (const s of c?.samples ?? []) out.push(zAgainst(s.features, COACH_MODEL, s.role));
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

const L = mechanics(lvlFolder), P = mechanics(proFolder);
const keys = ['react', 'aim', 'loud', 'stopped'] as const;
const mech = Object.fromEntries(keys.map(k => { const xs = L.map(m => m[k]).filter((v): v is number => v != null); return [k, { mean: +mean(xs).toFixed(4), sd: +sd(xs).toFixed(4) }]; })) as Record<keyof Mechanics, { mean: number; sd: number }>;
const li = L.map(m => mechanicsIndex(m, { mech })).filter((v): v is number => v != null);
const pi = P.map(m => mechanicsIndex(m, { mech })).filter((v): v is number => v != null);
const lp = performance(lvlFolder), pp = performance(proFolder);
const model = {
  mech,
  index: { lvl10: +median(li).toFixed(4), pro: +median(pi).toFixed(4), sd: +sd(li).toFixed(4) },
  perf: { lvl10: +median(lp).toFixed(4), pro: +median(pp).toFixed(4), sd: +sd(lp).toFixed(4) },
  games: { lvl10: L.length, pro: P.length },
  trainedAt: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(OUT, JSON.stringify(model, null, 1) + '\n');
const step = (a: number, b: number, s: number) => ((b - a) / s).toFixed(2);
console.log(`Level ladder from ${L.length} level-10 and ${P.length} pro player-games.`);
console.log(`  mechanics: a typical pro is ${step(model.index.lvl10, model.index.pro, model.index.sd)} level-10 spreads better (reaction, crosshair, sound, counter-strafing)`);
console.log(`  performance: a typical pro is ${step(model.perf.lvl10, model.perf.pro, model.perf.sd)} level-10 spreads better (the coach's numbers)`);
console.log(`Saved ${path.relative(process.cwd(), OUT)}.`);

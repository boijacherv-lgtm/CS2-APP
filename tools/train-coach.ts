// Trains the coach on a folder of demos (e.g. FACEIT level-10 matches): every player in every demo becomes one
// sample (their numbers + the role they mostly played), and the coach learns what "normal" looks like for them,
// overall and per role. Writes src/engine/models/<name>.json (faceit10 = the model the site's coach judges with).
//
//   npm run train:coach -- <folder> [--name faceit10] [--label "FACEIT level 10"] [--min-rounds 12]
//
// Reads .dem, .dem.gz and .dem.zst (FACEIT's download format) directly, no unpacking needed. Each demo's numbers
// are cached in <folder>/.stratboard-cache/coach, so adding demos later only reads the new ones.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { coachFromDemo, listDemos, liveKeys, loadDemo, readCache, writeCacheEntry } from './learn-lib';
import { getEngine, MAPS } from '../src/map/catalog';
import { buildReplay, reviewRound, type DemoData, type Role } from '../src/engine/recap';
import { buildMatchReport, summarizeRound, type RoundSummary } from '../src/engine/match';
import { coachFeatures, DEFAULT_MODEL, FEATURE_LABEL, MIN_ROLE_GAMES, trainCoachSet, type FeatureId, type Sample } from '../src/engine/coach';
import type { BoardState } from '../src/engine/types';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!folder || !fs.existsSync(folder)) {
  console.error('Usage: npm run train:coach -- <folder with demos> [--name faceit10] [--label "FACEIT level 10"] [--min-rounds 12]');
  process.exit(1);
}
const name = opt('name', 'faceit10').replace(/[^\w-]/g, '');
const label = opt('label', 'FACEIT level 10');
const minRounds = Number(opt('min-rounds', '12'));
const OUT = path.resolve(import.meta.dirname, `../src/engine/models/${name}.json`);
const CONTEXT: BoardState['context'] = { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } };

type Cached = { map: string | null; samples: (Sample & { rounds: number })[]; error?: string };
// bump when the numbers are computed differently, so cached demos are read again
const cache = readCache<Cached>(folder, 'coach');
const saveCache = (k: string) => writeCacheEntry(folder, 'coach', k, cache[k]);

// demos in the folder and one level of subfolders
const files = listDemos(folder);
if (!files.length) { console.error(`No .dem / .dem.gz / .dem.zst files in ${folder}`); process.exit(1); }

const readDemo = (f: string): Cached => coachFromDemo(loadDemo(folder, f), minRounds);

// the same demo downloaded twice ("x.dem.zst" and "x (1).dem.zst") counts once
const keyOf = (f: string) => `${f.replace(/ \(\d+\)(?=\.dem)/, '')}|${fs.statSync(path.join(folder, f)).size}`;
const seen = new Set<string>();

const t0 = Date.now();
files.forEach((f, i) => {
  const full = path.join(folder, f);
  const key = keyOf(f);
  if (seen.has(key)) { console.log(`[${i + 1}/${files.length}] ${f}  (duplicate, skipped)`); return; }
  seen.add(key);
  const tag = `[${String(i + 1).padStart(String(files.length).length)}/${files.length}] ${f}`;
  if (cache[key]) { console.log(`${tag}  (cached, ${cache[key].samples.length} players)`); return; }
  const s = Date.now();
  try { cache[key] = readDemo(f); } catch (e) { cache[key] = { map: null, samples: [], error: e instanceof Error ? e.message : String(e) }; }
  const c = cache[key];
  console.log(`${tag}  ${c.error ? `skipped: ${c.error}` : `${c.map}, ${c.samples.length} players`}  ${((Date.now() - s) / 1000).toFixed(0)} s`);
  saveCache(key);
});

// only the demos that are still in the folder
// the demos here and the ones imported from another computer's training pack
const live = liveKeys(folder);
const used = Object.entries(cache).filter(([k, c]) => live.has(k) && c.samples.length);
const samples = used.flatMap(([, c]) => c.samples);
if (!samples.length) { console.error('\nNo usable games: nothing to train on.'); process.exit(1); }
const maps: Record<string, number> = {};
for (const [, c] of used) maps[c.map!] = (maps[c.map!] ?? 0) + 1;

const model = trainCoachSet(samples.map(({ features, role }) => ({ features, role })), label,
  { demos: used.length, trainedAt: new Date().toISOString().slice(0, 10), maps });
fs.writeFileSync(OUT, JSON.stringify(model, null, 1) + '\n');

// what changed, for a quick read
const fmt = (id: FeatureId, v: number) => ['adr', 'kast', 'hs', 'utilDamage', 'impact'].includes(id) ? v.toFixed(1) : `${(v * 100).toFixed(0)}%`;
console.log(`\nLearned from ${samples.length} player-games in ${used.length} demos (${Object.entries(maps).map(([m, n]) => `${m.replace('de_', '')} ${n}`).join(', ')}) in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
console.log(`\n${'Number'.padEnd(24)}${'Premier'.padStart(9)}${label.padStart(Math.max(10, label.length + 2))}`);
for (const id of Object.keys(model.features) as FeatureId[])
  console.log(`${FEATURE_LABEL[id].padEnd(24)}${fmt(id, DEFAULT_MODEL.features[id].baseline).padStart(9)}${fmt(id, model.features[id].baseline).padStart(Math.max(10, label.length + 2))}`);
const roleCounts = new Map<string, number>();
for (const s of samples) roleCounts.set(s.role, (roleCounts.get(s.role) ?? 0) + 1);
console.log(`\nRoles: ${[...roleCounts].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}${n >= MIN_ROLE_GAMES ? '' : ' (too few for its own numbers)'}`).join(' · ')}`);
console.log(`\nSaved ${path.relative(process.cwd(), OUT)}. Reload the site: the coach now judges against ${label} players.`);

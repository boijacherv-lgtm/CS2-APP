// Reads a folder of demos on this computer (all CPU cores, the slow part of training) and packs what every learner
// needs from them into one file, a "training pack", to send to whoever trains the coach. They add it with
// `npm run import:training -- <pack>`; the demos themselves never have to move.
//
//   npm run pack:training -- <demo folder> [--only <faceit-links.txt>] [--out training-pack.json.gz] [--workers 4]
//
// --only: just the demos of the matches on that link list (e.g. the download kit's list), so demos already sent
// before aren't read again.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CACHES, keyOf, listDemos, matchIdOf, readCacheEntry, runTool, type Learner } from './learn-lib';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run pack:training -- <demo folder> [--only <faceit-links.txt>] [--out training-pack.json.gz]'); process.exit(1); }
const out = path.resolve(opt('out') ?? `training-pack-${new Date().toISOString().slice(0, 10)}.json.gz`);
const only = opt('only');
const ids = only ? new Set((fs.readFileSync(only, 'utf8').match(/1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map(x => x.toLowerCase())) : null;
const files = listDemos(folder).filter(f => !ids || ids.has(matchIdOf(f) ?? ''));
if (!files.length) { console.error(`No demos${ids ? ' from that list' : ''} in ${folder}.`); process.exit(1); }
console.log(`${files.length} demos to read${ids ? ` (of the ${ids.size} matches on the list)` : ''}.`);

// 1. read them (learn:all's reading step, in parallel, nothing trained)
runTool('learn-all.ts', [folder, '--read-only', ...(only ? ['--only', only] : []), ...(opt('workers') ? ['--workers', opt('workers')!] : [])]);

// 2. pack every learner's result for those demos
const learners = Object.keys(CACHES) as Learner[];
const entries: Record<Learner, Record<string, unknown>> = Object.fromEntries(learners.map(l => [l, {}])) as Record<Learner, Record<string, unknown>>;
const demos: Record<string, { matchId: string | null; map: string | null }> = {};
let errors = 0;
for (const f of files) {
  const key = keyOf(folder, f);
  for (const l of learners) {
    const v = readCacheEntry<{ map?: string | null; error?: string }>(folder, l, key);
    if (v === undefined) continue;
    entries[l][key] = v;
    if (l === 'analyst') { demos[key] = { matchId: matchIdOf(f), map: v.map ?? null }; if (v.error) errors++; }
  }
}
const pack = {
  format: 1, made: new Date().toISOString(), demos,
  versions: Object.fromEntries(learners.map(l => [l, CACHES[l].v])),
  entries,
};
fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(pack)));
const maps: Record<string, number> = {};
for (const d of Object.values(demos)) if (d.map) maps[d.map] = (maps[d.map] ?? 0) + 1;
console.log(`\nPacked ${Object.keys(demos).length} demos${errors ? ` (${errors} couldn't be read)` : ''}: ${Object.entries(maps).map(([m, n]) => `${m.replace('de_', '')} ${n}`).join(', ')}.`);
console.log(`Saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(0)} MB). Send this file; the demos stay here.`);

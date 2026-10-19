// Adds a training pack (made on another computer by `npm run pack:training`) to a training folder: every demo's
// results go into the learners' caches, and the folder remembers them (.stratboard-imported.json), so the next
// `npm run learn:all -- <folder>` trains on them too, although the demo files aren't here. A match already in the
// folder (or imported before) isn't added twice.
//
//   npm run import:training -- <pack.json.gz> [<training folder>, default ~/Desktop/APPS/faceit-demos] [--train]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { CACHES, cachedKeys, IMPORTED, importedKeys, listDemos, matchIdOf, runTool, writeCacheEntry, type ImportedEntry, type Learner } from './learn-lib';

const args = process.argv.slice(2).filter(a => a !== '--');
const plain = args.filter(a => !a.startsWith('--'));
const packFile = plain[0];
const folder = (plain[1] ?? path.join(os.homedir(), 'Desktop/APPS/faceit-demos')).replace(/^~/, os.homedir());
if (!packFile || !fs.existsSync(packFile) || !fs.existsSync(folder)) { console.error('Usage: npm run import:training -- <pack.json.gz> [<training folder>] [--train]'); process.exit(1); }

type Pack = { format: number; made: string; demos: Record<string, { matchId: string | null; map: string | null }>; versions: Record<Learner, number | null>; entries: Record<Learner, Record<string, unknown>> };
const pack: Pack = JSON.parse(zlib.gunzipSync(fs.readFileSync(packFile)).toString('utf8'));
if (pack.format !== 1) { console.error(`Unknown pack format ${pack.format}.`); process.exit(1); }
const name = path.basename(packFile).replace(/\.json\.gz$/, '');

// a learner whose numbers are computed differently now (its version changed) can't use the pack's results
const learners = (Object.keys(CACHES) as Learner[]).filter(l => {
  const ok = pack.versions[l] === CACHES[l].v;
  if (!ok) console.log(`Skipping ${l}: the pack was read with version ${pack.versions[l]}, this coach uses ${CACHES[l].v} (re-pack with the current code).`);
  return ok;
});

// open the learners' caches first (they record their version; an entry written without it would be dropped as
// out of date by the next training run)
for (const l of learners) cachedKeys(folder, l);

// matches already here: demo files in the folder, and earlier imports
const have = new Set(listDemos(folder).map(matchIdOf).filter(Boolean) as string[]);
const imported = importedKeys(folder);
for (const e of Object.values(imported)) if (e.matchId) have.add(e.matchId);

let added = 0, dup = 0;
const maps: Record<string, number> = {};
for (const [key, d] of Object.entries(pack.demos)) {
  if (d.matchId && have.has(d.matchId)) { dup++; continue; }
  // the pack's keys are paths on the other computer: kept apart from this folder's own
  const k = `import/${name}/${key}`;
  for (const l of learners) if (pack.entries[l]?.[key] !== undefined) writeCacheEntry(folder, l, k, pack.entries[l][key]);
  imported[k] = { matchId: d.matchId, map: d.map, pack: name } satisfies ImportedEntry;
  if (d.matchId) have.add(d.matchId);
  if (d.map) maps[d.map] = (maps[d.map] ?? 0) + 1;
  added++;
}
fs.writeFileSync(path.join(folder, IMPORTED), JSON.stringify(imported));
console.log(`Imported ${added} demos from ${name} (made ${pack.made.slice(0, 10)})${dup ? `; ${dup} skipped, already here` : ''}: ${Object.entries(maps).map(([m, n]) => `${m.replace('de_', '')} ${n}`).join(', ') || 'none'}.`);
if (args.includes('--train')) { console.log('\nTraining (learn:all)…'); runTool('learn-all.ts', [folder]); }
else console.log(`Train with: npm run learn:all -- ${folder}`);

// Adds demos read on another computer to a training folder, so the next `npm run learn:all -- <folder>` trains on
// them too, although their demo files aren't here. Takes either
//   - a training pack (`npm run pack:training` on the other computer): every demo's saved read and learners' results
//   - a folder of saved reads (the other computer's <demo folder>/.stratboard-parsed, or the demo folder itself): the
//     learners' results are worked out here from each read (a few seconds a demo)
// Each demo's results go into the learners' caches and its read into <folder>/.stratboard-parsed (the win chance,
// stand spots and engine calibration learn from those); the folder remembers them (.stratboard-imported.json). A match
// already in the folder (or imported before) isn't added twice.
//
//   npm run import:training -- <pack or folder> [<training folder>, default ~/Desktop/APPS/faceit-demos] [--train]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  analystFromDemo, CACHES, cachedKeys, coachFromDemo, IMPORTED, importedKeys, listDemos, matchIdOf, newestReads, PARSE_V, PARSED,
  parsedName, positionsFromDemo, readPack, runTool, spotsFromDemo, writeCacheEntry, type ImportedEntry, type Learner, type PackDemo,
} from './learn-lib';
import type { DemoData } from '../src/engine/recap';

const args = process.argv.slice(2).filter(a => a !== '--');
const plain = args.filter(a => !a.startsWith('--')).map(a => a.replace(/^~/, os.homedir()));
const source = plain[0];
const folder = plain[1] ?? path.join(os.homedir(), 'Desktop/APPS/faceit-demos');
if (!source || !fs.existsSync(source) || !fs.existsSync(folder)) { console.error('Usage: npm run import:training -- <pack or folder of reads> [<training folder>] [--train]'); process.exit(1); }
const name = path.basename(source).replace(/\.(sbpack|json\.gz)$/, '').replace(/^\.stratboard-parsed$/, path.basename(path.dirname(path.resolve(source)))).replace(/[^\w.-]+/g, '_');

type Incoming = PackDemo & { read: Buffer | null; readV: number | null };
let learners = Object.keys(CACHES) as Learner[];
let made = new Date().toISOString();
let demos: Iterable<Incoming>;

if (fs.statSync(source).isDirectory()) {
  // saved reads: <dir>/v7-….json.gz, or a demo folder with them in .stratboard-parsed
  const dir = fs.existsSync(path.join(source, PARSED)) ? path.join(source, PARSED) : source;
  const reads = [...newestReads(dir)];
  const old = reads.filter(([, p]) => p.v !== PARSE_V).length;
  if (old) console.log(`${old} reads were made by an older reader (v${PARSE_V} now): imported without the newest details (grenade paths…). Read them again with the current code for those.`);
  console.log(`${reads.length} saved reads in ${dir}; working out each one's numbers…`);
  demos = (function* () {
    let i = 0;
    for (const [id, p] of reads) {
      i++;
      const read = fs.readFileSync(p.file);
      const entries: PackDemo['entries'] = {};
      let map: string | null = null;
      try {
        const d: DemoData = JSON.parse(zlib.gunzipSync(read).toString('utf8'));
        map = d.map;
        entries.spots = spotsFromDemo(d); entries.positions = positionsFromDemo(d); entries.analyst = analystFromDemo(d); entries.coach = coachFromDemo(d);
      } catch (e) { console.log(`  ${id}: skipped (${e instanceof Error ? e.message : String(e)})`); continue; }
      if (i % 10 === 0) console.log(`  ${i}/${reads.length}`);
      yield { key: id, matchId: matchIdOf(id), map, entries, read, readV: p.v };
    }
  })();
} else {
  const pack = readPack(source);
  made = pack.header.made;
  // a learner whose numbers are computed differently now (its version changed) can't use the pack's results
  learners = learners.filter(l => {
    const ok = pack.header.versions[l] === CACHES[l].v;
    if (!ok) console.log(`Skipping ${l}: the pack was made with version ${pack.header.versions[l]}, this coach uses ${CACHES[l].v} (re-pack with the current code).`);
    return ok;
  });
  if (pack.header.format === 1) console.log('An older pack without the demos\' reads: the win chance, stand spots and engine calibration won\'t learn from it (re-pack with the current code).');
  demos = (function* () { for (const d of pack.demos) yield { ...d, readV: pack.header.parseV }; })();
}

// open the learners' caches first (they record their version; an entry written without it would be dropped as
// out of date by the next training run)
for (const l of learners) cachedKeys(folder, l);

// matches already here: demo files in the folder, and earlier imports
const have = new Set(listDemos(folder).map(matchIdOf).filter(Boolean) as string[]);
const imported = importedKeys(folder);
for (const e of Object.values(imported)) if (e.matchId) have.add(e.matchId);
fs.mkdirSync(path.join(folder, PARSED), { recursive: true });

let added = 0, dup = 0;
const maps: Record<string, number> = {};
for (const d of demos) {
  // the other computer's keys are its paths: kept apart from this folder's own
  const k = `import/${name}/${d.key}`;
  if ((d.matchId && have.has(d.matchId)) || imported[k]) { dup++; continue; }
  for (const l of learners) if (d.entries[l] !== undefined) writeCacheEntry(folder, l, k, d.entries[l]);
  if (d.read && d.readV) fs.writeFileSync(path.join(folder, PARSED, parsedName(k, d.readV)), d.read);
  imported[k] = { matchId: d.matchId, map: d.map, pack: name } satisfies ImportedEntry;
  if (d.matchId) have.add(d.matchId);
  if (d.map) maps[d.map] = (maps[d.map] ?? 0) + 1;
  added++;
  // saved as it goes, so a stop halfway keeps what's in
  if (added % 25 === 0) fs.writeFileSync(path.join(folder, IMPORTED), JSON.stringify(imported));
}
fs.writeFileSync(path.join(folder, IMPORTED), JSON.stringify(imported));
console.log(`Imported ${added} demos from ${name} (made ${made.slice(0, 10)})${dup ? `; ${dup} skipped, already here` : ''}: ${Object.entries(maps).map(([m, n]) => `${m.replace('de_', '')} ${n}`).join(', ') || 'none'}.`);
if (args.includes('--train')) { console.log('\nTraining (learn:all)…'); runTool('learn-all.ts', [folder]); }
else console.log(`Train with: npm run learn:all -- ${folder}`);

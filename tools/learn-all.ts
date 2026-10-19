// Trains everything from a folder of demos in one go, using several CPU cores:
//   1. finds the demos any learner hasn't read yet (coach, grenade spots, positions, analyst + win chance)
//   2. splits them over worker processes (learn-worker.ts); each demo is read once (and saved in
//      <folder>/.stratboard-parsed, so the next time it loads in a fraction of a second) and every learner's numbers
//      come from that one read
//   3. merges the results into the learners' caches and runs each learner, which now only has to aggregate,
//      then calibrates the positioning engine
//
//   npm run learn:all -- <folder> [--workers 4] [--retry-broken]   (--retry-broken: read again the demos the parser failed on)
//
// Workers default to what fits in memory (the demo reader can peak near 3 GB on a big demo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CACHES, keyOf, listDemos, matchIdOf, needsRead, runTool, startTool, type Learner } from './learn-lib';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run learn:all -- <folder with demos> [--workers 4]'); process.exit(1); }
const memWorkers = Math.max(1, Math.floor(os.totalmem() / (3.5 * 1024 ** 3)));
const workers = Math.max(1, Number(opt('workers') ?? Math.min(os.cpus().length - 1, memWorkers)));
const t0 = Date.now();

// 1. what's missing where
// --only <links file>: just the demos of the matches on that list (a FACEIT link list, e.g. download-kit/faceit-links.txt)
const onlyIds = opt('only') ? new Set((fs.readFileSync(opt('only')!, 'utf8').match(/1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map(x => x.toLowerCase())) : null;
const files = listDemos(folder).filter(f => !onlyIds || onlyIds.has(matchIdOf(f) ?? ''));
const byKey = new Map<string, string>();
for (const f of files) { const k = keyOf(folder, f); if (!byKey.has(k)) byKey.set(k, f); }
const learners = Object.keys(CACHES) as Learner[];
const need = Object.fromEntries(learners.map(l => [l, needsRead(folder, l)])) as Record<Learner, (key: string) => boolean>;
const todo = [...byKey].filter(([k]) => learners.some(l => need[l](k)));
const needs = learners.filter(l => todo.some(([k]) => need[l](k)));
console.log(`${byKey.size} demos (${files.length - byKey.size} duplicates skipped); ${todo.length} to read for: ${needs.join(', ') || 'nothing'}; ${workers} workers.`);

// 2. read them in parallel
async function run() {
  if (todo.length) {
    // biggest demos first, dealt round-robin, so the workers finish close together
    const sorted = todo.sort((a, b) => Number(b[0].split('|').pop()) - Number(a[0].split('|').pop()));
    const shards: string[][] = Array.from({ length: Math.min(workers, sorted.length) }, () => []);
    sorted.forEach(([, f], i) => shards[i % shards.length].push(f));
    let done = 0;
    await Promise.all(shards.map((shard, w) => new Promise<void>((resolve, reject) => {
      // each worker writes its results straight into the learners' caches (one file per demo)
      const child = startTool('learn-worker.ts', [folder!, needs.join(','), ...shard], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...(args.includes('--retry-broken') ? { STRATBOARD_RETRY_BROKEN: '1' } : {}) } });
      let buf = '';
      child.stdout!.on('data', (c: Buffer) => {
        buf += c.toString();
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) console.log(`[${++done}/${todo.length}] ${l}`);
      });
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`worker ${w} exited with ${code}`))));
    })));
    console.log(`\nRead ${todo.length} demos in ${((Date.now() - t0) / 60000).toFixed(1)} min.\n`);
  }
  // 3b. every learner aggregates from its (now complete) cache; learn-positions also calibrates the engine
  // (calibrate-search last: it reads the position stats and win model the others just wrote). --read-only stops
  // before this: reading demos for a training pack (tools/pack-training.ts) on another computer.
  if (args.includes('--read-only')) { console.log(`\nRead in ${((Date.now() - t0) / 60000).toFixed(1)} min (read only, nothing trained).`); return; }
  for (const tool of ['train-coach', 'learn-spots', 'learn-positions', 'learn-analyst', 'calibrate-search']) {
    console.log(`\n=== ${tool}`);
    // aggregating thousands of demos needs more than Node's default heap
    const r = runTool(`${tool}.ts`, [folder!], { stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${Math.max(4096, Math.floor(os.totalmem() / 1024 ** 2 / 2))}` } });
    String(r.stdout ?? '').split('\n').filter(l => l && !l.startsWith('[')).forEach(l => console.log(l));
  }
  console.log(`\nAll trained in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
}
run().catch(e => { console.error(e); process.exit(1); });

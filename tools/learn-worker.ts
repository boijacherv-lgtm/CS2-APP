// One worker of learn:all: reads its share of the demos (once each, from the saved read when there is one) and
// computes what every learner needs from them, writing each result straight into that learner's cache.
//   vite-node tools/learn-worker.ts <folder> <needs: coach,spots,positions,analyst> <file> [file…]
import { analystFromDemo, coachFromDemo, keyOf, loadDemo, needsRead, positionsFromDemo, spotsFromDemo, writeCacheEntry, type Learner } from './learn-lib';

const [folder, needsArg, ...files] = process.argv.slice(2).filter(a => a !== '--');
const needs = new Set(needsArg.split(',') as Learner[]);
const need = Object.fromEntries([...needs].map(l => [l, needsRead(folder, l)])) as Record<Learner, (key: string) => boolean>;
for (const f of files) {
  const key = keyOf(folder, f), t = Date.now();
  const r: Partial<Record<Learner, unknown>> = {};
  try {
    const d = loadDemo(folder, f);
    if (needs.has('spots') && need.spots(key)) r.spots = spotsFromDemo(d);
    if (needs.has('positions') && need.positions(key)) r.positions = positionsFromDemo(d);
    if (needs.has('analyst') && need.analyst(key)) r.analyst = analystFromDemo(d);
    if (needs.has('coach') && need.coach(key)) r.coach = coachFromDemo(d);
    console.log(`${f}  ${d.map}, ${d.rounds.length} rounds  ${((Date.now() - t) / 1000).toFixed(0)} s`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    for (const l of needs) r[l] = l === 'spots' ? { map: null, landings: [], error } : l === 'coach' ? { map: null, samples: [], error } : { map: null, rounds: [], error };
    console.log(`${f}  skipped: ${error}`);
  }
  // saved as each demo is done, so a crash keeps what's finished
  for (const [l, v] of Object.entries(r)) writeCacheEntry(folder, l as Learner, key, v);
}

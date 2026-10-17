// One worker of learn:all: reads its share of the demos (once each, from the saved read when there is one) and
// computes what every learner needs from them, then writes it all to one JSON file for learn:all to merge.
//   vite-node tools/learn-worker.ts <folder> <out.json> <needs: coach,spots,positions,analyst> <file> [file…]
import fs from 'node:fs';
import { analystFromDemo, coachFromDemo, keyOf, loadDemo, positionsFromDemo, spotsFromDemo, type Learner } from './learn-lib';

const [folder, out, needsArg, ...files] = process.argv.slice(2).filter(a => a !== '--');
const needs = new Set(needsArg.split(',') as Learner[]);
const results: Record<string, Partial<Record<Learner, unknown>>> = {};
for (const f of files) {
  const key = keyOf(folder, f), t = Date.now();
  const r: Partial<Record<Learner, unknown>> = {};
  try {
    const d = loadDemo(folder, f);
    if (needs.has('spots')) r.spots = spotsFromDemo(d);
    if (needs.has('positions')) r.positions = positionsFromDemo(d);
    if (needs.has('analyst')) r.analyst = analystFromDemo(d);
    if (needs.has('coach')) r.coach = coachFromDemo(d);
    console.log(`${f}  ${d.map}, ${d.rounds.length} rounds  ${((Date.now() - t) / 1000).toFixed(0)} s`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    for (const l of needs) r[l] = l === 'spots' ? { map: null, landings: [], error } : l === 'coach' ? { map: null, samples: [], error } : { map: null, rounds: [], error };
    console.log(`${f}  skipped: ${error}`);
  }
  results[key] = r;
  fs.writeFileSync(out, JSON.stringify(results)); // after every demo, so a crash keeps what's done
}

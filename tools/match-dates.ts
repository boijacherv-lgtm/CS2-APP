// When each FACEIT match in a training folder was played, so training can weigh newer matches more and test on the
// newest ones (learn:win, learn:duel). Looks up every read match (yours and imported ones) once with the FACEIT
// Data API (FACEIT_API_KEY in .env) and keeps the answers in <folder>/.stratboard-dates.json.
//
//   npm run dates -- <folder> [<folder>…]
import fs from 'node:fs';
import { api, needKey } from './faceit-api';
import { DATES, matchDates, matchIdOf, newestParsed } from './learn-lib';
import path from 'node:path';

const folders = process.argv.slice(2).filter(a => a !== '--');
if (!folders.length) { console.error('Usage: npm run dates -- <folder> [<folder>…]'); process.exit(1); }
needKey();
for (const folder of folders) {
  const known = matchDates(folder);
  const ids = [...new Set([...newestParsed(folder).keys()].map(matchIdOf).filter((x): x is string => !!x))];
  const todo = ids.filter(id => !(id in known));
  console.log(`${folder}: ${ids.length} FACEIT matches, ${todo.length} to look up.`);
  let done = 0;
  const save = () => fs.writeFileSync(path.join(folder, DATES), JSON.stringify(known, null, 1));
  for (const id of todo) {
    try {
      const m = await api<{ finished_at?: number; started_at?: number }>(`/matches/${id}`);
      const at = m.finished_at ?? m.started_at;
      known[id] = at ? at * 1000 : null;
    } catch (e) { console.log(`  ${id}: ${(e as Error).message}`); if (/refused/.test((e as Error).message)) break; }
    if (++done % 50 === 0) { save(); console.log(`  ${done}/${todo.length}`); }
  }
  save();
  const at = Object.values(known).filter((x): x is number => !!x).sort((a, b) => a - b);
  if (at.length) console.log(`  ${at.length} dated, from ${new Date(at[0]).toISOString().slice(0, 10)} to ${new Date(at[at.length - 1]).toISOString().slice(0, 10)}.`);
}

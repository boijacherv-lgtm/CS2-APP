// The coach's report card, one number per part, on data it never learned from:
//   win chance   from learn:win: log loss / Brier / calibration on the held-out 20% of level-10 matches
//   verdicts     how often it agrees with your own verdicts (my-demos: chat + Review's "Coach wrong?")
// plus one history point per day (matches, win chance, duels, engine, verdicts), so the Dev page shows the trend.
// Writes models/eval.json (the Dev page shows it). Run after learn:win.
//
//   npm run eval:coach -- [~/Desktop/APPS/my-demos]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreVerdicts } from './verdicts-lib';
import { pullDisputes } from './disputes-lib';

const dir = (process.argv.slice(2).filter(a => a !== '--')[0] ?? path.join(os.homedir(), 'Desktop/APPS/my-demos')).replace(/^~/, os.homedir());
const file = path.resolve(import.meta.dirname, '../src/engine/models/eval.json');
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
// your newest calls on the site first (Dev → Disputes), when this computer is linked (npm run link:coach)
console.log(await pullDisputes(dir));
const v = scoreVerdicts(dir);
const at = new Date().toISOString().slice(0, 10);
const w0 = prev.winChance, d0 = prev.duels;
const search = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/engine/models/search-calibration.json'), 'utf8'));
const point = {
  at, matches: w0 ? w0.trainMatches + w0.testMatches : null, testMatches: w0?.testMatches ?? null, newest: !!w0?.split?.startsWith('newest'),
  win: w0 ? w0[w0.shipped].logLoss : null, duels: d0 ? d0[d0.shipped].accuracy : null, engine: search.check?.corr ?? null,
  verdicts: { right: v.right, total: v.total },
};
// the numbers before the history was kept (2026-10-24: 518 matches, before the second computer's pack)
const history = (prev.history ?? [{ at: '2026-10-24', matches: 518, testMatches: 95, win: 0.4547, duels: 0.664, engine: 0.311, verdicts: { right: 31, total: 31 } }])
  .filter((h: { at: string }) => h.at !== at);
const out = { ...prev, verdicts: { at, right: v.right, total: v.total }, history: [...history, point] };
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
const w = prev.winChance;
console.log('Win chance, on level-10 matches it never learned from (log loss, lower is better):');
console.log(w ? `  formula ${w.formula.logLoss} · logistic ${w.logistic.logLoss} · trees ${w.trees.logLoss} → using ${w.shipped} (${w.testMatches} matches, ${w.testMoments} moments)` : '  not measured yet: run npm run learn:win -- <folders> first');
console.log(`Your verdicts: agrees on ${v.right} of ${v.total} (${Math.round((100 * v.right) / Math.max(1, v.total))}%).`);

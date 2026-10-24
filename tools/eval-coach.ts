// The coach's report card, one number per part, on data it never learned from:
//   win chance   from learn:win: log loss / Brier / calibration on the held-out 20% of level-10 matches
//   verdicts     how often it agrees with your own verdicts (my-demos: chat + Review's "Coach wrong?")
// Writes models/eval.json (the Dev page shows it). Run after learn:win.
//
//   npm run eval:coach -- [~/Desktop/APPS/my-demos]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreVerdicts } from './verdicts-lib';

const dir = (process.argv.slice(2).filter(a => a !== '--')[0] ?? path.join(os.homedir(), 'Desktop/APPS/my-demos')).replace(/^~/, os.homedir());
const file = path.resolve(import.meta.dirname, '../src/engine/models/eval.json');
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const v = scoreVerdicts(dir);
const out = { ...prev, verdicts: { at: new Date().toISOString().slice(0, 10), right: v.right, total: v.total } };
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
const w = prev.winChance;
console.log('Win chance, on level-10 matches it never learned from (log loss, lower is better):');
console.log(w ? `  formula ${w.formula.logLoss} · logistic ${w.logistic.logLoss} · trees ${w.trees.logLoss} → using ${w.shipped} (${w.testMatches} matches, ${w.testMoments} moments)` : '  not measured yet: run npm run learn:win -- <folders> first');
console.log(`Your verdicts: agrees on ${v.right} of ${v.total} (${Math.round((100 * v.right) / Math.max(1, v.total))}%).`);

// Scores the coach against a player's own verdicts (see verdicts-lib.ts).
//
//   npm run eval:verdicts -- [~/Desktop/APPS/my-demos]
import os from 'node:os';
import path from 'node:path';
import { scoreVerdicts } from './verdicts-lib';
import { pullDisputes } from './disputes-lib';

const dir = (process.argv.slice(2).filter(a => a !== '--')[0] ?? path.join(os.homedir(), 'Desktop/APPS/my-demos')).replace(/^~/, os.homedir());
// your newest calls on the site first (Dev → Disputes), when this computer is linked (npm run link:coach)
console.log(await pullDisputes(dir));
const { right, total, lines } = scoreVerdicts(dir);
console.log(lines.join('\n'));
console.log(`\nAgrees with your verdicts on ${right} of ${total} moments (${Math.round((100 * right) / Math.max(1, total))}%).`);

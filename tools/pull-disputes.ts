// Fetches the moments you've ruled on (Dev → Disputes) into the my-demos folder (see disputes-lib.ts).
//
//   npm run pull:disputes -- [~/Desktop/APPS/my-demos]
import os from 'node:os';
import path from 'node:path';
import { pullDisputes } from './disputes-lib';

const dir = (process.argv.slice(2).filter(a => a !== '--')[0] ?? path.join(os.homedir(), 'Desktop/APPS/my-demos')).replace(/^~/, os.homedir());
console.log(await pullDisputes(dir));

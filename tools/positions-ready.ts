// Node tools read the level-10 positions synchronously (engineEval, search, positioning …), but the site loads them per map
// on demand (src/map/positions.ts). Importing this first makes every map available before the tool's own code runs.
import { loadPositions } from '../src/map/positions';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../src/map/generated/positions');
if (fs.existsSync(dir)) await Promise.all(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => loadPositions(f.replace(/\.json$/, ''))));

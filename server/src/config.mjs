// Settings come from server/.env (you make it; never committed):
//   WORKER_URL=https://stratboard-api.stratboard.workers.dev
//   SERVER_TOKEN=…   (same value as the Worker's SERVER_TOKEN secret)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch { /* no .env: fall back to the environment */ }
const get = k => env[k] || process.env[k] || '';

export const WORKER_URL = get('WORKER_URL').replace(/\/$/, '');
export const SERVER_TOKEN = get('SERVER_TOKEN');
export const DATA = path.resolve(ROOT, get('DATA_DIR') || 'data');
/** How often to look for new matches. */
export const CYCLE_MINUTES = Number(get('CYCLE_MINUTES') || 5);
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
